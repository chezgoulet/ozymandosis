// SPDX-License-Identifier: AGPL-3.0-only
// Email accounts: sign up, sign in (with TOTP when enabled), verify, reset,
// sign out, and the browser hand-off that signs game clients in.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx, UserRow } from '../context.js';
import { bad, HttpError, tooMany, unauthorized } from '../context.js';
import { SESSION_COOKIE, requireUser, audit } from '../app.js';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { randomToken, sha256 } from '../lib/crypto.js';
import { Limiter } from '../lib/limiter.js';
import { coarseClient } from '../lib/privacy.js';
import { templates } from '../lib/mail.js';
import { ageFrom, bandOf } from '../lib/age.js';
import { verifyTotp } from '../lib/totp.js';
import { checkPassword, createSession, createUser, hashPassword, mfaChallenge, normEmail, readChallenge, revokeAll, revokeSession, validEmail, verifyPassword, assertCanPlay, bump } from './service.js';

const loginIp = new Limiter(30, 15 * 60e3), loginAcct = new Limiter(10, 15 * 60e3), signupIp = new Limiter(10, 60 * 60e3), mailAcct = new Limiter(3, 60 * 60e3), mfaAcct = new Limiter(8, 15 * 60e3);
const handoffIp = new Limiter(20, 15 * 60e3), handoffAcct = new Limiter(10, 15 * 60e3);
// Letters and digits only, 0/O and 1/I removed: this is read off a screen and typed.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function handoffCode(): string { let s = ''; for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]; return s; }
const Client = z.enum(['web', 'game']).default('web');
// A real hash to verify against when an account does not exist, so response time does not reveal it.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ||= hashPassword('no-account-has-this-password-' + Math.random()));

export async function issueSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, user: UserRow, client: 'web' | 'game', mfa: boolean) {
  assertCanPlay(user);
  const kind = client === 'game' ? 'game' : 'web';
  const s = await createSession(ctx, user.id, kind, coarseClient(req.headers['user-agent']), mfa);
  await bump(ctx, 'signins');
  if (kind === 'web') {
    reply.setCookie(SESSION_COOKIE, s.token, { httpOnly: true, secure: ctx.cfg.prod, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return { ok: true };
  }
  return { ok: true, token: s.token };
}
// Approving a hand-off is an explicit act, not a side effect of opening a link: the
// signed-in browser must type the code the requesting client was shown. A wrong or
// missing code changes nothing.
export async function approveHandoff(ctx: Ctx, handoff: string, userId: string, code: string): Promise<boolean> {
  const row = await ctx.db.one<any>(`select user_code from login_handoffs where id = $1 and expires_at > now() and claimed_at is null`, [handoff]);
  if (!row || !row.user_code) return false;
  const want = Buffer.from(String(row.user_code)), got = Buffer.from(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  await ctx.db.query(`update login_handoffs set user_id = $2 where id = $1 and expires_at > now() and claimed_at is null`, [handoff, userId]);
  return true;
}

async function captchaOk(ctx: Ctx, token: string | undefined): Promise<boolean> {
  if (!ctx.cfg.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: ctx.cfg.TURNSTILE_SECRET, response: token }) });
    return !!((await r.json()) as any).success;
  } catch { return false; }
}

export async function sendVerify(ctx: Ctx, user: { id: string; email: string | null }) {
  if (!user.email) return;
  const t = randomToken(24);
  await ctx.db.query(`insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'verify', now() + interval '24 hours')`, [sha256(t), user.id]);
  await ctx.mail.send({ to: user.email, ...templates.verify(`${ctx.cfg.PUBLIC_URL}/verify?token=${t}`) });
}

