// Ownership: the $1 purchase, bound to the account, per platform (docs/MONETIZATION.md,
// "Entitlements"). There is no browser version and no free build, so the purchase is
// what gates online play; and "bound to the account" means nothing unless the store
// says so. Each platform proves it its own way, checked here with the store:
//   android — a Play Integrity token requested with our nonce: licensed, Play-recognised
//   ios     — AppTransaction (StoreKit 2), signed by Apple (appstore.ts verifies the chain)
//   steam   — the account's linked Steam id owns the app (ISteamUser/CheckAppOwnership);
//             the same call finds the season DLC that is the Steam subscription
// A proof is good for OWNERSHIP_DAYS; the app renews it in the background, so a refund
// eventually takes effect. When REQUIRE_STORE_CLIENT is on (production), the hub only
// lets a store client with a current proof for its own platform play online.
import type { FastifyInstance } from 'fastify';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, forbidden, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { verifyAppleJws } from './appstore.js';

export const STORE_PLATFORMS = ['android', 'ios', 'steam'] as const;
export type StorePlatform = typeof STORE_PLATFORMS[number];
export const OWNERSHIP_DAYS = 30;
const NONCE_TTL = 10 * 60e3;

export async function owns(ctx: Ctx, userId: string, platform: string): Promise<boolean> {
  return !!(await ctx.db.one(`select 1 from ownerships where user_id = $1 and platform = $2 and verified_at > now() - make_interval(days => $3)`, [userId, platform, OWNERSHIP_DAYS]));
}
async function record(ctx: Ctx, userId: string, platform: StorePlatform, evidence: string) {
  await ctx.db.query(`insert into ownerships (user_id, platform, verified_at, evidence) values ($1, $2, now(), $3)
    on conflict (user_id, platform) do update set verified_at = now(), evidence = excluded.evidence`, [userId, platform, createHash('sha256').update(evidence).digest('hex').slice(0, 32)]);
  ctx.hub.refreshUser(userId);
}

// Nonces for Play Integrity: bound to the account and to a time, so a token cannot be
// replayed by another account or later.
export function makeNonce(ctx: Ctx, userId: string, at = ctx.now()): string {
  const ts = at.toString(36), mac = createHmac('sha256', ctx.cfg.SECRET_KEY || 'dev').update(`integrity|${userId}|${ts}`).digest('base64url').slice(0, 32);
  return `${ts}.${mac}`.replace(/\./g, '_'); // URL-safe base64 alphabet only, as Play requires
}
function nonceOk(ctx: Ctx, userId: string, nonce: string): boolean {
  const ts = nonce.split('_')[0], at = parseInt(ts, 36);
  if (!(at > 0) || ctx.now() - at > NONCE_TTL || at - ctx.now() > 60e3) return false;
  const want = makeNonce(ctx, userId, at);
  return want.length === nonce.length && timingSafeEqual(Buffer.from(want), Buffer.from(nonce));
}

// Steam's partner API (the publisher key). Tests replace this.
export let steamOwns = async (ctx: Ctx, steamId: string, appId: string): Promise<boolean> => {
  const u = new URL('https://partner.steam-api.com/ISteamUser/CheckAppOwnership/v4/');
  u.searchParams.set('key', ctx.cfg.STEAM_API_KEY || ''); u.searchParams.set('steamid', steamId); u.searchParams.set('appid', appId);
  const r = await fetch(u, { signal: AbortSignal.timeout(10e3) });
  if (!r.ok) throw new Error(`Steam ownership check failed (${r.status})`);
  const j: any = await r.json();
  return !!j?.appownership?.ownsapp;
};
export const setSteamOwnsForTests = (f: typeof steamOwns) => { steamOwns = f; };
export const steamSeasons = (ctx: Ctx): { appid: string; until: string }[] => { try { return JSON.parse(ctx.cfg.STEAM_SEASONS).map((s: any) => ({ appid: String(s.appid), until: String(s.until) })); } catch { return []; } };

