// Store validation (docs/MONETIZATION.md, "Entitlements"): the iOS subscription, and
// proof that an account bought the game on each platform, checked with the store.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { boot, signup, type T } from './helpers.js';
import { setTrustedRootsForTests, appleAccountToken, verifyAppleJws } from '../src/billing/appstore.js';
import { setSteamOwnsForTests } from '../src/billing/ownership.js';
import type { PlayApi, PlayIntegrity } from '../src/billing/play.js';

// An Apple-shaped chain: root → intermediate (WWDR marker) → leaf (receipt-signing marker).
const dir = mkdtempSync(join(tmpdir(), 'ozy-apple-'));
const ossl = (...a: string[]) => execFileSync('openssl', a, { cwd: dir, stdio: 'pipe' });
function chain(prefix: string, markers = true) {
  const k = (n: string) => ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${prefix}${n}.key`);
  k('root'); k('int'); k('leaf');
  ossl('req', '-x509', '-new', '-key', `${prefix}root.key`, '-subj', `/CN=${prefix} Root`, '-days', '30', '-out', `${prefix}root.pem`, '-addext', 'basicConstraints=critical,CA:true');
  writeFileSync(join(dir, `${prefix}int.ext`), `basicConstraints=critical,CA:true\n${markers ? '1.2.840.113635.100.6.2.1=DER:0500\n' : ''}`);
  writeFileSync(join(dir, `${prefix}leaf.ext`), `basicConstraints=critical,CA:false\n${markers ? '1.2.840.113635.100.6.11.1=DER:0500\n' : ''}`);
  ossl('req', '-new', '-key', `${prefix}int.key`, '-subj', `/CN=${prefix} WWDR`, '-out', `${prefix}int.csr`);
  ossl('x509', '-req', '-in', `${prefix}int.csr`, '-CA', `${prefix}root.pem`, '-CAkey', `${prefix}root.key`, '-CAcreateserial', '-days', '30', '-extfile', `${prefix}int.ext`, '-out', `${prefix}int.pem`);
  ossl('req', '-new', '-key', `${prefix}leaf.key`, '-subj', `/CN=${prefix} Receipts`, '-out', `${prefix}leaf.csr`);
  ossl('x509', '-req', '-in', `${prefix}leaf.csr`, '-CA', `${prefix}int.pem`, '-CAkey', `${prefix}int.key`, '-CAcreateserial', '-days', '30', '-extfile', `${prefix}leaf.ext`, '-out', `${prefix}leaf.pem`);
  const der = (n: string) => readFileSync(join(dir, `${prefix}${n}.pem`), 'utf8').replace(/-----[^-]+-----|\s/g, '');
  const key = createPrivateKey(readFileSync(join(dir, `${prefix}leaf.key`)));
  return { root: readFileSync(join(dir, `${prefix}root.pem`), 'utf8'), x5c: [der('leaf'), der('int'), der('root')], key };
}
const apple = chain('a'), rogue = chain('r'), unmarked = chain('u', false);
setTrustedRootsForTests([apple.root, unmarked.root]);
const jws = (payload: object, c = apple) => {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', x5c: c.x5c })).toString('base64url'), p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${cryptoSign('sha256', Buffer.from(`${h}.${p}`), { key: c.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};
const day = 864e5;
const tx = (userId: string, over: object = {}) => ({ transactionId: 't' + Math.random(), originalTransactionId: 'o-' + userId.slice(0, 8), bundleId: 'com.ozymandosis.game', productId: 'ozymandosis.membership.monthly', type: 'Auto-Renewable Subscription', expiresDate: Date.now() + 30 * day, appAccountToken: appleAccountToken(userId), environment: 'Sandbox', ...over });

// Play Integrity double
const verdicts = new Map<string, PlayIntegrity>();
const play: PlayApi = { getSubscription: async () => null, acknowledge: async () => {}, decodeIntegrity: async t => verdicts.get(t) ?? null };
// Steam double: which Steam ids own which app ids
const steamOwned = new Set<string>();
setSteamOwnsForTests(async (_ctx, sid, app) => steamOwned.has(`${sid}:${app}`));

let t: T;
test('boot', async () => { t = await boot({ STEAM_API_KEY: 'k', STEAM_APP_ID: '1000', STEAM_SEASONS: JSON.stringify([{ appid: 2027, until: new Date(Date.now() + 200 * day).toISOString() }, { appid: 2026, until: new Date(Date.now() - day).toISOString() }]) }, { play }); });
after(async () => { await t.app.close(); });
const me = (tok: string, platform: string) => t.api('GET', `/api/me?platform=${platform}`, undefined, tok).then(r => r.json.entitlements);

test('Apple signatures: only a chain to the pinned root, with Apple\'s markers, signed by the leaf', () => {
  assert.equal(verifyAppleJws(jws({ a: 1 })).a, 1);
  assert.throws(() => verifyAppleJws(jws({ a: 1 }, rogue)), /did not verify/, 'another root');
  assert.throws(() => verifyAppleJws(jws({ a: 1 }, unmarked)), /did not verify/, 'a trusted root, but not Apple-marked certificates');
  const good = jws({ a: 1 }), [h, , s] = good.split('.');
  assert.throws(() => verifyAppleJws(`${h}.${Buffer.from('{"a":2}').toString('base64url')}.${s}`), /did not verify/, 'a changed payload');
});

test('iOS subscription: StoreKit transactions grant on iOS only; forged or foreign ones are refused', async () => {
  const u = await signup(t), other = await signup(t);
  const acct = await t.api('GET', '/api/billing/appstore/account', undefined, u.token);
  assert.equal(acct.json.appAccountToken, appleAccountToken(u.id));
  const r = await t.api('POST', '/api/billing/appstore/verify', { signedTransaction: jws(tx(u.id)) }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await me(u.token, 'ios')).subscriber, true);
  for (const p of ['android', 'steam', 'web']) assert.equal((await me(u.token, p)).subscriber, false, 'not on ' + p);
  const forged = await t.api('POST', '/api/billing/appstore/verify', { signedTransaction: jws(tx(other.id), rogue) }, other.token);
  assert.equal(forged.status, 400); assert.equal(forged.json.code, 'invalid_purchase');
  const foreign = await t.api('POST', '/api/billing/appstore/verify', { signedTransaction: jws(tx(u.id)) }, other.token);
  assert.equal(foreign.status, 403, 'bound to the account that bought it');
  assert.equal((await me(other.token, 'ios')).subscriber, false);
});

test('App Store notifications: a refund ends access at once; an expiry at its time', async () => {
  const u = await signup(t);
  await t.api('POST', '/api/billing/appstore/verify', { signedTransaction: jws(tx(u.id)) }, u.token);
  const notify = (type: string, over: object) => t.api('POST', '/api/billing/appstore/notify', { signedPayload: jws({ notificationType: type, data: { bundleId: 'com.ozymandosis.game', signedTransactionInfo: jws(tx(u.id, over)), signedRenewalInfo: jws({ autoRenewStatus: 0 }) } }) });
  assert.equal((await notify('DID_CHANGE_RENEWAL_STATUS', {})).status, 200);
  let e = await me(u.token, 'ios'); assert.equal(e.subscriber, true); assert.equal(e.cancelAtPeriodEnd, true);
  await notify('REFUND', { revocationDate: Date.now() - 1000 });
  assert.equal((await me(u.token, 'ios')).subscriber, false);
  assert.equal((await t.api('POST', '/api/billing/appstore/notify', { signedPayload: jws({ notificationType: 'TEST' }, rogue) })).status, 400, 'unsigned notifications are refused');
});

test('ownership on iOS: AppTransaction signed by Apple', async () => {
  const u = await signup(t);
  assert.equal((await t.api('POST', '/api/ownership/ios', { appTransaction: jws({ bundleId: 'com.ozymandosis.game', environment: 'Sandbox', appTransactionId: 'x' }, rogue) }, u.token)).status, 400);
  assert.equal((await t.api('POST', '/api/ownership/ios', { appTransaction: jws({ bundleId: 'com.other.app', environment: 'Sandbox' }) }, u.token)).status, 400);
  assert.equal((await t.api('POST', '/api/ownership/ios', { appTransaction: jws({ bundleId: 'com.ozymandosis.game', environment: 'Sandbox', appTransactionId: 'x' }) }, u.token)).status, 200);
  assert.deepEqual((await t.api('GET', '/api/ownership', undefined, u.token)).json.platforms.map((p: any) => p.platform), ['ios']);
});

test('ownership on Android: Play Integrity, licensed and Play-recognised, with our nonce', async () => {
  const u = await signup(t), v = await signup(t);
  const { nonce } = (await t.api('GET', '/api/ownership/nonce', undefined, u.token)).json;
  const verdict = (n: string, lic = 'LICENSED', rec = 'PLAY_RECOGNIZED'): PlayIntegrity => ({ requestDetails: { requestPackageName: 'com.ozymandosis.game', nonce: n }, appIntegrity: { appRecognitionVerdict: rec }, accountDetails: { appLicensingVerdict: lic } });
  verdicts.set('unlicensed', verdict(nonce, 'UNLICENSED')); verdicts.set('sideloaded', verdict(nonce, 'LICENSED', 'UNRECOGNIZED_VERSION')); verdicts.set('good', verdict(nonce));
  assert.equal((await t.api('POST', '/api/ownership/android', { nonce, integrityToken: 'forged' }, u.token)).status, 400, 'Google does not know it');
  assert.equal((await t.api('POST', '/api/ownership/android', { nonce, integrityToken: 'unlicensed' }, u.token)).status, 403, 'not bought');
  assert.equal((await t.api('POST', '/api/ownership/android', { nonce, integrityToken: 'sideloaded' }, u.token)).status, 403, 'not from Play');
  assert.equal((await t.api('POST', '/api/ownership/android', { nonce, integrityToken: 'good' }, v.token)).status, 400, "another account's nonce");
  assert.equal((await t.api('POST', '/api/ownership/android', { nonce, integrityToken: 'good' }, u.token)).status, 200);
});

test('ownership on Steam, and the season: the Steam subscription, on Steam only', async () => {
  const u = await signup(t);
  assert.equal((await t.api('POST', '/api/ownership/steam', {}, u.token)).json.code, 'steam_link', 'needs a linked Steam account');
  await t.ctx.db.query(`insert into identities (provider, subject, user_id) values ('steam', '7656', $1)`, [u.id]);
  assert.equal((await t.api('POST', '/api/ownership/steam', {}, u.token)).status, 403, 'does not own the game');
  steamOwned.add('7656:1000'); steamOwned.add('7656:2026');
  let r = await t.api('POST', '/api/ownership/steam', {}, u.token);
  assert.equal(r.status, 200); assert.deepEqual(r.json.seasons, [], 'last season has ended');
  assert.equal((await me(u.token, 'steam')).subscriber, false);
  steamOwned.add('7656:2027');
  r = await t.api('POST', '/api/ownership/steam', {}, u.token);
  assert.deepEqual(r.json.seasons, ['2027']);
  assert.equal((await me(u.token, 'steam')).subscriber, true);
  assert.equal((await me(u.token, 'android')).subscriber, false, 'the season is a Steam subscription');
});

test('production rules: browsers cannot play online, and a store app needs a verified purchase on its platform', async () => {
  const p = await boot({ REQUIRE_STORE_CLIENT: 'true' }, { play });
  try {
    const u = await signup(p);
    // the first thing the service says to each kind of client
    const { WebSocket } = await import('ws');
    const said = (platform: string) => new Promise<any>(res => { const ws = new WebSocket(`ws://127.0.0.1:${p.port}/ws`); ws.on('open', () => ws.send(JSON.stringify({ op: 'auth', token: u.token, version: '9.9.9', proto: 2, platform }))); ws.on('message', d => { res(JSON.parse(d.toString())); ws.close(); }); });
    assert.equal((await said('web')).code, 'app_only');
    assert.equal((await said('ios')).code, 'ownership', 'the iOS app, but no verified purchase yet');
    await p.api('POST', '/api/ownership/ios', { appTransaction: jws({ bundleId: 'com.ozymandosis.game', environment: 'Sandbox', appTransactionId: 'y' }) }, u.token);
    assert.equal((await said('ios')).op, 'hello', 'verified: online');
    assert.equal((await said('android')).code, 'ownership', 'bought on iOS does not make the Android copy bought');
  } finally { await p.app.close(); }
});
