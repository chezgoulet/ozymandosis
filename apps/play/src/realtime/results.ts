// Match results. Every player's client reports what it saw (a claim); the
// service settles the match from all of them, and only results everyone agrees
// on count. Ranked ratings move only for confirmed, full, long-enough results
// between players who have not already played each other too often today.
//
// Claim kinds:
//   final         the match ended; results for every player (+ a guest's audit of the host)
//   forfeit       I quit before the end (a loss for me, by my own word)
//   disconnected  I lost the match connection before the end (I do not accept a loss)
//
// Settlement (when everyone has claimed, or SETTLE_AFTER_S after the first claim):
//   - finals must agree on every player's result, except forfeiters (always a loss);
//   - a player who claimed "disconnected" and would be given a loss disputes it;
//   - a player who never claimed accepts the others' account (leaving is losing);
//   - a guest's audit that found tampering disputes the match and flags the host;
//   - with no finals, a lone non-forfeiter wins; a host that vanished without a word
//     while its guests lost the connection abandoned the match; otherwise it is void.
import type { Ctx } from '../context.js';
import { bump } from '../auth/service.js';

export const SETTLE_AFTER_S = 90;
export const RATED_MIN_S = 120;         // shorter ranked matches are recorded but not rated
export const PAIR_CAP_PER_DAY = 3;      // rated matches between the same players per 24 h
export const DISPUTE_FLAG = { count: 3, days: 7 };
const K = 24;

