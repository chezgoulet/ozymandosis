// SPDX-License-Identifier: AGPL-3.0-only
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, Client, type T } from './helpers.js';
import { createUser, createSession } from '../src/auth/service.js';
import { ageFrom } from '../src/lib/age.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });
const year = new Date().getUTCFullYear();

test('age: the cautious reading of month and year', () => {
  const now = new Date(Date.UTC(2026, 5, 15)); // June 2026
  assert.equal(ageFrom(2013, 6, now), 12, 'birthday this month counts as not yet');
  assert.equal(ageFrom(2013, 5, now), 13);
  assert.equal(ageFrom(2013, 13, now), null); assert.equal(ageFrom(1800, 1, now), null);
});

test('sign-up asks for age; under 13 gets no account and nothing is kept', async () => {
  const email = `kid${Date.now()}@example.com`;
  const none = await t.api('POST', '/api/auth/signup', { email, password: 'a fine long password', client: 'game' });
  assert.equal(none.status, 400); assert.equal(none.json.code, 'age');
  const kid = await t.api('POST', '/api/auth/signup', { email, password: 'a fine long password', client: 'game', birthYear: year - 10, birthMonth: 1 });
  assert.equal(kid.status, 403); assert.equal(kid.json.code, 'underage');
  assert.equal(await t.ctx.db.one('select 1 from users where email = $1', [email]), null);
});

test('teens get quick chat only and cannot turn free chat on', async () => {
  const teen = await signup(t, { birthYear: year - 14 });
  const me = await t.api('GET', '/api/me', undefined, teen.token);
  assert.equal(me.json.user.ageBand, '13-15'); assert.equal(me.json.user.chat, 'quick'); assert.equal(me.json.user.freeChat, false);
  assert.equal((await t.api('PATCH', '/api/me', { chat: 'all' }, teen.token)).status, 400);
  assert.equal((await t.api('PATCH', '/api/me', { chat: 'off' }, teen.token)).status, 200);
});

test('provider accounts answer the age question before online play; under 13 removes the account', async () => {
  const mk = async () => { const u = await createUser(t.ctx, { name: 'Provided' + Math.floor(Math.random() * 1e4), verified: true }); return { u, token: (await createSession(t.ctx, u.id, 'game', 'test', false)).token }; };
  const { u, token } = await mk();
  const c = new Client(); // raw socket: expect a refusal instead of hello
  await assert.rejects(Client.open(t, token), /timeout waiting for hello/);
  assert.equal((await t.api('POST', '/api/me/age', { birthYear: year - 30, birthMonth: 3 }, token)).json.ageBand, 'adult');
  const C = await Client.open(t, token); assert.equal(C.hello.config.chat, 'all'); C.close();
  const kid = await mk();
  const r = await t.api('POST', '/api/me/age', { birthYear: year - 9, birthMonth: 3 }, kid.token);
  assert.equal(r.status, 403);
  assert.equal((await t.ctx.db.one<any>('select status from users where id = $1', [kid.u.id])).status, 'deleted');
  assert.equal((await t.api('GET', '/api/me', undefined, kid.token)).status, 401);
  void u; void c;
});

test('chat goes through the server: filtered, age-aware, mute-aware, and reports cite what was really said', async () => {
  const a = await signup(t), b = await signup(t), teen = await signup(t, { birthYear: year - 14 });
  const A = await Client.open(t, a.token), B = await Client.open(t, b.token), K = await Client.open(t, teen.token);
  A.send({ op: 'host' }); const { room } = await A.wait('hosted');
  B.send({ op: 'join', room }); await B.wait('joined');
  K.send({ op: 'join', room }); await K.wait('joined');
  A.send({ op: 'chat', text: 'you are a fucking genius' });
  const got = await B.wait('chat');
  assert.match(got.text, /you are a •+ genius/); assert.equal(got.from, a.name);
  await assert.rejects(K.wait('chat', undefined, 300), 'teens never receive free text');
  K.send({ op: 'chat', text: 'hi there' }); assert.equal((await K.wait('error')).msg, 'Quick chat only.');
  K.send({ op: 'chat', q: 2 });
  assert.equal((await A.wait('chat', m => m.q === 2)).text, 'Good game');
  await t.ctx.db.query(`update users set muted_until = now() + interval '1 hour' where id = $1`, [b.id]); await t.ctx.hub.refreshUser(b.id);
  B.send({ op: 'chat', text: 'let me talk' }); assert.equal((await B.wait('error', m => m.code === 'muted')).code, 'muted');
  A.send({ op: 'start' }); const tk = await A.wait('ticket');
  const rep = await t.api('POST', '/api/player-reports', { target: a.id, reason: 'harassment', details: 'rude', match: tk.match, chat: [{ from: 'Someone', text: 'made up line' }] }, b.token);
  assert.equal(rep.status, 200);
  const row = await t.ctx.db.one<any>('select chat from player_reports where reporter_id = $1', [b.id]);
  assert.ok(row.chat.some((l: any) => l.server && /genius/.test(l.text)), 'server log attached');
  assert.ok(!row.chat.some((l: any) => /made up/.test(l.text)), 'client copy ignored when the server heard it');
  for (const c of [A, B, K]) c.close();
});

test('cloud sync: versions, conflicts, limits, export and deletion', async () => {
  const u = await signup(t);
  assert.equal((await t.api('PUT', '/api/cloud/secrets', { value: 1, base: 0 }, u.token)).status, 404, 'only known keys');
  const p1 = await t.api('PUT', '/api/cloud/profile', { value: { xp: 100 }, base: 0 }, u.token);
  assert.equal(p1.json.version, 1);
  const stale = await t.api('PUT', '/api/cloud/profile', { value: { xp: 50 }, base: 0 }, u.token);
  assert.equal(stale.status, 409); assert.deepEqual(stale.json.value, { xp: 100 }); assert.equal(stale.json.version, 1);
  assert.equal((await t.api('PUT', '/api/cloud/profile', { value: { xp: 150 }, base: 1 }, u.token)).json.version, 2);
  assert.deepEqual((await t.api('GET', '/api/cloud/profile', undefined, u.token)).json.value, { xp: 150 });
  const big = 'x'.repeat(800 * 1024);
  assert.equal((await t.api('PUT', '/api/cloud/save.s1', { value: { state: big }, base: 0 }, u.token)).status, 413);
  const list = await t.api('GET', '/api/cloud', undefined, u.token);
  assert.deepEqual(list.json.items.map((i: any) => i.key), ['profile']);
  const other = await signup(t);
  assert.equal((await t.api('GET', '/api/cloud/profile', undefined, other.token)).status, 404, 'each player sees only their own');
  const ex = await t.api('GET', '/api/me/export', undefined, u.token);
  assert.deepEqual(ex.json.cloud[0].value, { xp: 150 });
  assert.equal((await t.api('DELETE', '/api/me', { password: u.password, confirm: 'DELETE' }, u.token)).status, 200);
  assert.equal(await t.ctx.db.one('select 1 from cloud_items where user_id = $1', [u.id]), null);
});
