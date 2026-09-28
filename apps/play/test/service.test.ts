import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, Client, WEBHOOK_SECRET, type T } from './helpers.js';

let t: T;
const staff = async (role: string) => { const u = await signup(t); await t.ctx.db.query('update users set role = $2 where id = $1', [u.id, role]); return u; };
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

test('Stripe webhooks: signed events grant and remove membership, duplicates are ignored, bad signatures refused', async () => {
  const u = await signup(t);
  await t.ctx.db.query(`update users set stripe_customer_id = 'cus_1' where id = $1`, [u.id]);
  const C = await Client.open(t, u.token);
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  const ev = (id: string, status: string) => JSON.stringify({ id, object: 'event', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status, cancel_at_period_end: false, metadata: {}, items: { data: [{ price: { id: 'price_1' }, current_period_end: end }] } } } });
  const send = (payload: string, sig?: string) => t.app.inject({ method: 'POST', url: '/api/billing/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig ?? t.stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) } });
  assert.equal((await send(ev('evt_1', 'active'), 't=1,v1=bad')).statusCode, 400);
  assert.equal((await send(ev('evt_1', 'active'))).statusCode, 200);
  const me = await t.api('GET', '/api/me', undefined, u.token);
  assert.equal(me.json.entitlements.subscriber, true);
  const push = await C.wait('me', m => m.ent.subscriber === true);
  assert.ok(push, 'connected client is told immediately');
  assert.equal((await send(ev('evt_1', 'canceled'))).json().duplicate, true);
  await send(ev('evt_2', 'canceled'));
  assert.equal((await t.api('GET', '/api/me', undefined, u.token)).json.entitlements.subscriber, false);
  C.close();
});

test('crash reports are scrubbed and grouped into issues; staff can triage', async () => {
  const u = await signup(t);
  const report = (line: number) => ({ kind: 'crash', message: `Cannot read properties of undefined (reading 'hp') for bob@mail.com`, stack: `TypeError: x\n    at step (http://localhost/js/sim/world.js:${line}:9)\n    at loop (http://localhost/js/ui/game.js:200:1)`, version: '1.2.0', platform: 'Chrome on Linux', renderer: 'webgl2', context: { units: 400, secret: 'nope', url: 'http://x/?token=abc' } });
  const r1 = await t.api('POST', '/api/reports', report(120), u.token);
  const r2 = await t.api('POST', '/api/reports', report(131));
  assert.equal(r1.json.issue, r2.json.issue, 'same crash, one issue');
  const mod = await staff('support');
  assert.equal((await t.api('GET', '/api/admin/issues', undefined, u.token)).status, 403);
  const list = await t.api('GET', '/api/admin/issues', undefined, mod.token);
  const issue = list.json.issues.find((i: any) => i.id === r1.json.issue);
  assert.equal(issue.count, 2);
  const detail = await t.api('GET', `/api/admin/issues/${issue.id}`, undefined, mod.token);
  assert.doesNotMatch(JSON.stringify(detail.json), /bob@mail\.com|token=abc|nope/);
  await t.api('PATCH', `/api/admin/issues/${issue.id}`, { status: 'resolved', resolvedIn: '1.2.1' }, mod.token);
  await t.api('POST', '/api/reports', { ...report(140), version: '1.2.0' });
  assert.equal((await t.ctx.db.one<any>('select status from issues where id = $1', [issue.id])).status, 'resolved', 'old build: not a regression');
  await t.api('POST', '/api/reports', { ...report(150), version: '1.3.0' });
  assert.equal((await t.ctx.db.one<any>('select status from issues where id = $1', [issue.id])).status, 'regressed');
  const bug = await t.api('POST', '/api/reports', { kind: 'bug', description: 'The spire looks odd', version: '1.2.0', screenshot: 'data:image/png;base64,iVBORw0KGgo=' }, u.token);
  assert.equal(bug.status, 200);
});

test('player reports, moderation actions take effect live, staff hierarchy holds', async () => {
  const victim = await signup(t), troll = await signup(t), mod = await staff('moderator'), admin = await staff('admin');
  const r = await t.api('POST', '/api/player-reports', { target: troll.id, reason: 'harassment', details: 'kept insulting', chat: [{ from: 'troll', text: 'you are bad' }] }, victim.token);
  assert.equal(r.status, 200);
  assert.equal((await t.api('POST', '/api/player-reports', { target: victim.id, reason: 'other' }, victim.token)).status, 400, 'no self reports');
  const q = await t.api('GET', '/api/admin/player-reports', undefined, mod.token);
  const rep = q.json.reports.find((x: any) => x.target_id === troll.id);
  assert.ok(rep);
  const T = await Client.open(t, troll.token);
  await t.api('POST', `/api/admin/player-reports/${rep.id}/resolve`, { status: 'actioned', action: 'suspend', hours: 24, resolution: 'Harassment' }, mod.token);
  assert.match((await T.wait('kicked')).msg, /suspended/);
  assert.equal((await t.api('GET', '/api/me', undefined, troll.token)).json.user.status, 'suspended');
  assert.equal((await t.api('POST', `/api/admin/users/${troll.id}/sanction`, { kind: 'ban', reason: 'x' }, mod.token)).status, 403, 'moderators cannot ban');
  assert.equal((await t.api('POST', `/api/admin/users/${admin.id}/sanction`, { kind: 'mute', reason: 'x' }, mod.token)).status, 403, 'cannot act on higher staff');
  assert.equal((await t.api('POST', `/api/admin/users/${troll.id}/sanction`, { kind: 'ban', reason: 'repeat' }, admin.token)).status, 200);
  assert.equal((await t.api('GET', '/api/me', undefined, troll.token)).status, 401, 'banned sessions are gone');
  const audit = await t.api('GET', '/api/admin/audit', undefined, admin.token);
  assert.ok(audit.json.log.some((l: any) => l.action === 'sanction.ban'));
});

test('announcements are pushed live and served to clients that connect later', async () => {
  const u = await signup(t), mod = await staff('moderator');
  const C = await Client.open(t, u.token);
  const a = await t.api('POST', '/api/admin/announcements', { title: 'Servers restart at 04:00 UTC', body: 'Matches in progress are unaffected: they are peer to peer.', severity: 'warning' }, mod.token);
  assert.equal(a.status, 200);
  assert.equal((await C.wait('announcement')).announcement.title, 'Servers restart at 04:00 UTC');
  const pub = await t.api('GET', '/api/announcements');
  assert.ok(pub.json.announcements.some((x: any) => x.id === a.json.announcement.id));
  assert.equal((await t.api('POST', '/api/admin/announcements', { title: 'x', body: 'y', severity: 'critical' }, mod.token)).status, 403);
  C.close();
});

test('admin dashboard and live config', async () => {
  const admin = await staff('admin');
  const d = await t.api('GET', '/api/admin/dashboard', undefined, admin.token);
  assert.equal(d.status, 200); assert.ok(d.json.users >= 1); assert.ok('online' in d.json.live);
  assert.equal((await t.api('PUT', '/api/admin/config/freeMatchMinutes', { value: 20 }, admin.token)).status, 200);
  assert.equal((await t.api('GET', '/api/config')).json.freeMatchMinutes, 20);
  assert.equal((await t.api('PUT', '/api/admin/config/freeMatchMinutes', { value: -1 }, admin.token)).status, 400);
  await t.api('PUT', '/api/admin/config/freeMatchMinutes', { value: 15 }, admin.token);
});
