// SPDX-License-Identifier: AGPL-3.0-only
// The free online allowance (docs/MONETIZATION.md, "The allowance").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, Client, type T } from './helpers.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

async function play(host: { token: string }, guests: { token: string }[], platform = 'test') {
  const H = await Client.open(t, host.token, { platform });
  H.send({ op: 'host' }); const h = await Promise.race([H.wait('hosted'), H.wait('error')]);
  if (h.op === 'error') { H.close(); return { error: h }; }
  const G = [];
  for (const g of guests) { const c = await Client.open(t, g.token, { platform }); c.send({ op: 'join', room: h.room }); const r = await Promise.race([c.wait('joined'), c.wait('error')]); if (r.op === 'error') { H.close(); c.close(); for (const x of G) x.close(); return { error: r }; } G.push(c); }
  H.send({ op: 'start' }); const tk = await H.wait('ticket');
  H.close(); for (const c of G) c.close();
  return { ticket: t.ctx.signer.verify(tk.ticket) };
}

test('one free match per rolling 24 hours, whichever side: the second is refused when hosting, joining or queueing', async () => {
  const a = await signup(t), b = await signup(t), c = await signup(t);
  assert.ok((await play(a, [b])).ticket, 'first match: fine');
  const again = await play(a, [c]);
  assert.equal(again.error.code, 'allowance', 'hosting a second is refused'); assert.match(again.error.msg, /today's free online match/);
  assert.ok(again.error.allowance.nextAt, 'and says when the next one comes');
  const joinTry = await play(c, [b]);
  assert.equal(joinTry.error.code, 'allowance', 'joining a second is refused');
  const Q = await Client.open(t, b.token); Q.send({ op: 'queue', mode: 'duel' });
  assert.equal((await Q.wait('error')).code, 'allowance', 'queueing is refused'); Q.close();
});

test('counted when the match starts: lobbies that never start cost nothing', async () => {
  const a = await signup(t), b = await signup(t);
  for (let i = 0; i < 3; i++) {
    const H = await Client.open(t, a.token); H.send({ op: 'host' }); const { room } = await H.wait('hosted');
    const G = await Client.open(t, b.token); G.send({ op: 'join', room }); await G.wait('joined');
    H.close(); G.close(); // the host leaves before starting
  }
  assert.ok((await play(a, [b])).ticket, 'still has the free match after three abandoned lobbies');
});

test('the window rolls: 24 hours after the free match, another is available (not at midnight)', async () => {
  const a = await signup(t), b = await signup(t);
  await play(a, [b]);
  await t.ctx.db.query(`update match_players set counted_at = now() - interval '23 hours 50 minutes' where user_id = any($1)`, [[a.id, b.id]]);
  assert.equal((await play(a, [b])).error?.code, 'allowance', '23h50 later: still used');
  await t.ctx.db.query(`update match_players set counted_at = now() - interval '24 hours 1 minute' where user_id = any($1)`, [[a.id, b.id]]);
  assert.ok((await play(a, [b])).ticket, '24h later: available again');
});

test('per account, not per platform or device: owning several platforms does not give several matches', async () => {
  const a = await signup(t), b = await signup(t), c = await signup(t);
  await t.ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end, platform) values ('gp_x', $1, 'active', now() + interval '1 day', 'android')`, [c.id]); // c is a member on Android only
  assert.ok((await play(a, [b], 'android')).ticket);
  assert.equal((await play(a, [c], 'ios')).error?.code, 'allowance', 'another platform: same account, same allowance');
  // c is a member on Android: unlimited there, counted like anyone on iOS
  assert.ok((await play(c, [], 'android')).ticket); assert.ok((await play(c, [], 'android')).ticket);
  assert.ok((await play(c, [], 'ios')).ticket, 'free match on iOS');
  assert.equal((await play(c, [], 'ios')).error?.code, 'allowance');
});

test('the allowance is live configuration', async () => {
  const admin = await signup(t); await t.ctx.db.query(`update users set role = 'admin' where id = $1`, [admin.id]);
  assert.equal((await t.api('PUT', '/api/admin/config/freeMatchesPerDay', { value: 2 }, admin.token)).status, 200);
  assert.equal((await t.api('GET', '/api/config')).json.freeMatchesPerDay, 2);
  const a = await signup(t), b = await signup(t);
  assert.ok((await play(a, [b])).ticket); assert.ok((await play(a, [b])).ticket);
  assert.equal((await play(a, [b])).error?.code, 'allowance');
  await t.api('PUT', '/api/admin/config/freeMatchesPerDay', { value: 1 }, admin.token);
});
