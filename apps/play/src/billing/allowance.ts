// SPDX-License-Identifier: AGPL-3.0-only
// The free online allowance (docs/MONETIZATION.md, "The allowance"):
//  • a rolling 24-hour window, not local midnight;
//  • one match, however long it runs: there is no time limit inside a match;
//  • counted when the match actually starts (not when a lobby opens or a queue is
//    entered), so a failed start or a host who vanishes in the lobby burns nothing;
//  • per account, whichever side of the match the player is on, counted once;
//  • members are not counted at all, and LAN matches never reach this service.
// The service is the only one that counts (it sees every start); the signed ticket
// tells every player how many free matches each has left, not a deadline.
import type { Ctx } from '../context.js';

export interface Allowance { perDay: number; used: number; left: number; nextAt: string | null }
const WINDOW_H = 24;

export async function freeMatchesPerDay(ctx: Ctx): Promise<number> {
  const r = await ctx.db.one<any>(`select value from remote_config where key = 'freeMatchesPerDay'`);
  return typeof r?.value === 'number' ? r.value : ctx.cfg.FREE_MATCHES_PER_DAY;
}

export async function allowance(ctx: Ctx, userId: string): Promise<Allowance> {
  const perDay = await freeMatchesPerDay(ctx);
  const rows = await ctx.db.query<{ at: string | Date }>(`select counted_at as at from match_players where user_id = $1 and free_used and counted_at > now() - make_interval(hours => $2) order by counted_at`, [userId, WINDOW_H]);
  const left = Math.max(0, perDay - rows.length);
  // when the oldest counted match leaves the window, one comes back
  const frees = perDay > 0 && left === 0 ? rows[rows.length - perDay] : null;
  const nextAt = frees ? new Date(new Date(frees.at).getTime() + WINDOW_H * 3600e3).toISOString() : null;
  return { perDay, used: rows.length, left, nextAt };
}

// Record a player in a match that has started. Idempotent per (match, player):
// rejoining the same match after a dropped link never counts twice.
export async function countPlayer(ctx: Ctx, matchId: string, userId: string, slot: number, member: boolean): Promise<boolean> {
  const row = await ctx.db.one(`insert into match_players (match_id, user_id, slot, counted_at, free_used) values ($1, $2, $3, now(), $4)
    on conflict (match_id, user_id) do nothing returning 1`, [matchId, userId, slot, !member]);
  return !!row;
}

export function allowanceMessage(a: Allowance): string {
  const when = a.nextAt ? new Date(a.nextAt) : null;
  const next = when ? ` Your next free match is ${when.getTime() - Date.now() < 3600e3 ? 'in under an hour' : `at ${when.toUTCString().slice(17, 22)} UTC`}.` : '';
  return `You have played today's free online match (${a.perDay} every 24 hours).${next} Membership makes online play unlimited. Games on your local network are always free.`;
}
