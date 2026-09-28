// Accounts and sessions.
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';
import type { Ctx, UserRow, Authed } from '../context.js';
import { HttpError, unauthorized } from '../context.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { nameKey, validateName } from '../lib/names.js';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP 2023 baseline for argon2id
export const hashPassword = (pw: string) => argonHash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => argonVerify(h, pw).catch(() => false);
export function checkPassword(pw: string) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use at least 10 characters for your password.', 'weak_password');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.', 'weak_password');
  if (/^(.)\1+$/.test(pw) || /^(?:0123456789|1234567890|password|qwertyuiop)/i.test(pw)) throw new HttpError(400, 'That password is too easy to guess.', 'weak_password');
}
export const normEmail = (e: string) => String(e || '').trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(e);

const ADJ = ['Drifting', 'Pale', 'Hollow', 'Deep', 'Brass', 'Tidal', 'Silent', 'Gilded', 'Umber', 'Vast', 'Sunken', 'Luminous'];
const NOUN = ['Tender', 'Lantern', 'Cantor', 'Lancer', 'Tether', 'Petalmaw', 'Nautilus', 'Medusa', 'Spire', 'Frond', 'Siphon', 'Colossus'];
export async function uniqueName(ctx: Ctx, wanted?: string | null): Promise<string> {
  if (wanted) {
    const v = validateName(wanted);
    if (v.ok && !(await ctx.db.one('select 1 from users where name_key = $1', [nameKey(v.name)]))) return v.name;
  }
  for (let i = 0; i < 40; i++) {
    const n = `${ADJ[randomInt(ADJ.length)]}${NOUN[randomInt(NOUN.length)]}${randomInt(10, 999)}`.slice(0, 18);
    if (!(await ctx.db.one('select 1 from users where name_key = $1', [nameKey(n)]))) return n;
  }
  return 'Drifter' + randomInt(100000, 999999);
}