type Result = 'win' | 'loss' | 'draw';
export interface Audit { verdict: 'ok' | 'drift' | 'tamper' | 'unverified'; windows: number; reasons: string[] }
export interface Claim { kind: 'final' | 'forfeit' | 'disconnected'; results?: { uid: string; result: Result }[]; winnerTeam?: number | null; audit?: Audit; at: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (m: any, members: Set<string>): Omit<Claim, 'at'> | null => {
  const kind = m?.kind ?? 'final';
  if (!['final', 'forfeit', 'disconnected'].includes(kind)) return null;
  const out: Omit<Claim, 'at'> = { kind };
  if (kind === 'final') {
    if (!Array.isArray(m.results)) return null;
    const seen = new Set<string>();
    out.results = [];
    for (const r of m.results.slice(0, 6)) {
      if (!r || typeof r.uid !== 'string' || !members.has(r.uid) || seen.has(r.uid) || !['win', 'loss', 'draw'].includes(r.result)) continue;
      seen.add(r.uid); out.results.push({ uid: r.uid, result: r.result });
    }
    out.winnerTeam = Number.isInteger(m.winnerTeam) ? m.winnerTeam : null;
  }
  if (m.audit && typeof m.audit === 'object' && ['ok', 'drift', 'tamper', 'unverified'].includes(m.audit.verdict)) {
    out.audit = { verdict: m.audit.verdict, windows: Math.max(0, Math.min(10, Number(m.audit.windows) || 0)), reasons: (Array.isArray(m.audit.reasons) ? m.audit.reasons : []).slice(0, 12).map((s: unknown) => String(s).slice(0, 200)) };
  }
  return out;
};

// Record one player's claim (once per player per match). Returns true when every player has claimed.
export async function recordClaim(ctx: Ctx, uid: string, m: any): Promise<{ ok: boolean; complete: boolean; match?: string }> {
  const mid = String(m?.match || '');
  if (!UUID.test(mid)) return { ok: false, complete: false };
  const members = new Set((await ctx.db.query<{ user_id: string }>('select user_id from match_players where match_id = $1', [mid])).map(r => r.user_id));
  if (!members.has(uid)) return { ok: false, complete: false };
  const c = clean(m, members); if (!c) return { ok: false, complete: false };
  const claim: Claim = { ...c, at: new Date(ctx.now()).toISOString() };
  const row = await ctx.db.one<{ claims: Record<string, Claim> }>(
    `update matches set claims = claims || jsonb_build_object($2::text, $3::jsonb), first_claim_at = coalesce(first_claim_at, now())
     where id = $1 and status = 'open' and not (claims ? $2::text) returning claims`, [mid, uid, JSON.stringify(claim)]);
  if (!row) return { ok: false, complete: false, match: mid };
  return { ok: true, complete: Object.keys(row.claims).length >= members.size, match: mid };
}

export interface Settled { match: string; status: 'confirmed' | 'disputed' | 'void'; rated: boolean; players: { uid: string; result: Result | null; delta: number }[]; reason?: string }

export async function settle(ctx: Ctx, mid: string): Promise<Settled | null> {
  const done = await ctx.db.tx(async t => {
    const m = await t.one<any>(`select id, mode, host_id, started_at, claims, status from matches where id = $1 for update`, [mid]);
    if (!m || m.status !== 'open') return null;
    const players = (await t.query<{ user_id: string }>('select user_id from match_players where match_id = $1 order by slot', [mid])).map(r => r.user_id);
    const claims: Record<string, Claim> = m.claims || {};
    const forfeit = new Set(Object.entries(claims).filter(([, c]) => c.kind === 'forfeit').map(([u]) => u));
    const finals = Object.values(claims).filter(c => c.kind === 'final');
    const audits = Object.values(claims).map(c => c.audit).filter(Boolean) as Audit[];
    const tamper = audits.filter(a => a.verdict === 'tamper');
    const result = new Map<string, Result>();
    let status: Settled['status'] = 'confirmed', reason = '';
    if (finals.length) {
      for (const u of players) {
        if (forfeit.has(u)) { result.set(u, 'loss'); continue; }
        const said = new Set(finals.map(c => c.results?.find(r => r.uid === u)?.result).filter(Boolean) as Result[]);
        if (said.size > 1) { status = 'disputed'; reason = 'players reported different results'; }
        const r = [...said][0]; if (r) result.set(u, r);
        if (claims[u]?.kind === 'disconnected' && r === 'loss') { status = 'disputed'; reason = 'a player lost the connection and did not accept the loss'; }
      }
      if (tamper.length) { status = 'disputed'; reason = 'a player\'s check of the host found tampering'; }
    } else {
      const stay = players.filter(u => !forfeit.has(u));
      const lostHost = m.host_id && !claims[m.host_id] && players.some(u => u !== m.host_id && claims[u]?.kind === 'disconnected');
      for (const u of forfeit) result.set(u, 'loss');
      if (stay.length === 1 && forfeit.size) result.set(stay[0], 'win');
      else if (lostHost) {
        // the host vanished and never reported: it abandoned the match (a duel goes to the guest)
        result.set(m.host_id, 'loss');
        const rest = players.filter(u => u !== m.host_id && !forfeit.has(u));
        if (rest.length === 1) result.set(rest[0], 'win');
      } else { status = 'void'; reason = 'no one reported an ending'; }
    }
    if (status === 'disputed') result.clear();
    const elapsed = Math.max(0, Math.round((ctx.now() - new Date(m.started_at).getTime()) / 1000));
    const ranked = String(m.mode).startsWith('ranked:');
    let rated = ranked && status === 'confirmed' && players.every(u => result.has(u)) && [...result.values()].includes('win') && [...result.values()].includes('loss') && elapsed >= RATED_MIN_S;
    if (rated) {
      // anti-boosting: the same group of players is rated only a few times a day
      const same = await t.one<{ n: string }>(`select count(*)::text as n from matches m where m.rated and m.settled_at > now() - interval '1 day'
        and (select array_agg(user_id order by user_id) from match_players where match_id = m.id) = (select array_agg(user_id order by user_id) from match_players where match_id = $1)`, [mid]);
      if (Number(same?.n || 0) >= PAIR_CAP_PER_DAY) { rated = false; reason = 'these players were already rated against each other today'; }
    }
    const winnerTeam = finals.find(c => c.winnerTeam !== undefined)?.winnerTeam ?? null;
    const verdict = tamper.length ? 'tamper' : audits.some(a => a.verdict === 'ok' || a.verdict === 'drift') ? 'verified' : audits.length ? 'unverified' : null;
    await t.query(`update matches set status = $2, rated = $3, settled_at = now(), ended_at = coalesce(ended_at, now()), duration_s = $4, winner_team = $5, verdict = $6 where id = $1`, [mid, status, rated, elapsed, status === 'confirmed' ? winnerTeam : null, verdict]);
    const deltas = new Map<string, number>();
    if (status === 'confirmed') {
      const rows: { uid: string; won: boolean; rating: number }[] = [];
      for (const [u, r] of result) {
        await t.query('update match_players set result = $3 where match_id = $1 and user_id = $2', [mid, u, r]);
        const x = await t.one<{ rating: number }>('update users set matches = matches + 1, wins = wins + $2 where id = $1 returning rating', [u, r === 'win' ? 1 : 0]);
        if (x) rows.push({ uid: u, won: r === 'win', rating: x.rating });
      }
      if (rated) {
        // every winner against the average loser, and vice versa
        const avg = (a: typeof rows) => a.reduce((s, r) => s + r.rating, 0) / a.length;
        const W = rows.filter(r => r.won), Lo = rows.filter(r => !r.won), aw = avg(W), al = avg(Lo);
        for (const r of W) deltas.set(r.uid, Math.round(K * (1 - 1 / (1 + Math.pow(10, (al - r.rating) / 400)))));
        for (const r of Lo) deltas.set(r.uid, -Math.round(K * (1 / (1 + Math.pow(10, (aw - r.rating) / 400)))));
        for (const [u, d] of deltas) {
          await t.query('update users set rating = greatest(100, rating + $2) where id = $1', [u, d]);
          await t.query('update match_players set rating_delta = $3 where match_id = $1 and user_id = $2', [mid, u, d]);
        }
      }
    }
    return { m, players, status, rated, reason, result, deltas, tamper };
  });
  if (!done) return null;
  await bump(ctx, done.status === 'confirmed' ? 'matches_confirmed' : done.status === 'disputed' ? 'matches_disputed' : 'matches_void');
  if (done.status === 'disputed') await flagDisputes(ctx, done.m, done.players, done.tamper);
  return { match: mid, status: done.status, rated: done.rated, reason: done.reason || undefined, players: done.players.map(u => ({ uid: u, result: done.result.get(u) ?? null, delta: done.deltas.get(u) ?? 0 })) };
}

// Disputes become moderator work: tampering flags the host at once (with the
// guest's evidence); anyone in several disputes in a week is flagged too.
async function flagDisputes(ctx: Ctx, m: any, players: string[], tamper: Audit[]) {
  const file = async (target: string, details: string) => {
    const open = await ctx.db.one(`select 1 from player_reports where target_id = $1 and reporter_id is null and status = 'open' and reason = 'cheating'`, [target]);
    if (open) { await ctx.db.query(`update player_reports set details = left(details || E'\\n' || $2, 4000) where target_id = $1 and reporter_id is null and status = 'open' and reason = 'cheating'`, [target, details]); return; }
    await ctx.db.query(`insert into player_reports (reporter_id, target_id, reason, details, match_id) values (null, $1, 'cheating', $2, $3)`, [target, details.slice(0, 4000), m.id]);
  };
  if (tamper.length && m.host_id) await file(m.host_id, `Automatic: a guest's check of this host's match found tampering (match ${m.id}). ${tamper.flatMap(a => a.reasons).slice(0, 6).join('; ')}`);
  for (const u of players) {
    const n = await ctx.db.one<{ n: string }>(`select count(*)::text as n from matches m join match_players mp on mp.match_id = m.id where mp.user_id = $1 and m.status = 'disputed' and m.settled_at > now() - make_interval(days => $2)`, [u, DISPUTE_FLAG.days]);
    if (Number(n?.n || 0) >= DISPUTE_FLAG.count) await file(u, `Automatic: ${n!.n} disputed match results in ${DISPUTE_FLAG.days} days (latest ${m.id}).`);
  }
}

// Matches whose settle window has passed.
export async function dueMatches(ctx: Ctx): Promise<string[]> {
  return (await ctx.db.query<{ id: string }>(`select id from matches where status = 'open' and first_claim_at < now() - make_interval(secs => $1) limit 100`, [SETTLE_AFTER_S])).map(r => r.id);
}
