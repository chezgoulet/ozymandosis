import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, Client, type T } from './helpers.js';
import { sweep } from '../src/lib/retention.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

test('retention: expired credentials and old records are swept, live data is kept', async () => {
  const q = (s: string, p: unknown[] = []) => t.ctx.db.query(s, p);
  const live = await signup(t);
  const old = await signup(t, { verify: false });
  await q(`update users set created_at = now() - interval '40 days' where id = $1`, [old.id]);
  const fresh = await signup(t, { verify: false });
  await q(`insert into sessions (id, user_id, kind, expires_at) values ('dead', $1, 'game', now() - interval '1 hour')`, [live.id]);
  await q(`insert into oauth_states (state, provider, expires_at) values ('s-old', 'google', now() - interval '1 minute'), ('s-new', 'google', now() + interval '5 minutes')`);
  await q(`insert into stripe_events (id, type, received_at) values ('evt_old', 'x', now() - interval '100 days'), ('evt_new', 'x', now())`);
  const iss = await t.ctx.db.one<any>(`insert into issues (fingerprint, kind, title, status, last_seen) values ('fp-ret', 'bug', 'x', 'resolved', now() - interval '400 days') returning id`);
  await q(`insert into reports (issue_id, created_at, screenshot) values ($1, now() - interval '200 days', 'data:x'), ($1, now() - interval '40 days', 'data:y')`, [iss.id]);
  await q(`insert into audit_log (at, action) values (now() - interval '800 days', 'old'), (now(), 'new')`);

  const n = await sweep(t.ctx);
  assert.ok(n.sessions >= 1 && n.oauth_states === 1 && n.stripe_events === 1 && n.reports === 1 && n.screenshots >= 1 && n.audit_log === 1, JSON.stringify(n));
  const has = async (sql: string, p: unknown[] = []) => (await q(sql, p)).length > 0;
  assert.equal(await has(`select 1 from sessions where id = 'dead'`), false);
  assert.equal(await has(`select 1 from oauth_states where state = 's-new'`), true);
  assert.equal(await has(`select 1 from stripe_events where id = 'evt_new'`), true);
  assert.equal(await has(`select 1 from users where id = $1`, [old.id]), false, 'long-unverified sign-up removed');
  assert.equal(await has(`select 1 from users where id = $1`, [fresh.id]), true, 'recent unverified sign-up kept');
  assert.equal(await has(`select 1 from users where id = $1`, [live.id]), true);
  assert.equal(await has(`select 1 from reports where issue_id = $1 and screenshot is not null`, [iss.id]), false, 'screenshots dropped after 30 days');
  assert.equal(await has(`select 1 from issues where id = $1`, [iss.id]), true, 'issue kept while it still has reports');
  assert.equal((await t.api('GET', '/api/me', undefined, live.token)).status, 200, 'live session untouched');
  assert.deepEqual(await sweep(t.ctx), {}, 'second sweep finds nothing');
});

test('peer protocol: lobbies and quick match only pair clients that speak the same protocol', async () => {
  const a = await signup(t), b = await signup(t), c = await signup(t);
  const A = await Client.open(t, a.token, { proto: 3 }), B = await Client.open(t, b.token, { proto: 2 }), C = await Client.open(t, c.token, { proto: 3 });
  A.send({ op: 'host', title: 'New build' });
  const hosted = await A.wait('hosted');
  B.send({ op: 'lobbies' }); const lb = await B.wait('lobbies');
  assert.equal(lb.list.some((l: any) => l.room === hosted.room), false, 'older client does not see a newer lobby');
  C.send({ op: 'lobbies' }); const lc = await C.wait('lobbies');
  assert.equal(lc.list.some((l: any) => l.room === hosted.room), true);
  B.send({ op: 'join', room: hosted.room });
  const err = await B.wait('error');
  assert.equal(err.code, 'version'); assert.match(err.msg, /newer version/);
  A.send({ op: 'leave' });
  // quick match: 2 and 3 never meet
  B.send({ op: 'queue', mode: 'duel' }); C.send({ op: 'queue', mode: 'duel' });
  await B.wait('queued'); await C.wait('queued');
  t.ctx.hub.matchmake();
  await assert.rejects(B.wait('matched', undefined, 300));
  A.send({ op: 'queue', mode: 'duel' });
  t.ctx.hub.matchmake();
  const m = await C.wait('matched');
  assert.ok(m.room);
  for (const x of [A, B, C]) x.close();
});

test('a host whose signaling drops mid-match can resume it; guests are told to wait meanwhile', async () => {
  const h = await signup(t), g = await signup(t);
  const H = await Client.open(t, h.token), G = await Client.open(t, g.token);
  H.send({ op: 'host' }); const { room } = await H.wait('hosted');
  G.send({ op: 'join', room }); await G.wait('joined'); await H.wait('peer');
  H.send({ op: 'start' }); const tk = await H.wait('ticket');
  H.close(); await new Promise(r => setTimeout(r, 150));
  G.send({ op: 'leave' });
  G.send({ op: 'join', room });
  assert.equal((await G.wait('error')).code, 'host_away');
  const H2 = await Client.open(t, h.token);
  const other = await signup(t), O = await Client.open(t, other.token);
  O.send({ op: 'host', resume: room });
  assert.equal((await O.wait('error')).code, 'resume', 'only the same account can resume');
  H2.send({ op: 'host', resume: room });
  const back = await H2.wait('hosted');
  assert.equal(back.room, room); assert.equal(back.resumed, true);
  assert.equal((await H2.wait('ticket')).ticket, tk.ticket);
  G.send({ op: 'join', room });
  const j = await G.wait('joined'); assert.equal(j.id, 1, 'same seat');
  await H2.wait('peer');
  for (const c of [H2, G, O]) c.close();
});
