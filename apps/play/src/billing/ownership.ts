// Store evidence, bound to the account, per platform. Nothing here gates play any more:
// the app is free on every platform and the gates are the free daily allowance and the
// membership (docs/MONETIZATION.md, revision of 2026-10-06). What is left is the two
// stores that still sell something or vouch for a copy:
//   ios     — AppTransaction (StoreKit 2), signed by Apple (appstore.ts verifies the chain)
//   steam   — the account's linked Steam id owns the app (ISteamUser/CheckAppOwnership);
//             the same call finds the season DLC that is the Steam subscription
// Android's proof was Play Integrity and is gone with the billing client: a free,
// open-source build cannot produce it, and a patched one could always lie about it.
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, forbidden, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { verifyAppleJws } from './appstore.js';

export const STORE_PLATFORMS = ['android', 'ios', 'steam'] as const;
export type StorePlatform = typeof STORE_PLATFORMS[number];
export const OWNERSHIP_DAYS = 30;

export async function owns(ctx: Ctx, userId: string, platform: string): Promise<boolean> {
  return !!(await ctx.db.one(`select 1 from ownerships where user_id = $1 and platform = $2 and verified_at > now() - make_interval(days => $3)`, [userId, platform, OWNERSHIP_DAYS]));
}
async function record(ctx: Ctx, userId: string, platform: StorePlatform, evidence: string) {
  await ctx.db.query(`insert into ownerships (user_id, platform, verified_at, evidence) values ($1, $2, now(), $3)
    on conflict (user_id, platform) do update set verified_at = now(), evidence = excluded.evidence`, [userId, platform, createHash('sha256').update(evidence).digest('hex').slice(0, 32)]);
  ctx.hub.refreshUser(userId);
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

  const refuse = async (userId: string, platform: string, e: any) => { if (e instanceof HttpError && e.status < 500) await audit(ctx, userId, 'ownership.rejected', userId, { platform, reason: e.message }); throw e; };

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