export default async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  // per-network limits; the test suite runs every client from one address, so it lifts them
  const ipKey = (req: FastifyRequest) => ctx.cfg.test ? 'test:' + Math.random() : ctx.secrets.pseudonym('ip:' + (req.ip || ''), 16);

  app.post('/api/auth/signup', async (req, reply) => {
    const b = z.object({ email: z.string(), password: z.string(), name: z.string().optional(), client: Client, captcha: z.string().optional(),
      birthYear: z.number().int().optional(), birthMonth: z.number().int().optional() }).parse(req.body);
    if (!signupIp.take(ipKey(req))) throw tooMany();
    const age = ageFrom(b.birthYear ?? NaN, b.birthMonth ?? NaN);
    if (age === null) throw bad('Please tell us the month and year you were born.', 'age');
    const band = bandOf(age);
    // under 13: no account, and nothing about them is kept
    if (!band) throw new HttpError(403, 'Sorry, you need to be 13 or older to make an account. You can still play offline and on your local network.', 'underage');
    if (!(await captchaOk(ctx, b.captcha))) throw bad('Please complete the check that you are human.', 'captcha');
    const email = normEmail(b.email);
    if (!validEmail(email)) throw bad('That email address does not look right.', 'email');
    checkPassword(b.password);
    const exists = await ctx.db.one('select 1 from users where email = $1', [email]);
    // Same answer either way would be kinder to privacy, but players need to know; rate limits cover enumeration.
    if (exists) throw new HttpError(409, 'An account with that email already exists. Try signing in.', 'exists');
    let user;
    try { user = await createUser(ctx, { email, password: b.password, name: b.name, ageBand: band }); }
    catch (e: any) { if (e?.code === '23505') throw new HttpError(409, 'An account with that email already exists. Try signing in.', 'exists'); throw e; }
    await sendVerify(ctx, user);
    const out = await issueSession(ctx, req, reply, user, b.client, false);
    return { ...out, name: user.display_name, verifyEmail: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = z.object({ email: z.string(), password: z.string(), client: Client }).parse(req.body);
    const email = normEmail(b.email), ak = ctx.secrets.pseudonym('acct:' + email, 16);
    if (!loginIp.take(ipKey(req)) || !loginAcct.take(ak)) throw tooMany();
    const user = await ctx.db.one<UserRow>('select * from users where email = $1', [email]);
    // verify against a dummy hash when the account is missing so timing does not reveal it
    const ok = user?.password_hash ? await verifyPassword(user.password_hash, b.password) : (await verifyPassword(await dummy(), b.password), false);
    if (!user || !ok) throw unauthorized('That email and password do not match.');
    if (user.status === 'banned') throw new HttpError(403, 'This account has been banned.', 'banned');
    if (user.status === 'deleted') throw unauthorized('That email and password do not match.');
    loginAcct.reset(ak);
    if (user.totp_enabled) return { mfa: 'required', challenge: mfaChallenge(ctx, user.id, b.client) };
    return issueSession(ctx, req, reply, user, b.client, false);
  });

  app.post('/api/auth/mfa', async (req, reply) => {
    const b = z.object({ challenge: z.string(), code: z.string().optional(), recovery: z.string().optional() }).parse(req.body);
    const ch = readChallenge(ctx, b.challenge);
    if (!ch) throw unauthorized('That sign-in took too long. Please start again.');
    if (!mfaAcct.take(ch.u)) throw tooMany();
    const user = await ctx.db.one<UserRow>('select * from users where id = $1', [ch.u]);
    if (!user || !user.totp_enabled || !user.totp_secret_enc) throw unauthorized();
    if (b.recovery) {
      const code = b.recovery.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const hit = await ctx.db.one(`update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning 1`, [user.id, sha256(code)]);
      if (!hit) throw unauthorized('That recovery code is not valid.');
    } else {
      const step = verifyTotp(ctx.secrets.decrypt(user.totp_secret_enc), b.code || '', user.totp_last_step === null ? null : Number(user.totp_last_step), ctx.now());
      if (step === null) throw unauthorized('That code is not right. Check the time on your phone and try again.');
      await ctx.db.query('update users set totp_last_step = $2 where id = $1', [user.id, step]);
    }
    mfaAcct.reset(ch.u);
    return issueSession(ctx, req, reply, user, ch.k, true);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await revokeSession(ctx, req.auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/verify', async req => {
    const b = z.object({ token: z.string() }).parse(req.body);
    const row = await ctx.db.one<any>(`update email_tokens set used_at = now() where token_hash = $1 and purpose = 'verify' and used_at is null and expires_at > now() returning user_id`, [sha256(b.token)]);
    if (!row) throw bad('That link has expired or was already used.', 'expired');
    await ctx.db.query('update users set email_verified = true where id = $1', [row.user_id]);
    ctx.hub.refreshUser(row.user_id);
    return { ok: true };
  });
  app.post('/api/auth/resend-verify', async req => {
    const a = requireUser(req);
    if (a.user.email_verified || !a.user.email) return { ok: true };
    if (!mailAcct.take('v:' + a.user.id)) throw tooMany();
    await sendVerify(ctx, a.user);
    return { ok: true };
  });

  app.post('/api/auth/forgot', async req => {
    const b = z.object({ email: z.string() }).parse(req.body);
    const email = normEmail(b.email);
    if (!mailAcct.take('f:' + ctx.secrets.pseudonym(email)) || !loginIp.take(ipKey(req))) throw tooMany();
    const user = await ctx.db.one<any>(`select id, email from users where email = $1 and status in ('active', 'suspended')`, [email]);
    if (user) {
      const t = randomToken(24);
      await ctx.db.query(`insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset', now() + interval '1 hour')`, [sha256(t), user.id]);
      await ctx.mail.send({ to: user.email, ...templates.reset(`${ctx.cfg.PUBLIC_URL}/reset?token=${t}`) });
    }
    return { ok: true }; // same answer whether or not the account exists
  });
  app.post('/api/auth/reset', async req => {
    const b = z.object({ token: z.string(), password: z.string() }).parse(req.body);
    checkPassword(b.password);
    const row = await ctx.db.one<any>(`update email_tokens set used_at = now() where token_hash = $1 and purpose = 'reset' and used_at is null and expires_at > now() returning user_id`, [sha256(b.token)]);
    if (!row) throw bad('That link has expired or was already used.', 'expired');
    await ctx.db.query('update users set password_hash = $2, email_verified = true where id = $1', [row.user_id, await hashPassword(b.password)]);
    await revokeAll(ctx, row.user_id);
    return { ok: true };
  });

  // ── game client hand-off ──────────────────────────────────────
  // 1. the client makes a secret verifier and registers sha256(verifier)
  // 2. it is given a short code and opens PUBLIC_URL/login?handoff=<hash> in the browser
  // 3. the player signs in there, sees which client is asking, and types that code
  // 4. the client claims with the verifier and receives its own game session
  app.post('/api/auth/handoff', async req => {
    const b = z.object({ challenge: z.string().min(20).max(100) }).parse(req.body);
    if (!handoffIp.take(ipKey(req))) throw tooMany();
    const hint = coarseClient(req.headers['user-agent']);
    await ctx.db.query(`insert into login_handoffs (id, user_code, client_hint, expires_at) values ($1, $2, $3, now() + interval '10 minutes') on conflict (id) do nothing`, [b.challenge, handoffCode(), hint]);
    // a repeated challenge keeps its original code: an attacker cannot rotate a
    // code the player is part-way through approving, nor read it back on demand
    const row = await ctx.db.one<any>(`select user_code, client_hint from login_handoffs where id = $1 and claimed_at is null and expires_at > now()`, [b.challenge]);
    if (!row) throw bad('That sign-in could not be started. Please try again.', 'handoff');
    return { url: `${ctx.cfg.PUBLIC_URL}/login?handoff=${encodeURIComponent(b.challenge)}`, code: row.user_code, hint: row.client_hint, expiresInSec: 600 };
  });
  // Who is asking: shown to the signed-in player before they approve anything.
  app.get('/api/auth/handoff/:id', async req => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const row = await ctx.db.one<any>(`select client_hint, created_at, expires_at from login_handoffs where id = $1 and claimed_at is null and expires_at > now()`, [id]);
    if (!row) throw bad('That sign-in has expired. Ask the game to start again.', 'expired');
    return { hint: row.client_hint, startedAt: row.created_at, expiresAt: row.expires_at };
  });
  app.post('/api/auth/handoff/approve', async req => {
    const a = requireUser(req);
    const b = z.object({ handoff: z.string(), code: z.string().min(4).max(16) }).parse(req.body);
    assertCanPlay(a.user);
    if (!handoffAcct.take('h:' + a.user.id)) throw tooMany();
    if (!(await approveHandoff(ctx, b.handoff, a.user.id, b.code))) throw bad('That code does not match the one the game is showing.', 'code');
    await audit(ctx, a.user.id, 'auth.handoff_approve', null, { client: coarseClient(req.headers['user-agent']) });
    if (a.user.email) await ctx.mail.send({ to: a.user.email, ...templates.handoffApproved(coarseClient(req.headers['user-agent'])) });
    return { ok: true };
  });
  app.post('/api/auth/handoff/claim', async req => {
    const b = z.object({ verifier: z.string().min(20).max(200) }).parse(req.body);
    const id = sha256(b.verifier);
    const row = await ctx.db.one<any>(`select user_id, expires_at, claimed_at from login_handoffs where id = $1`, [id]);
    if (!row || row.claimed_at || new Date(row.expires_at).getTime() < ctx.now()) throw bad('That sign-in expired. Please try again.', 'expired');
    if (!row.user_id) return { pending: true };
    const claimed = await ctx.db.one(`update login_handoffs set claimed_at = now() where id = $1 and claimed_at is null returning 1`, [id]);
    if (!claimed) throw bad('That sign-in was already used.', 'expired');
    const user = await ctx.db.one<UserRow>('select * from users where id = $1', [row.user_id]);
    assertCanPlay(user!);
    const s = await createSession(ctx, user!.id, 'game', coarseClient(req.headers['user-agent']), user!.totp_enabled);
    return { ok: true, token: s.token };
  });
}
