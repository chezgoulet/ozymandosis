// Google Play Billing: the Android subscription ($2/month, $12/year; prices come
// from Play). A new entitlement source, not a new model: a validated purchase
// becomes a row in `subscriptions` with platform 'android', which only counts for
// the Android client (subscriptions do not cross platforms, docs/MONETIZATION.md).
//
// Nothing the client says is trusted. Every purchase token is checked with the Play
// Developer API (purchases.subscriptionsv2) before it grants anything; the purchase
// must name this account (obfuscatedExternalAccountId, set by the game at checkout);
// a token already bound to another account is refused. Changes (renewal, cancel,
// grace, hold, refund, revocation) arrive as Real-time Developer Notifications on
// Pub/Sub, and each one is re-read from the Play API rather than believed.
import type { FastifyInstance } from 'fastify';
import { createHash, createSign, timingSafeEqual } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, forbidden, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { bump } from '../auth/service.js';

// ── the Play Developer API (a small client; tests inject a double) ─────────────
export interface PlaySubscription {
  subscriptionState: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId: string; expiryTime?: string; offerDetails?: { basePlanId?: string }; autoRenewingPlan?: { autoRenewEnabled?: boolean } }[];
}
export interface PlayApi {
  // null when Google does not know the token (forged, wrong app, or long expired)
  getSubscription(token: string): Promise<PlaySubscription | null>;
  acknowledge(productId: string, token: string): Promise<void>;
}

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export function googlePlayApi(serviceAccountJson: string, packageName: string, fetchImpl: typeof fetch = fetch): PlayApi {
  const raw = serviceAccountJson.trim().startsWith('{') ? serviceAccountJson : Buffer.from(serviceAccountJson, 'base64').toString('utf8');
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  let cached: { token: string; exp: number } | null = null;
  const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
  async function accessToken() {
    if (cached && cached.exp - 60e3 > Date.now()) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }))}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
    const r = await fetchImpl(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64u(sig)}` }), signal: AbortSignal.timeout(10e3) });
    if (!r.ok) throw new Error(`Google token exchange failed (${r.status})`);
    const j: any = await r.json();
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return cached.token;
  }
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases`;
  return {
    async getSubscription(token) {
      const r = await fetchImpl(`${base}/subscriptionsv2/tokens/${encodeURIComponent(token)}`, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(10e3) });
      if (r.status === 400 || r.status === 404 || r.status === 410) return null;
      if (!r.ok) throw new Error(`Play Developer API error (${r.status})`);
      return (await r.json()) as PlaySubscription;
    },
    async acknowledge(productId, token) {
      const r = await fetchImpl(`${base}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, { method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10e3) });
      if (!r.ok && r.status !== 400) throw new Error(`Play acknowledge failed (${r.status})`); // 400: already acknowledged
    },
  };
}

// ── binding a purchase to an account ─────────────────────────────
// What the game passes to Play as obfuscatedAccountId: stable, not personal, and
// not reversible to the account id without this service's code.
export const playAccountId = (userId: string) => createHash('sha256').update('ozymandosis-play:' + userId).digest('base64url').slice(0, 43);
const rowId = (token: string) => 'gp_' + createHash('sha256').update(token).digest('hex').slice(0, 40);

// Play's state → the status words the entitlement check already understands.
// Cancelled-but-paid-up keeps access until expiry; grace keeps access; hold, pause,
// expiry and revocation do not.
export function mapState(s: PlaySubscription): { status: string; cancel: boolean } {
  switch (s.subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE': return { status: 'active', cancel: false };
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': return { status: 'active', cancel: false };
    case 'SUBSCRIPTION_STATE_CANCELED': return { status: 'active', cancel: true };
    case 'SUBSCRIPTION_STATE_ON_HOLD': return { status: 'on_hold', cancel: false };
    case 'SUBSCRIPTION_STATE_PAUSED': return { status: 'paused', cancel: false };
    case 'SUBSCRIPTION_STATE_PENDING': return { status: 'incomplete', cancel: false };
    case 'SUBSCRIPTION_STATE_EXPIRED': return { status: 'canceled', cancel: true };
    default: return { status: 'canceled', cancel: true }; // pending-purchase-canceled, unspecified
  }
}

// Read a token from Play and write what it says. `userId` binds a new purchase; when
// absent (a notification), only a purchase already bound is updated.
export async function syncPurchase(ctx: Ctx, token: string, userId: string | null): Promise<{ userId: string; status: string; until: string | null; created: boolean }> {
  if (!ctx.play) throw new HttpError(503, 'Google Play billing is not set up on this server.', 'billing_unconfigured');
  const id = rowId(token);
  const bound = await ctx.db.one<any>('select user_id from subscriptions where id = $1', [id]);
  if (bound && userId && bound.user_id !== userId) throw forbidden('This purchase belongs to another account.');
  const owner = userId || bound?.user_id;
  if (!owner) throw bad('Unknown purchase.', 'unknown_purchase');
  const sub = await ctx.play.getSubscription(token);
  if (!sub) throw bad('Google Play does not recognise this purchase.', 'invalid_purchase');
  const item = (sub.lineItems || []).find(l => l.productId === ctx.cfg.GOOGLE_PLAY_PRODUCT);
  if (!item) throw bad('That purchase is not an Ozymandosis membership.', 'invalid_purchase');
  const claimed = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (claimed && claimed !== playAccountId(owner)) throw forbidden('This purchase belongs to another account.');
  const { status, cancel } = mapState(sub);
  const end = item.expiryTime || null;
  // a resubscribe or plan change replaces the old token: the old row stops granting
  if (sub.linkedPurchaseToken) await ctx.db.query(`update subscriptions set status = 'replaced', updated_at = now() where id = $1 and user_id = $2`, [rowId(sub.linkedPurchaseToken), owner]);
  await ctx.db.query(
    `insert into subscriptions (id, user_id, status, price_id, current_period_end, cancel_at_period_end, platform, store_token_enc, store_product, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'android', $7, $8, now())
     on conflict (id) do update set status = excluded.status, price_id = excluded.price_id, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, store_token_enc = excluded.store_token_enc, updated_at = now()`,
    [id, owner, status, item.offerDetails?.basePlanId || null, end, cancel, ctx.secrets.encrypt(token), item.productId]);
  // Play refunds purchases not acknowledged within three days
  if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && status === 'active') await ctx.play.acknowledge(item.productId, token);
  ctx.hub.refreshUser(owner);
  return { userId: owner, status, until: end, created: !bound };
}

export default async function playRoutes(app: FastifyInstance, ctx: Ctx) {
  // What the game hands Play at checkout, so the purchase names this account.
  app.get('/api/billing/play/account', async req => {
    const a = requireUser(req);
    return { obfuscatedAccountId: playAccountId(a.user.id), productId: ctx.cfg.GOOGLE_PLAY_PRODUCT, configured: !!ctx.play };
  });

  // The game sends every purchase (new, restored after a reinstall) here; nothing is granted until Play agrees.
  app.post('/api/billing/play/verify', async req => {
    const a = requireUser(req);
    const token = String((req.body as any)?.purchaseToken || '');
    if (token.length < 20 || token.length > 4096) throw bad('That is not a purchase token.', 'invalid_purchase');
    try {
      const r = await syncPurchase(ctx, token, a.user.id);
      if (r.created) { await bump(ctx, 'subscriptions_started'); await audit(ctx, a.user.id, 'billing.play.subscribed', a.user.id); }
      return { ok: true, status: r.status, until: r.until };
    } catch (e: any) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 403)) await audit(ctx, a.user.id, 'billing.play.rejected', a.user.id, { code: e.code, reason: e.message });
      throw e;
    }
  });

  // Real-time Developer Notifications (Pub/Sub push). The push URL carries a secret
  // (?token=GOOGLE_PLAY_RTDN_TOKEN); the message itself is only a hint to re-read.
  app.post('/api/billing/play/rtdn', { config: { rateLimit: false } }, async (req, reply) => {
    const want = ctx.cfg.GOOGLE_PLAY_RTDN_TOKEN, got = String((req.query as any)?.token || '');
    if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return reply.code(401).send({ error: 'Bad token' });
    let n: any;
    try { n = JSON.parse(Buffer.from(String((req.body as any)?.message?.data || ''), 'base64').toString('utf8')); } catch { return { ok: true, ignored: 'unreadable' }; }
    if (n.packageName && n.packageName !== ctx.cfg.GOOGLE_PLAY_PACKAGE) return { ok: true, ignored: 'package' };
    const token: string | undefined = n.subscriptionNotification?.purchaseToken || n.voidedPurchaseNotification?.purchaseToken;
    if (!token) return { ok: true, ignored: n.testNotification ? 'test' : 'kind' };
    const row = await ctx.db.one<any>('select user_id from subscriptions where id = $1', [rowId(token)]);
    if (!row) return { ok: true, ignored: 'unbound' }; // the game has not claimed it yet; it will be checked when it does
    if (n.voidedPurchaseNotification) {
      // refunded or charged back: access ends now, whatever the period said
      await ctx.db.query(`update subscriptions set status = 'revoked', current_period_end = now(), cancel_at_period_end = true, updated_at = now() where id = $1`, [rowId(token)]);
      await audit(ctx, null, 'billing.play.voided', row.user_id, { refundType: n.voidedPurchaseNotification.refundType ?? null });
      await bump(ctx, 'subscriptions_ended');
      ctx.hub.refreshUser(row.user_id);
      return { ok: true };
    }
    try {
      const r = await syncPurchase(ctx, token, null);
      if (r.status !== 'active') await bump(ctx, 'subscriptions_ended');
    } catch (e: any) {
      // Play no longer knows the token: treat as ended. Anything else: let Pub/Sub retry.
      if (e instanceof HttpError && e.code === 'invalid_purchase') await ctx.db.query(`update subscriptions set status = 'canceled', updated_at = now() where id = $1`, [rowId(token)]);
      else return reply.code(500).send({ error: 'retry' });
    }
    return { ok: true };
  });
}
