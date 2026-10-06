// The signed-in player's own account: profile, password, email, two-factor,
// sessions, data export and deletion.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, HttpError, unauthorized, tooMany } from '../context.js';
import { requireUser, SESSION_COOKIE, audit } from '../app.js';
import { sha256 } from '../lib/crypto.js';
import { Limiter } from '../lib/limiter.js';
import { newTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import { nameKey, validateName } from '../lib/names.js';
import { templates } from '../lib/mail.js';
import { checkPassword, entitlements, hashPassword, normEmail, publicUser, revokeAll, validEmail, verifyPassword } from './service.js';
import { sendVerify } from './routes.js';
import { ageFrom, bandOf, freeChatAllowed } from '../lib/age.js';

const renameLimit = new Limiter(3, 24 * 3600e3), stepUp = new Limiter(10, 15 * 60e3);

export default async function meRoutes(app: FastifyInstance, ctx: Ctx) {
  // Confirm a sensitive change with the password, or with a TOTP code for accounts without one.
  const confirm = async (userId: string, sessionId: string, b: { password?: string; code?: string }) => {
    if (!stepUp.take(userId)) throw tooMany();
    const u = await ctx.db.one<any>('select password_hash, totp_enabled, totp_secret_enc, totp_last_step from users where id = $1', [userId]);
    if (u.totp_enabled) {
      const step = verifyTotp(ctx.secrets.decrypt(u.totp_secret_enc), b.code || '', u.totp_last_step === null ? null : Number(u.totp_last_step), ctx.now());
      if (step === null) throw unauthorized('Enter the current code from your authenticator app.');
      await ctx.db.query('update users set totp_last_step = $2 where id = $1', [userId, step]);
    } else if (u.password_hash) {
      if (!b.password || !(await verifyPassword(u.password_hash, b.password))) throw unauthorized('That password is not right.');
    } else {
      // A provider-created account has neither a password nor a second factor on
      // file, so there is nothing here to check. Fail closed rather than open: the
      // one proof still available is that the account holder signed in with their
      // provider a moment ago.
      const s = await ctx.db.one<any>('select created_at from sessions where id = $1', [sessionId]);
      if (!s || ctx.now() - new Date(s.created_at).getTime() > 15 * 60e3) {
        throw new HttpError(403, 'For your safety, sign out and sign in again before changing this.', 'step_up');
      }
    }
  };

  app.get('/api/me', async req => {
    const a = requireUser(req), u = a.user;
    const ids = await ctx.db.query<any>('select provider, created_at from identities where user_id = $1', [u.id]);
    const sanction = await ctx.db.one<any>(`select kind, reason, until, created_at from sanctions where user_id = $1 and kind in ('warn', 'mute', 'suspend') order by created_at desc limit 1`, [u.id]);
    return {
      user: { ...publicUser(u), email: u.email, emailVerified: u.email_verified, hasPassword: !!u.password_hash, mfa: u.totp_enabled, crashReports: u.crash_reports, mutedUntil: u.muted_until, suspendedUntil: u.suspended_until,
        ageBand: u.age_band, needsAge: !u.age_band, chat: u.chat, freeChat: freeChatAllowed(u.age_band) },
      // the game says which platform it runs on; a store subscription only counts there
      entitlements: await entitlements(ctx, u, String((req.query as any)?.platform || '').slice(0, 20) || undefined),
      identities: ids.map(i => i.provider),
      notice: sanction && Date.now() - new Date(sanction.created_at).getTime() < 14 * 864e5 ? sanction : null,
      session: { mfa: a.mfa, via: a.via },
    };
  });

  app.patch('/api/me', async req => {
    const a = requireUser(req);
    const b = z.object({ name: z.string().optional(), crashReports: z.boolean().optional(), chat: z.enum(['all', 'quick', 'off']).optional() }).parse(req.body);
    if (b.chat !== undefined) {
      if (b.chat === 'all' && !freeChatAllowed(a.user.age_band)) throw bad('Free chat opens at 16. Quick chat is on for you.', 'age');
      await ctx.db.query('update users set chat = $2 where id = $1', [a.user.id, b.chat]);
    }
    if (b.name !== undefined && b.name !== a.user.display_name) {
      const v = validateName(b.name);
      if (!v.ok) throw bad(v.why, 'name');
      if (!renameLimit.take(a.user.id)) throw tooMany('You can change your name three times a day.');
      const taken = await ctx.db.one('select 1 from users where name_key = $1 and id <> $2', [nameKey(v.name), a.user.id]);
      if (taken) throw new HttpError(409, 'That name is taken.', 'taken');
      await ctx.db.query('update users set display_name = $2, name_key = $3 where id = $1', [a.user.id, v.name, nameKey(v.name)]);
    }
    if (b.crashReports !== undefined) await ctx.db.query('update users set crash_reports = $2 where id = $1', [a.user.id, b.crashReports]);
    ctx.hub.refreshUser(a.user.id);
    return { ok: true };
  });

  app.post('/api/me/password', async req => {
    const a = requireUser(req);
    const b = z.object({ current: z.string().optional(), next: z.string(), code: z.string().optional() }).parse(req.body);
    checkPassword(b.next);
    await confirm(a.user.id, a.sessionId, { password: b.current, code: b.code });
    await ctx.db.query('update users set password_hash = $2 where id = $1', [a.user.id, await hashPassword(b.next)]);
    await revokeAll(ctx, a.user.id, a.sessionId);
    return { ok: true };
  });

  app.post('/api/me/email', async req => {
    const a = requireUser(req);
    const b = z.object({ email: z.string(), password: z.string().optional(), code: z.string().optional() }).parse(req.body);
    const email = normEmail(b.email);
    if (!validEmail(email)) throw bad('That email address does not look right.');
    await confirm(a.user.id, a.sessionId, b);
    if (await ctx.db.one('select 1 from users where email = $1 and id <> $2', [email, a.user.id])) throw new HttpError(409, 'That email is already in use.', 'exists');
    const previous = a.user.email;
    await ctx.db.query('update users set email = $2, email_verified = false where id = $1', [a.user.id, email]);
    // tell the address that is losing the account: a silent change must be impossible
    if (previous && previous !== email) await ctx.mail.send({ to: previous, ...templates.emailChanged(email) });
    await sendVerify(ctx, { id: a.user.id, email });
    return { ok: true };
  });

  // ── two-factor (TOTP) ─────────────────────────────────────────
  app.post('/api/me/mfa/setup', async req => {
    const a = requireUser(req);
    if (a.user.totp_enabled) throw bad('Two-factor sign-in is already on.');
    if (!a.user.email) throw bad('Add an email address to your account first.');
    const secret = newTotpSecret();
    await ctx.db.query('update users set totp_secret_enc = $2 where id = $1', [a.user.id, ctx.secrets.encrypt(secret)]);
    const uri = otpauthUri(secret, a.user.email);
    return { secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#02070a', light: '#e8fffb' } }) };
  });
  app.post('/api/me/mfa/enable', async req => {
    const a = requireUser(req);
    const b = z.object({ code: z.string() }).parse(req.body);
    const u = await ctx.db.one<any>('select totp_secret_enc, totp_enabled from users where id = $1', [a.user.id]);
    if (u.totp_enabled || !u.totp_secret_enc) throw bad('Start setup first.');
    const step = verifyTotp(ctx.secrets.decrypt(u.totp_secret_enc), b.code, null, ctx.now());
    if (step === null) throw bad('That code is not right. Check the time on your phone and try again.', 'code');
    const codes = await ctx.db.tx(async t => {
      await t.query('update users set totp_enabled = true, totp_last_step = $2 where id = $1', [a.user.id, step]);
      return newRecoveryCodes(t, a.user.id);
    });
    await ctx.db.query('update sessions set mfa = true where id = $1', [a.sessionId]);
    await revokeAll(ctx, a.user.id, a.sessionId);
    if (a.user.email) await ctx.mail.send({ to: a.user.email, ...templates.mfaOn() });
    return { ok: true, recoveryCodes: codes };
  });
  app.post('/api/me/mfa/disable', async req => {
    const a = requireUser(req);
    const b = z.object({ code: z.string() }).parse(req.body);
    await confirm(a.user.id, a.sessionId, { code: b.code });
    await ctx.db.query('update users set totp_enabled = false, totp_secret_enc = null, totp_last_step = null where id = $1', [a.user.id]);
    await ctx.db.query('delete from recovery_codes where user_id = $1', [a.user.id]);
    if (a.user.email) await ctx.mail.send({ to: a.user.email, ...templates.mfaOff() });
    return { ok: true };
  });
  app.post('/api/me/mfa/recovery', async req => {
    const a = requireUser(req);
    const b = z.object({ code: z.string() }).parse(req.body);
    if (!a.user.totp_enabled) throw bad('Two-factor sign-in is off.');
    await confirm(a.user.id, a.sessionId, { code: b.code });
    return { recoveryCodes: await ctx.db.tx(t => newRecoveryCodes(t, a.user.id)) };
  });

  // ── sessions, export, delete ──────────────────────────────────
  app.get('/api/me/sessions', async req => {
    const a = requireUser(req);
    const rows = await ctx.db.query<any>('select id, kind, client, mfa, created_at, last_used_at from sessions where user_id = $1 and expires_at > now() order by last_used_at desc', [a.user.id]);
    return { sessions: rows.map(r => ({ id: r.id.slice(0, 12), kind: r.kind, client: r.client, mfa: r.mfa, createdAt: r.created_at, lastUsedAt: r.last_used_at, current: r.id === a.sessionId })) };
  });
  app.delete('/api/me/sessions/:id', async req => {
    const a = requireUser(req);
    const { id } = req.params as { id: string };
    await ctx.db.query(`delete from sessions where user_id = $1 and left(id, 12) = $2`, [a.user.id, id]);
    return { ok: true };
  });
  app.post('/api/me/sessions/revoke-others', async req => { const a = requireUser(req); await revokeAll(ctx, a.user.id, a.sessionId); return { ok: true }; });

  app.get('/api/me/export', async (req, reply) => {
    const a = requireUser(req), id = a.user.id;
    const [user, identities, subs, matches, reports, sanctions, cloud] = await Promise.all([
      ctx.db.one('select id, display_name, email, email_verified, role, status, rating, matches, wins, crash_reports, age_band, chat, created_at, last_seen_at, totp_enabled from users where id = $1', [id]),
      ctx.db.query('select provider, created_at from identities where user_id = $1', [id]),
      ctx.db.query('select status, current_period_end, cancel_at_period_end, created_at from subscriptions where user_id = $1', [id]),
      ctx.db.query('select m.id, m.mode, m.started_at, m.ended_at, mp.slot, mp.result from match_players mp join matches m on m.id = mp.match_id where mp.user_id = $1 order by m.started_at desc', [id]),
      ctx.db.query('select created_at, version, platform, message, description from reports where user_id = $1 order by created_at desc limit 500', [id]),
      ctx.db.query('select kind, reason, until, created_at from sanctions where user_id = $1', [id]),
      ctx.db.query('select key, value, version, updated_at from cloud_items where user_id = $1 order by key', [id]),
    ]);
    reply.header('content-disposition', 'attachment; filename="ozymandosis-account.json"');
    return { exportedAt: new Date().toISOString(), user, identities, subscriptions: subs, matches, crashReports: reports, sanctions, cloud };
  });

  // The age question for accounts made through a sign-in provider (asked once, before online play).
  app.post('/api/me/age', async (req, reply) => {
    const a = requireUser(req);
    if (a.user.age_band) return { ok: true, ageBand: a.user.age_band };
    const b = z.object({ birthYear: z.number().int(), birthMonth: z.number().int() }).parse(req.body);
    const age = ageFrom(b.birthYear, b.birthMonth);
    if (age === null) throw bad('Please choose the month and year you were born.', 'age');
    const band = bandOf(age);
    if (!band) {
      // under 13: the account and everything in it goes
      await deleteAccount(ctx, a.user.id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      throw new HttpError(403, 'Sorry, you need to be 13 or older to play online. Your account has been removed. You can still play offline and on your local network.', 'underage');
    }
    await ctx.db.query(`update users set age_band = $2, chat = case when $2 = '13-15' and chat = 'all' then 'quick' else chat end where id = $1`, [a.user.id, band]);
    ctx.hub.refreshUser(a.user.id);
    return { ok: true, ageBand: band };
  });

  app.delete('/api/me', async (req, reply) => {
    const a = requireUser(req);
    const b = z.object({ password: z.string().optional(), code: z.string().optional(), confirm: z.literal('DELETE') }).parse(req.body);
    await confirm(a.user.id, a.sessionId, b);
    await deleteAccount(ctx, a.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}

async function newRecoveryCodes(t: Ctx['db'], userId: string): Promise<string[]> {
  await t.query('delete from recovery_codes where user_id = $1', [userId]);
  const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex')); // 80 bits each
  for (const c of codes) await t.query('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [userId, sha256(c)]);
  return codes.map(c => c.slice(0, 5) + '-' + c.slice(5));
}

// Erase personal data but keep the row (match history and moderation records reference it).
export async function deleteAccount(ctx: Ctx, userId: string, actor?: string) {
  const u = await ctx.db.one<any>('select stripe_customer_id from users where id = $1', [userId]);
  if (ctx.stripe && u?.stripe_customer_id) {
    const subs = await ctx.db.query<any>(`select id from subscriptions where user_id = $1 and status in ('active', 'trialing', 'past_due')`, [userId]);
    for (const s of subs) await ctx.stripe.subscriptions.cancel(s.id).catch(() => {});
  }
  const tomb = 'Deleted' + userId.slice(0, 8);
  await ctx.db.tx(async t => {
    await t.query(`update users set display_name = $2, name_key = $3, email = null, email_verified = false, password_hash = null, totp_secret_enc = null, totp_enabled = false, status = 'deleted', stripe_customer_id = null where id = $1`, [userId, tomb, 'deleted:' + userId]);
    for (const tbl of ['identities', 'sessions', 'recovery_codes', 'email_tokens', 'cloud_items']) await t.query(`delete from ${tbl} where user_id = $1`, [userId]);
    await t.query('update reports set user_id = null, screenshot = null where user_id = $1', [userId]);
    // store purchase tokens go too; a store subscription is cancelled in that store (the account page says so)
    await t.query('update subscriptions set store_token_enc = null where user_id = $1', [userId]);
  });
  await audit(ctx, actor || userId, 'account.delete', userId);
  ctx.hub.kickUser(userId, 'This account was deleted.');
}
