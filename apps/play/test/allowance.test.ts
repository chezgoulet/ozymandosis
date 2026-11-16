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

test('per account, not per device: one membership covers every platform, and the allowance is per account', async () => {
  const a = await signup(t), b = await signup(t), c = await signup(t);
  // A membership now comes from Stripe, a promo code or a gift, and is honoured everywhere
  // (docs/MONETIZATION.md, ruling of 2026-11-05): there is no platform to scope it to.
  await t.ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end) values ('comp_x', $1, 'active', now() + interval '1 day')`, [c.id]);
  assert.ok((await play(a, [b], 'android')).ticket);
  assert.equal((await play(a, [c], 'ios')).error?.code, 'allowance', 'same account, same allowance, whichever platform asks');
  // c is a member: unlimited everywhere, not only on the platform that granted it
  assert.ok((await play(c, [], 'android')).ticket);
  assert.ok((await play(c, [], 'ios')).ticket, 'the same membership, asked for from another platform');
  assert.ok((await play(c, [], 'web')).ticket);
  // A pre-retirement store row keeps working and now works everywhere: the store gate is gone, so
  // the recorded period end is the whole truth (docs/MONETIZATION.md, ruling of 2026-11-05). This
  // is the deliberate consequence of removing the platform scope — pin it so it is a decision and
  // not an accident.
  const d = await signup(t);
  await t.ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end, platform) values ('gp_legacy', $1, 'active', now() + interval '1 day', 'android')`, [d.id]);
  assert.ok((await play(d, [], 'android')).ticket);
  assert.ok((await play(d, [], 'ios')).ticket, 'a legacy store row counts on every platform');
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
