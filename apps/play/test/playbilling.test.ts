import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { boot, signup, Client, type T } from './helpers.js';
import { googlePlayApi, playAccountId, type PlayApi, type PlaySubscription } from '../src/billing/play.js';

// A Play Developer API double: the tokens Google knows, and what it says about them.
const known = new Map<string, PlaySubscription>();
const acked: string[] = [];
const play: PlayApi = {
  async getSubscription(token) { return known.get(token) ?? null; },
  async acknowledge(_p, token) { acked.push(token); const s = known.get(token); if (s) s.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'; },
};
const day = 864e5;
const purchase = (userId: string, over: Partial<PlaySubscription> = {}, plan = 'monthly', days = 30): PlaySubscription => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', testPurchase: {},
  externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountId(userId) },
  lineItems: [{ productId: 'ozymandosis_membership', expiryTime: new Date(Date.now() + days * day).toISOString(), offerDetails: { basePlanId: plan } }], ...over,
});
const token = (n: string) => `play-token-${n}-${'x'.repeat(40)}`;
const RTDN = 'rtdn-secret-long-enough-0123456789';
const push = (t: T, body: object, secret = RTDN) => t.api('POST', `/api/billing/play/rtdn?token=${secret}`, { message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName: 'com.ozymandosis.game', ...body })).toString('base64') } });
const me = (t: T, tok: string, platform = 'android') => t.api('GET', `/api/me?platform=${platform}`, undefined, tok).then(r => r.json.entitlements);

let t: T;
test('boot', async () => { t = await boot({ GOOGLE_PLAY_RTDN_TOKEN: RTDN }, { play }); });
after(async () => { await t.app.close(); });

test('a purchase Play confirms grants the Android entitlement, and is acknowledged', async () => {
  const u = await signup(t);
  const acct = await t.api('GET', '/api/billing/play/account', undefined, u.token);
  assert.equal(acct.json.obfuscatedAccountId, playAccountId(u.id));
  known.set(token('a'), purchase(u.id));
  const r = await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('a') }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.status, 'active');
  assert.deepEqual(acked, [token('a')], 'acknowledged server-side (Play refunds unacknowledged purchases)');
  const ent = await me(t, u.token);
  assert.equal(ent.subscriber, true); assert.equal(ent.source, 'play'); assert.equal(ent.platform, 'android');
});

test('subscriptions do not cross platforms: a Play purchase does nothing on iOS, Steam or the web', async () => {
  const u = await signup(t);
  known.set(token('b'), purchase(u.id));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('b') }, u.token);
  for (const p of ['ios', 'steam', 'web']) assert.equal((await me(t, u.token, p)).subscriber, false, p);
  assert.equal((await me(t, u.token, 'android')).subscriber, true);
  // …and the lobby connection an Android client opens sees it, one from elsewhere does not
  const a = await Client.open(t, u.token, { platform: 'android' }), w = await Client.open(t, u.token, { platform: 'web' });
  assert.equal(a.hello.ent.subscriber, true); assert.equal(w.hello.ent.subscriber, false);
  a.close(); w.close();
});

test('the entitlement survives a reinstall: the same purchase restored on a new install, same account', async () => {
  const u = await signup(t);
  known.set(token('c'), purchase(u.id));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('c') }, u.token);
  // a new install signs in again (a new session) and restores what Play says it owns
  const again = await t.api('POST', '/api/auth/login', { email: u.email, password: u.password, client: 'game' });
  assert.equal((await me(t, again.json.token)).subscriber, true, 'bound to the account, not the install');
  const restore = await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('c') }, again.json.token);
  assert.equal(restore.status, 200, 'restoring is idempotent');
  assert.equal(Number((await t.ctx.db.one<any>(`select count(*)::int as n from subscriptions where user_id = $1`, [u.id])).n), 1);
});

test('a forged purchase token is rejected, and the rejection is recorded', async () => {
  const u = await signup(t);
  const r = await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('forged') }, u.token);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_purchase'); assert.match(r.json.error, /does not recognise/);
  assert.equal((await me(t, u.token)).subscriber, false);
  assert.ok(await t.ctx.db.one(`select 1 from audit_log where action = 'billing.play.rejected' and target = $1`, [u.id]));
  console.log('forged token →', r.status, JSON.stringify(r.json));
});

test("someone else's purchase is refused: by the account it names, and by the account it is bound to", async () => {
  const owner = await signup(t), thief = await signup(t);
  known.set(token('d'), purchase(owner.id));
  const r1 = await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('d') }, thief.token);
  assert.equal(r1.status, 403, 'the purchase names another account');
  // a purchase without an account id binds to whoever claims it first, and only them
  known.set(token('e'), purchase(owner.id, { externalAccountIdentifiers: {} }));
  assert.equal((await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('e') }, owner.token)).status, 200);
  assert.equal((await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('e') }, thief.token)).status, 403);
  assert.equal((await me(t, thief.token)).subscriber, false);
});

test('a product that is not the membership grants nothing', async () => {
  const u = await signup(t);
  known.set(token('f'), purchase(u.id, { lineItems: [{ productId: 'something_else', expiryTime: new Date(Date.now() + day).toISOString() }] }));
  assert.equal((await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('f') }, u.token)).status, 400);
});

