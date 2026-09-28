import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { boot, signup, code, type T } from './helpers.js';

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

test('sign up, verify email, sign in, and see the account', async () => {
  const u = await signup(t);
  const me = await t.api('GET', '/api/me', undefined, u.token);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.emailVerified, true);
  assert.equal(me.json.entitlements.subscriber, false);
  assert.equal(me.json.entitlements.freeMatchMinutes, 15);
  const bad = await t.api('POST', '/api/auth/login', { email: u.email, password: 'wrong password!!', client: 'game' });
  assert.equal(bad.status, 401);
  const ok = await t.api('POST', '/api/auth/login', { email: u.email.toUpperCase(), password: u.password, client: 'game' });
  assert.equal(ok.status, 200); assert.ok(ok.json.token);
  const dup = await t.api('POST', '/api/auth/signup', { email: u.email, password: 'another good password', client: 'game', birthYear: 1990, birthMonth: 1 });
  assert.equal(dup.status, 409);
  const weak = await t.api('POST', '/api/auth/signup', { email: 'weak@example.com', password: 'short', client: 'game', birthYear: 1990, birthMonth: 1 });
  assert.equal(weak.status, 400);
});

test('web sessions use an HttpOnly cookie and need the x-ozy header to change state', async () => {
  const u = await signup(t);
  const r = await t.api('POST', '/api/auth/login', { email: u.email, password: u.password, client: 'web' });
  const cookie = String(r.headers['set-cookie']);
  assert.match(cookie, /ozy_session=/); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i);
  const c = cookie.split(';')[0];
  assert.equal((await t.api('GET', '/api/me', undefined, undefined, { cookie: c })).status, 200);
  assert.equal((await t.api('PATCH', '/api/me', { crashReports: false }, undefined, { cookie: c })).status, 401, 'cross-site style request without header is refused');
  assert.equal((await t.api('PATCH', '/api/me', { crashReports: false }, undefined, { cookie: c, 'x-ozy': '1' })).status, 200);
});