export default async function ownershipRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/ownership', async req => {
    const a = requireUser(req);
    const rows = await ctx.db.query<any>(`select platform, verified_at from ownerships where user_id = $1`, [a.user.id]);
    return { platforms: rows.map(r => ({ platform: r.platform, verifiedAt: r.verified_at, current: Date.now() - new Date(r.verified_at).getTime() < OWNERSHIP_DAYS * 864e5 })) };
  });
  app.get('/api/ownership/nonce', async req => ({ nonce: makeNonce(ctx, requireUser(req).user.id), cloudProjectNumber: ctx.cfg.GOOGLE_CLOUD_PROJECT_NUMBER ? Number(ctx.cfg.GOOGLE_CLOUD_PROJECT_NUMBER) : null }));

  const refuse = async (userId: string, platform: string, e: any) => { if (e instanceof HttpError && e.status < 500) await audit(ctx, userId, 'ownership.rejected', userId, { platform, reason: e.message }); throw e; };

  app.post('/api/ownership/android', async req => {
    const a = requireUser(req), b = req.body as any;
    try {
      if (!ctx.play) throw new HttpError(503, 'Google Play checks are not set up on this server.', 'unconfigured');
      const nonce = String(b?.nonce || ''), token = String(b?.integrityToken || '');
      if (!nonceOk(ctx, a.user.id, nonce)) throw bad('That check has expired. Try again.', 'nonce');
      const v = await ctx.play.decodeIntegrity(token);
      if (!v) throw bad('Google Play could not vouch for this copy.', 'invalid_proof');
      if (v.requestDetails?.requestPackageName !== ctx.cfg.GOOGLE_PLAY_PACKAGE || v.requestDetails?.nonce !== nonce) throw bad('Google Play could not vouch for this copy.', 'invalid_proof');
      if (v.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') throw forbidden('This copy of Ozymandosis did not come from Google Play.');
      if (v.accountDetails?.appLicensingVerdict !== 'LICENSED') throw forbidden('Google Play says this Google account has not bought Ozymandosis.');
      await record(ctx, a.user.id, 'android', 'integrity:' + nonce);
      return { ok: true, platform: 'android' };
    } catch (e) { return refuse(a.user.id, 'android', e); }
  });

  app.post('/api/ownership/ios', async req => {
    const a = requireUser(req);
    try {
      const t = verifyAppleJws<any>(String((req.body as any)?.appTransaction || ''), ctx.now());
      if (t.bundleId !== ctx.cfg.APPLE_BUNDLE_ID) throw bad('That is another app.', 'invalid_proof');
      if (ctx.cfg.prod && !ctx.cfg.APPSTORE_ALLOW_SANDBOX && t.environment !== 'Production') throw forbidden('A test build cannot play online here.');
      await record(ctx, a.user.id, 'ios', 'appTransaction:' + (t.appTransactionId || t.originalPurchaseDate || ''));
      return { ok: true, platform: 'ios' };
    } catch (e) { return refuse(a.user.id, 'ios', e); }
  });

  // Steam: ownership of the game, and of any current season (the Steam subscription).
  app.post('/api/ownership/steam', async req => {
    const a = requireUser(req);
    try {
      if (!ctx.cfg.STEAM_API_KEY || !ctx.cfg.STEAM_APP_ID) throw new HttpError(503, 'Steam checks are not set up on this server.', 'unconfigured');
      const id = await ctx.db.one<any>(`select subject from identities where user_id = $1 and provider = 'steam'`, [a.user.id]);
      if (!id) throw bad('Sign in with Steam (or link Steam to your account) to play online from the Steam version.', 'steam_link');
      if (!(await steamOwns(ctx, id.subject, ctx.cfg.STEAM_APP_ID))) throw forbidden('Steam says this Steam account does not own Ozymandosis.');
      await record(ctx, a.user.id, 'steam', 'steam:' + id.subject);
      const seasons: string[] = [];
      for (const s of steamSeasons(ctx)) {
        if (Date.parse(s.until) <= ctx.now() || !(await steamOwns(ctx, id.subject, s.appid))) continue;
        seasons.push(s.appid);
        await ctx.db.query(`insert into subscriptions (id, user_id, status, price_id, current_period_end, platform, store_product, updated_at) values ($1, $2, 'active', 'season', $3, 'steam', $4, now())
          on conflict (id) do update set current_period_end = excluded.current_period_end, status = 'active', updated_at = now()`, [`steam_${s.appid}_${a.user.id}`, a.user.id, s.until, s.appid]);
      }
      ctx.hub.refreshUser(a.user.id);
      return { ok: true, platform: 'steam', seasons };
    } catch (e) { return refuse(a.user.id, 'steam', e); }
  });
}