export async function createUser(ctx: Ctx, o: { email?: string | null; password?: string | null; name?: string | null; verified?: boolean; ageBand?: string | null }): Promise<UserRow> {
  const name = await uniqueName(ctx, o.name);
  const ph = o.password ? await hashPassword(o.password) : null;
  const row = await ctx.db.one<UserRow>(
    `insert into users (display_name, name_key, email, email_verified, password_hash, age_band, chat) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [name, nameKey(name), o.email ?? null, !!o.verified, ph, o.ageBand ?? null, o.ageBand === '13-15' ? 'quick' : 'all']);
  await bump(ctx, 'signups');
  return row!;
}

export async function bump(ctx: Ctx, key: string, n = 1) {
  await ctx.db.query(`insert into daily_stats (day, key, value) values (current_date, $1, $2) on conflict (day, key) do update set value = daily_stats.value + $2`, [key, n]);
}

// ── sessions ─────────────────────────────────────────────────────
const TTL = { web: 30, game: 90 }; // days, sliding
export async function createSession(ctx: Ctx, userId: string, kind: 'web' | 'game', client: string, mfa: boolean) {
  const token = randomToken(32), id = sha256(token);
  await ctx.db.query(`insert into sessions (id, user_id, kind, client, mfa, expires_at) values ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`, [id, userId, kind, client.slice(0, 40), mfa, String(TTL[kind])]);
  await ctx.db.query('update users set last_seen_at = now() where id = $1', [userId]);
  return { token, id };
}
export async function sessionUser(ctx: Ctx, token: string | undefined): Promise<(Authed & { kind: string }) | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const row = await ctx.db.one<any>(`select s.id as sid, s.kind, s.mfa, s.last_used_at, s.expires_at, u.* from sessions s join users u on u.id = s.user_id where s.id = $1 and s.expires_at > now()`, [id]);
  if (!row) return null;
  if (row.status === 'deleted' || row.status === 'banned') return null;
  // slide the expiry at most hourly to keep writes low
  if (Date.now() - new Date(row.last_used_at).getTime() > 3600e3) {
    await ctx.db.query(`update sessions set last_used_at = now(), expires_at = now() + ($2 || ' days')::interval where id = $1`, [id, String(TTL[row.kind as 'web' | 'game'])]);
    await ctx.db.query('update users set last_seen_at = now() where id = $1', [row.id]);
  }
  const { sid, kind, mfa, last_used_at, expires_at, ...user } = row;
  void last_used_at; void expires_at;
  return { user: await effective(ctx, user as UserRow), sessionId: sid, via: 'bearer', mfa, kind };
}
export const revokeSession = (ctx: Ctx, sid: string) => ctx.db.query('delete from sessions where id = $1', [sid]);
export const revokeAll = (ctx: Ctx, userId: string, except?: string) => ctx.db.query('delete from sessions where user_id = $1 and id <> $2', [userId, except || '']);

// Lift expired suspensions lazily.
export async function effective(ctx: Ctx, u: UserRow): Promise<UserRow> {
  if (u.status === 'suspended' && u.suspended_until && new Date(u.suspended_until).getTime() <= ctx.now()) {
    await ctx.db.query(`update users set status = 'active', suspended_until = null where id = $1`, [u.id]);
    return { ...u, status: 'active', suspended_until: null };
  }
  return u;
}
export function assertCanPlay(u: UserRow) {
  if (u.status === 'suspended') throw new HttpError(403, `Your account is suspended until ${new Date(u.suspended_until!).toUTCString()}.`, 'suspended');
  if (u.status !== 'active') throw unauthorized('This account cannot sign in.');
}

// ── entitlements ─────────────────────────────────────────────────
export interface Entitlements { subscriber: boolean; until: string | null; status: string | null; cancelAtPeriodEnd: boolean; freeMatchMinutes: number; lifetime: boolean; source: 'stripe' | 'promo' | 'gift' | 'play' | 'staff' | null; billing: boolean; platform: string | null }
// Entitlements are per platform (docs/MONETIZATION.md): a store subscription counts
// only on its own platform; Stripe, promo codes and gifts (platform null) count
// everywhere. `platform` is the client asking ('android', 'ios', 'web'…); '*' is the
// staff view, which sees every source.
export async function entitlements(ctx: Ctx, u: UserRow, platform?: string): Promise<Entitlements> {
  const scope = platform === '*' ? 'true' : `(platform is null or platform = $2)`;
  const sub = await ctx.db.one<any>(`select id, status, current_period_end, cancel_at_period_end, platform from subscriptions where user_id = $1 and ${scope}
    order by (status in ('active', 'trialing', 'past_due') and current_period_end > now()) desc, current_period_end desc nulls last limit 1`, platform === '*' ? [u.id] : [u.id, platform || '']);
  const billing = !!(await ctx.db.one(`select 1 from subscriptions where user_id = $1 and id like 'sub\\_%'`, [u.id]));
  const end = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
  // active or trialing while paid up; past_due keeps access for a three-day grace
  const paid = !!sub && ((['active', 'trialing'].includes(sub.status) && end > ctx.now()) || (sub.status === 'past_due' && end + 3 * 864e5 > ctx.now()));
  const staff = u.role !== 'player';
  const free = await freeMinutes(ctx);
  const lifetime = paid && end >= Date.UTC(9999, 0, 1);
  const id = String(sub?.id || '');
  const source = paid ? (id.startsWith('promo_') ? 'promo' : id.startsWith('comp_') ? 'gift' : id.startsWith('gp_') ? 'play' : 'stripe') : staff ? 'staff' : null;
  return { subscriber: paid || staff, until: sub?.current_period_end ? new Date(sub.current_period_end).toISOString() : null, status: sub?.status ?? null, cancelAtPeriodEnd: !!sub?.cancel_at_period_end, freeMatchMinutes: free, lifetime, source, billing, platform: sub?.platform ?? null };
}
export async function freeMinutes(ctx: Ctx): Promise<number> {
  const r = await ctx.db.one<any>(`select value from remote_config where key = 'freeMatchMinutes'`);
  return typeof r?.value === 'number' ? r.value : ctx.cfg.FREE_MATCH_MINUTES;
}

// ── MFA challenge: short-lived, encrypted, bound to one user ─────
export const mfaChallenge = (ctx: Ctx, userId: string, kind: 'web' | 'game') => ctx.secrets.encrypt(JSON.stringify({ u: userId, k: kind, e: ctx.now() + 5 * 60e3 }));
export function readChallenge(ctx: Ctx, ch: string): { u: string; k: 'web' | 'game' } | null {
  try { const o = JSON.parse(ctx.secrets.decrypt(ch)); return o.e > ctx.now() ? o : null; } catch { return null; }
}

export function publicUser(u: UserRow) {
  return { id: u.id, name: u.display_name, role: u.role, status: u.status, rating: u.rating, matches: u.matches, wins: u.wins, createdAt: u.created_at };
}
