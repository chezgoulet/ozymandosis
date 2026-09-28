import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, Client, type T } from './helpers.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

test('hello carries ICE (with TURN credentials), the ticket key and entitlements', async () => {
  const u = await signup(t);
  const c = await Client.open(t, u.token);
  assert.equal(c.hello.user.id, u.id);
  assert.equal(c.hello.ent.subscriber, false);
  assert.equal(c.hello.key.kid, t.ctx.signer.id);
  const turn = c.hello.ice.find((s: any) => s.username);
  assert.ok(turn && turn.credential && turn.urls.includes('turn:turn.test:3478'));
  assert.ok(Number(turn.username.split(':')[0]) > Date.now() / 1000, 'TURN credentials expire in the future');
  assert.doesNotMatch(turn.username, new RegExp(u.id), 'TURN usernames are pseudonymous');
  c.send({ op: 'ping', t: 1 }); await c.wait('pong');
  c.close();
});

test('lobby: host, list, join, signaling relay, kick', async () => {
  const a = await signup(t, { name: 'Hosta' }), b = await signup(t, { name: 'Guesto' }), x = await signup(t, { name: 'Lurker' });
  const A = await Client.open(t, a.token), B = await Client.open(t, b.token), X = await Client.open(t, x.token);
  A.send({ op: 'host', title: 'Open bloom', public: true, max: 4 });
  const hosted = await A.wait('hosted');
  assert.match(hosted.room, /^[A-Z]{5}$/);
  assert.ok(hosted.ice.some((s: any) => s.username && s.credential), 'TURN credentials issued');
  X.send({ op: 'lobbies' });
  const list = await X.wait('lobbies');
  assert.ok(list.list.some((l: any) => l.room === hosted.room && l.title === 'Open bloom'));
  B.send({ op: 'join', room: hosted.room });
  const joined = await B.wait('joined');
  assert.equal(joined.hostName, 'Hosta'); assert.equal(joined.id, 1);
  const peer = await A.wait('peer');
  assert.equal(peer.name, 'Guesto'); assert.equal(peer.uid, b.id); assert.equal(peer.sub, false);
  // signaling goes host ↔ guest only
  A.send({ op: 'signal', to: 1, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  assert.equal((await B.wait('signal')).data.sdp.type, 'offer');
  B.send({ op: 'signal', to: 0, data: { c: { candidate: 'x' } } });
  assert.equal((await A.wait('signal')).from, 1);
  X.send({ op: 'signal', to: 0, data: { c: 1 } }); // not in the lobby: dropped
  A.send({ op: 'kick', id: 1 });
  assert.equal((await B.wait('error')).msg, 'Removed by host.');
  await B.wait('closed');
  B.send({ op: 'join', room: hosted.room });
  assert.match((await B.wait('error', m => /removed/i.test(m.msg))).msg, /removed you/);
  assert.ok(!A.msgs.some(m => m.op === 'signal' && m.from === undefined));
  A.close(); B.close(); X.close();
});

test('match tickets carry a count, not a deadline; members are not counted; a rejoin is not counted again', async () => {
  const host = await signup(t), free = await signup(t), member = await signup(t);
  await t.api('POST', `/api/admin/users/${member.id}/grant`, { days: 30 }); // unauthenticated: refused
  await t.ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end) values ('sub_m', $1, 'active', now() + interval '20 days')`, [member.id]);
  const H = await Client.open(t, host.token), F = await Client.open(t, free.token), M = await Client.open(t, member.token);
  assert.deepEqual(F.hello.ent.freeMatches, { perDay: 1, used: 0, left: 1, nextAt: null });
  H.send({ op: 'host' }); const { room } = await H.wait('hosted');
  F.send({ op: 'join', room }); await F.wait('joined'); await H.wait('peer');
  M.send({ op: 'join', room }); await M.wait('joined'); const mp = await H.wait('peer', m => m.uid === member.id);
  assert.equal(mp.sub, true);
  const before = await t.ctx.db.one<any>(`select count(*)::int as n from match_players where user_id = $1`, [free.id]);
  assert.equal(before.n, 0, 'a lobby is not a match: nothing counted yet');
  H.send({ op: 'start' });
  const [th, tf] = await Promise.all([H.wait('ticket'), F.wait('ticket')]);
  assert.equal(th.ticket, tf.ticket, 'everyone holds the same ticket');
  const p = t.ctx.signer.verify(th.ticket);
  assert.ok(p, 'ticket verifies with the server key'); assert.equal(p.v, 2);
  const by = (uid: string) => p.players.find((x: any) => x.uid === uid);
  assert.equal(by(free.id).free, 0, 'the free player has used today\'s match');
  assert.equal(by(host.id).free, 0, 'hosting counts the same as joining');
  assert.equal(by(member.id).free, null, 'members are not counted');
  assert.ok(p.players.every((x: any) => x.until === undefined), 'no deadline inside a match');
  // free player drops (signaling only) and comes back: same seat, not counted again
  F.close(); await new Promise(r => setTimeout(r, 100));
  const F2 = await Client.open(t, free.token);
  F2.send({ op: 'join', room });
  const j2 = await F2.wait('joined');
  assert.equal(j2.id, 1, 'same seat, although the allowance is used');
  await F2.wait('ticket');
  const counted = await t.ctx.db.query<any>(`select free_used from match_players where user_id = $1`, [free.id]);
  assert.deepEqual(counted.map(r => r.free_used), [true], 'counted once');
  assert.equal(Number((await t.ctx.db.one<any>(`select count(*)::int as n from match_players where user_id = $1 and free_used`, [member.id])).n), 0);
  // every player reports; the match settles once all have, and each hears the outcome
  const results = [{ uid: host.id, result: 'win' }, { uid: free.id, result: 'loss' }, { uid: member.id, result: 'loss' }];
  for (const c of [H, F2, M]) c.send({ op: 'end', match: p.mid, kind: 'final', winnerTeam: 0, results });
  const res = await H.wait('result');
  assert.equal(res.status, 'confirmed'); assert.equal(res.result, 'win'); assert.equal(res.rated, false, 'custom lobbies are unrated');
  const row = await t.ctx.db.one<any>(`select status, duration_s from matches where id = $1`, [p.mid]);
  assert.equal(row.status, 'confirmed'); assert.ok(row.duration_s < 60, 'duration is measured by the server, not claimed');
  const hs = await t.ctx.db.one<any>('select wins, matches from users where id = $1', [host.id]);
  assert.equal(hs.wins, 1); assert.equal(hs.matches, 1);
  H.close(); F2.close(); M.close();
});

test('quick match pairs two players into a reserved, ranked lobby hosted by a member when possible', async () => {
  const a = await signup(t), b = await signup(t);
  await t.ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end) values ('sub_b', $1, 'active', now() + interval '20 days')`, [b.id]);
  const A = await Client.open(t, a.token), B = await Client.open(t, b.token);
  A.send({ op: 'queue', mode: 'duel' }); await A.wait('queued');
  B.send({ op: 'queue', mode: 'duel' });
  const [ma, mb] = await Promise.all([A.wait('matched'), B.wait('matched')]);
  assert.equal(mb.role, 'host', 'the member hosts'); assert.equal(ma.role, 'guest'); assert.equal(ma.room, mb.room);
  const outsider = await signup(t), O = await Client.open(t, outsider.token);
  O.send({ op: 'join', room: ma.room });
  assert.match((await O.wait('error')).msg, /private/);
  A.send({ op: 'join', room: ma.room }); // waits for the host to claim
  await new Promise(r => setTimeout(r, 100));
  assert.ok(!A.msgs.some(m => m.op === 'joined'), 'guest is held until the host claims');
  B.send({ op: 'host', claim: mb.room });
  assert.equal((await B.wait('hosted')).room, mb.room);
  assert.equal((await A.wait('joined')).ranked, true);
  assert.equal((await B.wait('peer')).uid, a.id);
  A.close(); B.close(); O.close();
});

test('unverified email accounts cannot host or join', async () => {
  const u = await signup(t, { verify: false });
  const C = await Client.open(t, u.token);
  C.send({ op: 'host' });
  assert.equal((await C.wait('error')).code, 'verify');
  C.close();
});

test('maintenance mode and minimum version turn players away', async () => {
  const u = await signup(t);
  await t.ctx.db.query(`insert into remote_config (key, value) values ('minClientVersion', '"99.0.0"')`);
  const c = new (await import('ws')).WebSocket(`ws://127.0.0.1:${t.port}/ws`);
  const got: any[] = [];
  await new Promise(res => { c.on('open', () => c.send(JSON.stringify({ op: 'auth', token: u.token, version: '1.0.0' }))); c.on('message', d => got.push(JSON.parse(d.toString()))); c.on('close', res); });
  assert.equal(got[0].op, 'upgrade');
  await t.ctx.db.query(`delete from remote_config where key = 'minClientVersion'`);
});
