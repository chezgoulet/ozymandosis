import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, type T } from './helpers.js';
import { recordClaim, settle, dueMatches, PAIR_CAP_PER_DAY } from '../src/realtime/results.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

// a started match between the given players, `ago` seconds old
async function match(uids: string[], opts: { ranked?: boolean; ago?: number } = {}) {
  const m = await t.ctx.db.one<any>(`insert into matches (code, mode, host_id, started_at) values ('TEST', $1, $2, now() - make_interval(secs => $3)) returning id`, [opts.ranked ? 'ranked:duel' : 'custom', uids[0], opts.ago ?? 600]);
  let slot = 0; for (const u of uids) await t.ctx.db.query('insert into match_players (match_id, user_id, slot) values ($1, $2, $3)', [m.id, u, slot++]);
  return m.id as string;
}
const final = (mid: string, res: [string, string][], audit?: object) => ({ match: mid, kind: 'final', winnerTeam: 0, results: res.map(([uid, result]) => ({ uid, result })), audit });
const rating = async (u: string) => (await t.ctx.db.one<any>('select rating from users where id = $1', [u])).rating as number;

test('agreeing ranked claims are confirmed and rated; the host alone cannot claim for others', async () => {
  const a = await signup(t), b = await signup(t), outsider = await signup(t);
  const mid = await match([a.id, b.id], { ranked: true });
  assert.equal((await recordClaim(t.ctx, outsider.id, final(mid, [[outsider.id, 'win']]))).ok, false, 'non-players cannot claim');
  const r1 = await recordClaim(t.ctx, a.id, final(mid, [[a.id, 'win'], [b.id, 'loss']]));
  assert.equal(r1.complete, false);
  assert.equal((await recordClaim(t.ctx, a.id, final(mid, [[a.id, 'win'], [b.id, 'loss']]))).ok, false, 'one claim per player');
  const r2 = await recordClaim(t.ctx, b.id, final(mid, [[a.id, 'win'], [b.id, 'loss']], { verdict: 'ok', windows: 3, reasons: [] }));
  assert.equal(r2.complete, true);
  const s = await settle(t.ctx, mid);
  assert.equal(s!.status, 'confirmed'); assert.equal(s!.rated, true);
  assert.ok(await rating(a.id) > 1200 && await rating(b.id) < 1200);
  assert.equal((await t.ctx.db.one<any>('select verdict from matches where id = $1', [mid])).verdict, 'verified');
});

test('contradicting claims are disputed and change nothing', async () => {
  const a = await signup(t), b = await signup(t);
  const mid = await match([a.id, b.id], { ranked: true });
  await recordClaim(t.ctx, a.id, final(mid, [[a.id, 'win'], [b.id, 'loss']]));
  await recordClaim(t.ctx, b.id, final(mid, [[a.id, 'loss'], [b.id, 'win']]));
  const s = await settle(t.ctx, mid);
  assert.equal(s!.status, 'disputed'); assert.equal(s!.rated, false);
  assert.equal(await rating(a.id), 1200); assert.equal(await rating(b.id), 1200);
  assert.equal((await t.ctx.db.one<any>('select wins, matches from users where id = $1', [a.id])).matches, 0);
});

test('a guest whose audit finds tampering disputes the match and the host is flagged with the evidence', async () => {
  const host = await signup(t), guest = await signup(t);
  const mid = await match([host.id, guest.id], { ranked: true });
  await recordClaim(t.ctx, host.id, final(mid, [[host.id, 'win'], [guest.id, 'loss']]));
  await recordClaim(t.ctx, guest.id, final(mid, [[host.id, 'win'], [guest.id, 'loss']], { verdict: 'tamper', windows: 3, reasons: ['window 1200: player 0 lumen 400 vs 5400'] }));
  const s = await settle(t.ctx, mid);
  assert.equal(s!.status, 'disputed');
  const rep = await t.ctx.db.one<any>(`select reason, details, reporter_id from player_reports where target_id = $1`, [host.id]);
  assert.equal(rep.reason, 'cheating'); assert.equal(rep.reporter_id, null); assert.match(rep.details, /lumen 400 vs 5400/);
});

