// The App Store: the iOS subscription (an in-app purchase, as Apple requires for a
// mobile subscription, docs/MONETIZATION.md) and proof that an account bought the
// game on iOS. Everything Apple signs is a JWS whose x5c chain must end at Apple
// Root CA - G3 (pinned below) with Apple's own marker extensions on the leaf and
// intermediate; nothing from the client is believed without that signature.
//   StoreKit 2 → Transaction.jwsRepresentation → POST /api/billing/appstore/verify
//   App Store Server Notifications V2 → POST /api/billing/appstore/notify
//   AppTransaction.shared.jwsRepresentation → POST /api/ownership/ios (ownership.ts)
// A subscription row is platform 'ios' and counts only there.
import type { FastifyInstance } from 'fastify';
import { X509Certificate, createHash, verify as cryptoVerify } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, forbidden, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { bump } from '../auth/service.js';

export const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;
// Tests replace the trust anchor with their own chain; production never does.
let trustedRoots = [new X509Certificate(APPLE_ROOT_CA_G3)];
export const setTrustedRootsForTests = (pems: string[]) => { trustedRoots = pems.map(p => new X509Certificate(p)); };

// Apple's marker extensions (DER-encoded OIDs): 1.2.840.113635.100.6.11.1 on the
// leaf (App Store receipt signing), 1.2.840.113635.100.6.2.1 on the intermediate (WWDR).
const OID_LEAF = Buffer.from('060a2a864886f76364060b01', 'hex'), OID_INTERMEDIATE = Buffer.from('060a2a864886f76364060201', 'hex');

export function verifyAppleJws<T = any>(jws: string, now = Date.now()): T {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw bad('Not a signed App Store payload.', 'invalid_purchase');
  let head: any;
  try { head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw bad('Not a signed App Store payload.', 'invalid_purchase'); }
  if (head.alg !== 'ES256' || !Array.isArray(head.x5c) || head.x5c.length !== 3) throw bad('Not a signed App Store payload.', 'invalid_purchase');
  const [leaf, inter, root] = head.x5c.map((c: string) => new X509Certificate(Buffer.from(c, 'base64')));
  const fail = () => { throw bad('The App Store signature did not verify.', 'invalid_purchase'); };
  if (!trustedRoots.some(r => r.fingerprint256 === root.fingerprint256)) fail();
  if (!leaf.verify(inter.publicKey) || !inter.verify(root.publicKey) || !root.verify(root.publicKey)) fail();
  if (!leaf.raw.includes(OID_LEAF) || !inter.raw.includes(OID_INTERMEDIATE)) fail();
  for (const c of [leaf, inter]) if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) fail();
  const ok = cryptoVerify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) fail();
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as T;
}