test('two-factor: setup, enable, sign in with a code, recovery codes, disable', async () => {
  const u = await signup(t);
  const s = await t.api('POST', '/api/me/mfa/setup', {}, u.token);
  assert.equal(s.status, 200); assert.match(s.json.uri, /^otpauth:\/\/totp\//); assert.match(s.json.qr, /<svg/);
  assert.equal((await t.api('POST', '/api/me/mfa/enable', { code: '000000' }, u.token)).status, 400);
  const en = await t.api('POST', '/api/me/mfa/enable', { code: code(s.json.secret) }, u.token);
  assert.equal(en.status, 200); assert.equal(en.json.recoveryCodes.length, 10);
  assert.ok(t.mailer.outbox.some(m => m.to === u.email && /Two-factor/.test(m.subject)));
  const login = await t.api('POST', '/api/auth/login', { email: u.email, password: u.password, client: 'game' });
  assert.equal(login.json.mfa, 'required'); assert.ok(!login.json.token);
  const replay = await t.api('POST', '/api/auth/mfa', { challenge: login.json.challenge, code: code(s.json.secret) });
  assert.equal(replay.status, 401, 'the code used to enable cannot be replayed');
  const next = await t.api('POST', '/api/auth/mfa', { challenge: login.json.challenge, code: code(s.json.secret, 1) });
  assert.equal(next.status, 200); assert.ok(next.json.token);
  const rec = await t.api('POST', '/api/auth/mfa', { challenge: login.json.challenge, recovery: en.json.recoveryCodes[0] });
  assert.equal(rec.status, 200);
  const reuse = await t.api('POST', '/api/auth/mfa', { challenge: login.json.challenge, recovery: en.json.recoveryCodes[0] });
  assert.equal(reuse.status, 401, 'recovery codes are single use');
  const tampered = await t.api('POST', '/api/auth/mfa', { challenge: login.json.challenge.slice(0, -2) + 'xx', code: '123456' });
  assert.equal(tampered.status, 401);
});

test('password reset revokes every session', async () => {
  const u = await signup(t);
  await t.api('POST', '/api/auth/forgot', { email: u.email });
  const link = t.mailer.outbox.filter(m => m.to === u.email && /Reset/.test(m.subject)).pop()!.text;
  const token = /token=([A-Za-z0-9_-]+)/.exec(link)![1];
  assert.equal((await t.api('POST', '/api/auth/reset', { token, password: 'a brand new password' })).status, 200);
  assert.equal((await t.api('GET', '/api/me', undefined, u.token)).status, 401);
  assert.equal((await t.api('POST', '/api/auth/reset', { token, password: 'another new password' })).status, 400, 'links are single use');
  assert.equal((await t.api('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).status, 200, 'no account enumeration');
});

test('game client hand-off: browser approves, client claims once', async () => {
  const u = await signup(t);
  const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const h = await t.api('POST', '/api/auth/handoff', { challenge });
  assert.match(h.json.url, /\/login\?handoff=/);
  assert.equal((await t.api('POST', '/api/auth/handoff/claim', { verifier })).json.pending, true);
  assert.equal((await t.api('POST', '/api/auth/handoff/approve', { handoff: challenge }, u.token)).status, 200);
  const c = await t.api('POST', '/api/auth/handoff/claim', { verifier });
  assert.equal(c.status, 200); assert.ok(c.json.token);
  assert.equal((await t.api('GET', '/api/me', undefined, c.json.token)).json.user.id, u.id);
  assert.equal((await t.api('POST', '/api/auth/handoff/claim', { verifier })).status, 400, 'claimed only once');
});

test('profile: rename rules, sessions, export, delete', async () => {
  const u = await signup(t);
  assert.equal((await t.api('PATCH', '/api/me', { name: 'Fuuuck' }, u.token)).status, 400);
  assert.equal((await t.api('PATCH', '/api/me', { name: 'Brass Lantern' }, u.token)).status, 200);
  const other = await signup(t);
  assert.equal((await t.api('PATCH', '/api/me', { name: 'brass lantern' }, other.token)).status, 409, 'names are unique ignoring case');
  const sess = await t.api('GET', '/api/me/sessions', undefined, u.token);
  assert.ok(sess.json.sessions.some((s: any) => s.current));
  const ex = await t.api('GET', '/api/me/export', undefined, u.token);
  assert.equal(ex.json.user.email, u.email);
  assert.equal((await t.api('DELETE', '/api/me', { password: 'wrong', confirm: 'DELETE' }, u.token)).status, 401);
  assert.equal((await t.api('DELETE', '/api/me', { password: u.password, confirm: 'DELETE' }, u.token)).status, 200);
  assert.equal((await t.api('POST', '/api/auth/login', { email: u.email, password: u.password, client: 'game' })).status, 401);
  const row = await t.ctx.db.one<any>('select email, status, display_name from users where id = $1', [u.id]);
  assert.equal(row.email, null); assert.equal(row.status, 'deleted');
});

test('dev OAuth provider signs in through the browser flow and links an identity', async () => {
  const start = await t.app.inject({ method: 'GET', url: '/auth/dev/start' });
  const state = /state=([A-Za-z0-9_-]+)/.exec(start.body)![1];
  const cb = await t.app.inject({ method: 'POST', url: `/auth/dev/callback?state=${state}`, payload: 'subject=abc123&name=Lantern Keeper', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(cb.statusCode, 302); assert.match(String(cb.headers['set-cookie']), /ozy_session=/);
  const again = await t.app.inject({ method: 'GET', url: '/auth/dev/start' });
  const st2 = /state=([A-Za-z0-9_-]+)/.exec(again.body)![1];
  await t.app.inject({ method: 'POST', url: `/auth/dev/callback?state=${st2}`, payload: 'subject=abc123', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const n = await t.ctx.db.one<any>(`select count(*)::int as n from identities where provider = 'dev' and subject = 'abc123'`);
  assert.equal(n.n, 1, 'same identity resolves to the same account');
  const replay = await t.app.inject({ method: 'POST', url: `/auth/dev/callback?state=${state}`, payload: 'subject=zzz', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(replay.statusCode, 400, 'state is single use');
});

test('logs contain no emails, tokens or IPs', async () => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  const { boot: b2 } = await import('./helpers.js');
  (process.stdout as any).write = (s: any, ...a: any[]) => { lines.push(String(s)); return orig(s, ...a); };
  const t2 = await b2({ LOG_LEVEL: 'info' });
  try {
    const u = await signup(t2, { email: 'secret.person@example.com' });
    await t2.api('GET', '/api/me', undefined, u.token, { 'x-forwarded-for': '203.0.113.9' });
    await t2.api('POST', '/api/auth/login', { email: 'secret.person@example.com', password: 'nope nope nope', client: 'game' });
  } finally { (process.stdout as any).write = orig; await t2.app.close(); }
  const all = lines.filter(l => !l.includes('Server listening')).join('');
  assert.ok(all.includes('"r":"/api/me"'), 'requests are logged');
  assert.doesNotMatch(all, /secret\.person|203\.0\.113\.9|127\.0\.0\.1|Bearer/);
});