test('leavers lose: silence accepts the others’ account, a forfeit is a loss, a lost connection contests it', async () => {
  const a = await signup(t), b = await signup(t), c = await signup(t), d = await signup(t);
  // b never claims: the settle window passes and a's account stands
  const m1 = await match([a.id, b.id], { ranked: true });
  await recordClaim(t.ctx, a.id, final(m1, [[a.id, 'win'], [b.id, 'loss']]));
  await t.ctx.db.query(`update matches set first_claim_at = now() - interval '10 minutes' where id = $1`, [m1]);
  assert.ok((await dueMatches(t.ctx)).includes(m1));
  assert.equal((await settle(t.ctx, m1))!.status, 'confirmed');
  // c forfeits a duel: d wins with no final at all
  const m2 = await match([c.id, d.id]);
  await recordClaim(t.ctx, c.id, { match: m2, kind: 'forfeit' });
  const s2 = await settle(t.ctx, m2);
  assert.equal(s2!.status, 'confirmed'); assert.deepEqual(s2!.players.map(p => p.result), ['loss', 'win']);
  // d lost the connection and the other side claims d lost: disputed
  const m3 = await match([c.id, d.id]);
  await recordClaim(t.ctx, c.id, final(m3, [[c.id, 'win'], [d.id, 'loss']]));
  await recordClaim(t.ctx, d.id, { match: m3, kind: 'disconnected' });
  assert.equal((await settle(t.ctx, m3))!.status, 'disputed');
});

test('ranked matches are rated only when long enough and not farmed between the same players', async () => {
  const a = await signup(t), b = await signup(t);
  const short = await match([a.id, b.id], { ranked: true, ago: 30 });
  for (const u of [a.id, b.id]) await recordClaim(t.ctx, u, final(short, [[a.id, 'win'], [b.id, 'loss']]));
  const s = await settle(t.ctx, short);
  assert.equal(s!.status, 'confirmed'); assert.equal(s!.rated, false, 'too short to rate');
  let rated = 0;
  for (let i = 0; i < PAIR_CAP_PER_DAY + 2; i++) {
    const mid = await match([a.id, b.id], { ranked: true });
    for (const u of [a.id, b.id]) await recordClaim(t.ctx, u, final(mid, [[a.id, 'win'], [b.id, 'loss']]));
    if ((await settle(t.ctx, mid))!.rated) rated++;
  }
  assert.equal(rated, PAIR_CAP_PER_DAY);
});

test('repeated disputes flag a player for review', async () => {
  const liar = await signup(t);
  for (let i = 0; i < 3; i++) {
    const other = await signup(t);
    const mid = await match([liar.id, other.id]);
    await recordClaim(t.ctx, liar.id, final(mid, [[liar.id, 'win'], [other.id, 'loss']]));
    await recordClaim(t.ctx, other.id, final(mid, [[liar.id, 'loss'], [other.id, 'win']]));
    await settle(t.ctx, mid);
  }
  const rep = await t.ctx.db.one<any>(`select details from player_reports where target_id = $1 and reporter_id is null`, [liar.id]);
  assert.match(rep.details, /3 disputed match results/);
});

test('moderators resolve a dispute by accepting one account', async () => {
  const mod = await signup(t); await t.ctx.db.query(`update users set role = 'moderator' where id = $1`, [mod.id]);
  const a = await signup(t), b = await signup(t);
  const mid = await match([a.id, b.id]);
  await recordClaim(t.ctx, a.id, final(mid, [[a.id, 'win'], [b.id, 'loss']]));
  await recordClaim(t.ctx, b.id, final(mid, [[a.id, 'loss'], [b.id, 'win']], { verdict: 'tamper', windows: 1, reasons: ['x'] }));
  await settle(t.ctx, mid);
  const list = await t.api('GET', '/api/admin/matches?status=disputed', undefined, mod.token);
  assert.ok(list.json.matches.some((m: any) => m.id === mid));
  assert.equal((await t.api('POST', `/api/admin/matches/${mid}/resolve`, { accept: a.id }, a.token)).status, 403, 'players cannot');
  const r = await t.api('POST', `/api/admin/matches/${mid}/resolve`, { accept: b.id }, mod.token);
  assert.equal(r.status, 200); assert.equal(r.json.result.status, 'confirmed');
  assert.equal((await t.ctx.db.one<any>('select wins from users where id = $1', [b.id])).wins, 1);
  assert.equal((await t.api('POST', `/api/admin/matches/${mid}/resolve`, { accept: a.id }, mod.token)).status, 400, 'only once');
});