// What the game passes to StoreKit as appAccountToken: a UUID derived from the
// account id, so every purchase names the account that made it.
export function appleAccountToken(userId: string): string {
  const h = createHash('sha256').update('ozymandosis-appstore:' + userId).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface AppleTransaction {
  transactionId: string; originalTransactionId: string; bundleId: string; productId: string; type?: string;
  expiresDate?: number; revocationDate?: number; appAccountToken?: string; environment?: string; purchaseDate?: number;
}
export const plans = (ctx: Ctx) => ({ [ctx.cfg.APPSTORE_PRODUCT_MONTHLY]: 'monthly', [ctx.cfg.APPSTORE_PRODUCT_ANNUAL]: 'annual' } as Record<string, string>);
const acceptEnv = (ctx: Ctx, env?: string) => env === 'Production' || ((!ctx.cfg.prod || ctx.cfg.APPSTORE_ALLOW_SANDBOX) && (env === 'Sandbox' || env === 'Xcode' || env === undefined));

// Write what a verified transaction says. `userId` binds a new purchase; without it
// (a notification) only a purchase already bound is updated.
export async function syncTransaction(ctx: Ctx, tx: AppleTransaction, userId: string | null, renewal?: { autoRenewStatus?: number }) {
  if (tx.bundleId !== ctx.cfg.APPLE_BUNDLE_ID) throw bad('That purchase is for another app.', 'invalid_purchase');
  if (!acceptEnv(ctx, tx.environment)) throw bad('Sandbox purchases are not accepted here.', 'invalid_purchase');
  const plan = plans(ctx)[tx.productId];
  if (!plan) throw bad('That purchase is not an Ozymandosis membership.', 'invalid_purchase');
  const id = 'as_' + tx.originalTransactionId;
  const bound = await ctx.db.one<any>('select user_id from subscriptions where id = $1', [id]);
  if (bound && userId && bound.user_id !== userId) throw forbidden('This purchase belongs to another account.');
  const owner = userId || bound?.user_id;
  if (!owner) return null;
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== appleAccountToken(owner)) throw forbidden('This purchase belongs to another account.');
  const end = tx.revocationDate ? Math.min(tx.revocationDate, ctx.now()) : tx.expiresDate || null;
  const status = tx.revocationDate ? 'revoked' : end && end > ctx.now() ? 'active' : 'canceled';
  await ctx.db.query(
    `insert into subscriptions (id, user_id, status, price_id, current_period_end, cancel_at_period_end, platform, store_token_enc, store_product, updated_at)
     values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, 'ios', $7, $8, now())
     on conflict (id) do update set status = excluded.status, price_id = excluded.price_id, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now()`,
    [id, owner, status, plan, end, renewal ? renewal.autoRenewStatus === 0 : false, ctx.secrets.encrypt(tx.transactionId), tx.productId]);
  ctx.hub.refreshUser(owner);
  return { userId: owner, status, until: end ? new Date(end).toISOString() : null, created: !bound };
}

export default async function appStoreRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/billing/appstore/account', async req => {
    const a = requireUser(req);
    return { appAccountToken: appleAccountToken(a.user.id), products: { monthly: ctx.cfg.APPSTORE_PRODUCT_MONTHLY, annual: ctx.cfg.APPSTORE_PRODUCT_ANNUAL } };
  });

  app.post('/api/billing/appstore/verify', async req => {
    const a = requireUser(req);
    try {
      const tx = verifyAppleJws<AppleTransaction>(String((req.body as any)?.signedTransaction || ''), ctx.now());
      const r = await syncTransaction(ctx, tx, a.user.id);
      if (r!.created) { await bump(ctx, 'subscriptions_started'); await audit(ctx, a.user.id, 'billing.appstore.subscribed', a.user.id); }
      return { ok: true, status: r!.status, until: r!.until };
    } catch (e: any) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 403)) await audit(ctx, a.user.id, 'billing.appstore.rejected', a.user.id, { code: e.code, reason: e.message });
      throw e;
    }
  });

  // App Store Server Notifications V2: renewals, expiry, grace, refunds, revocations.
  app.post('/api/billing/appstore/notify', { config: { rateLimit: false } }, async (req, reply) => {
    let n: any;
    try { n = verifyAppleJws(String((req.body as any)?.signedPayload || ''), ctx.now()); } catch { return reply.code(400).send({ error: 'Bad signature' }); }
    if (n.data?.bundleId && n.data.bundleId !== ctx.cfg.APPLE_BUNDLE_ID) return { ok: true, ignored: 'bundle' };
    if (!n.data?.signedTransactionInfo) return { ok: true, ignored: n.notificationType === 'TEST' ? 'test' : 'kind' };
    const tx = verifyAppleJws<AppleTransaction>(n.data.signedTransactionInfo, ctx.now());
    const renewal = n.data.signedRenewalInfo ? verifyAppleJws<any>(n.data.signedRenewalInfo, ctx.now()) : undefined;
    try {
      const r = await syncTransaction(ctx, tx, null, renewal);
      if (!r) return { ok: true, ignored: 'unbound' };
      if (r.status !== 'active') await bump(ctx, 'subscriptions_ended');
      if (n.notificationType === 'REFUND' || n.notificationType === 'REVOKE') await audit(ctx, null, 'billing.appstore.' + n.notificationType.toLowerCase(), r.userId);
    } catch (e: any) { if (!(e instanceof HttpError)) return reply.code(500).send({ error: 'retry' }); }
    return { ok: true };
  });
}