test('cancelled: access continues to the end of the paid period, then stops', async () => {
  const u = await signup(t);
  known.set(token('g'), purchase(u.id));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('g') }, u.token);
  known.set(token('g'), purchase(u.id, { subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
  assert.equal((await push(t, { subscriptionNotification: { notificationType: 3, purchaseToken: token('g'), subscriptionId: 'ozymandosis_membership' } })).status, 200);
  let ent = await me(t, u.token);
  assert.equal(ent.subscriber, true, 'still paid up'); assert.equal(ent.cancelAtPeriodEnd, true);
  // the period runs out: Play says expired
  known.set(token('g'), purchase(u.id, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }, 'monthly', -1));
  await push(t, { subscriptionNotification: { notificationType: 13, purchaseToken: token('g') } });
  ent = await me(t, u.token);
  assert.equal(ent.subscriber, false, 'expired');
});

test('refunded or revoked: access ends at once', async () => {
  const u = await signup(t);
  known.set(token('h'), purchase(u.id, {}, 'annual', 365));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('h') }, u.token);
  assert.equal((await me(t, u.token)).subscriber, true);
  await push(t, { voidedPurchaseNotification: { purchaseToken: token('h'), orderId: 'GPA.1', productType: 1, refundType: 1 } });
  assert.equal((await me(t, u.token)).subscriber, false, 'voided: the year does not matter');
  // revocation (type 12): Play reports the subscription expired
  const v = await signup(t);
  known.set(token('i'), purchase(v.id));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('i') }, v.token);
  known.set(token('i'), purchase(v.id, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, 'monthly', 20));
  await push(t, { subscriptionNotification: { notificationType: 12, purchaseToken: token('i') } });
  assert.equal((await me(t, v.token)).subscriber, false);
});

test('on hold (payment failed past grace) removes access; grace keeps it', async () => {
  const u = await signup(t);
  known.set(token('j'), purchase(u.id, { subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('j') }, u.token);
  assert.equal((await me(t, u.token)).subscriber, true);
  known.set(token('j'), purchase(u.id, { subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }));
  await push(t, { subscriptionNotification: { notificationType: 5, purchaseToken: token('j') } });
  assert.equal((await me(t, u.token)).subscriber, false);
});

test('a plan change replaces the old purchase instead of stacking', async () => {
  const u = await signup(t);
  known.set(token('k'), purchase(u.id));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('k') }, u.token);
  known.set(token('l'), purchase(u.id, { linkedPurchaseToken: token('k') }, 'annual', 365));
  await t.api('POST', '/api/billing/play/verify', { purchaseToken: token('l') }, u.token);
  const rows = await t.ctx.db.query<any>(`select price_id, status from subscriptions where user_id = $1 order by price_id`, [u.id]);
  assert.deepEqual(rows.map(r => [r.price_id, r.status]), [['annual', 'active'], ['monthly', 'replaced']]);
});

test('notifications need the push secret, and never grant by themselves', async () => {
  assert.equal((await push(t, { testNotification: { version: '1.0' } }, 'wrong-secret-wrong-secret-wrong-1')).status, 401);
  const r = await push(t, { subscriptionNotification: { notificationType: 4, purchaseToken: token('unclaimed') } });
  assert.equal(r.status, 200); assert.equal(r.json.ignored, 'unbound');
});

test('the Play client: service-account JWT, token exchange, subscriptionsv2 and acknowledge', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = JSON.stringify({ client_email: 'ozy@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.test/token' });
  const calls: string[] = [];
  const fake: typeof fetch = async (url: any, init: any = {}) => {
    const u = String(url); calls.push(`${init.method || 'GET'} ${u.replace(/\?.*/, '')}`);
    if (u === 'https://oauth2.test/token') {
      const jwt = new URLSearchParams(String(init.body)).get('assertion')!, [h, p, s] = jwt.split('.');
      assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')), 'JWT signed by the service account');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher'); assert.equal(claims.iss, 'ozy@test.iam.gserviceaccount.com');
      return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }));
    }
    assert.equal(init.headers.authorization, 'Bearer at-1');
    if (u.includes('/subscriptionsv2/tokens/good')) return new Response(JSON.stringify({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }));
    if (u.includes('/subscriptionsv2/tokens/')) return new Response('{"error":{"code":400}}', { status: 400 });
    if (u.endsWith(':acknowledge')) return new Response('{}');
    return new Response('', { status: 500 });
  };
  const api = googlePlayApi(Buffer.from(sa).toString('base64'), 'com.ozymandosis.game', fake);
  assert.equal((await api.getSubscription('good'))!.subscriptionState, 'SUBSCRIPTION_STATE_ACTIVE');
  assert.equal(await api.getSubscription('forged'), null, 'Google refusing a token means it is not a purchase');
  await api.acknowledge('ozymandosis_membership', 'good');
  assert.equal(calls.filter(c => c.includes('oauth2')).length, 1, 'the access token is reused');
  assert.ok(calls.some(c => c === 'GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.ozymandosis.game/purchases/subscriptionsv2/tokens/good'));
  assert.ok(calls.some(c => c.endsWith('/purchases/subscriptions/ozymandosis_membership/tokens/good:acknowledge')));
});
