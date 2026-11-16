// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotp, verifyTotp, base32, unbase32, newTotpSecret, stepAt } from '../src/lib/totp.js';
import { validateName, filterChat, skeleton } from '../src/lib/names.js';
import { scrub, coarseClient } from '../src/lib/privacy.js';
import { Secrets, TicketSigner } from '../src/lib/crypto.js';
import { fingerprint } from '../src/reports/routes.js';
import { loadConfig } from '../src/config.js';
import { captchaOk } from '../src/auth/routes.js';
import { validEmail } from '../src/auth/service.js';
import { templates } from '../src/lib/mail.js';

test('TOTP matches RFC 6238 vectors and rejects replays', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(hotp(secret, Math.floor(59 / 30)), '287082');          // RFC 6238, SHA-1, T=59 (last 6 digits)
  assert.equal(hotp(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(unbase32(base32(Buffer.from('hello'))).toString(), 'hello');
  const s = newTotpSecret(), now = Date.now(), step = stepAt(now);
  assert.equal(verifyTotp(s, hotp(s, step), null, now), step);
  assert.equal(verifyTotp(s, hotp(s, step - 1), null, now), step - 1, 'accepts one step of drift');
  assert.equal(verifyTotp(s, hotp(s, step), step, now), null, 'a used step cannot be replayed');
  assert.equal(verifyTotp(s, '12345', null, now), null);
});

test('names: filter slurs and evasions, keep innocent words, reserve staff names', () => {
  assert.equal(validateName('Tidecaller').ok, true);
  assert.equal(validateName('Grape Spice').ok, true, 'no Scunthorpe false positives');
  assert.equal(validateName('Peacock').ok, true);
  assert.equal(validateName('f u c k').ok, false);
  assert.equal(validateName('Fuuuck3r').ok, false);
  assert.equal(validateName('xx').ok, false);
  assert.equal(validateName('Admin').ok, false);
  assert.equal(validateName('Ozymandosis Staff').ok, false);
  assert.equal(skeleton('Sh1iiit'), 'shit');
  const c = filterChat('gg you fucking legend');
  assert.equal(c.masked, true); assert.match(c.text, /^gg you •+ legend$/);
});

test('privacy: scrub removes emails, IPs, home paths and tokens', () => {
  const s = scrub('user bob@mail.com at 10.0.0.1 in /home/bob/x.js with token ' + 'a'.repeat(64));
  assert.doesNotMatch(s, /bob@|10\.0\.0\.1|\/home\/bob|aaaaaaaa/);
  assert.equal(coarseClient('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile'), 'Chrome on Android');
});

test('crypto: encryption round-trips, tickets verify and detect tampering', () => {
  const sec = new Secrets(Buffer.alloc(32, 7));
  assert.equal(sec.decrypt(sec.encrypt('secret')), 'secret');
  const box = sec.encrypt('secret').split('.');
  box[2] = (box[2][0] === 'A' ? 'B' : 'A') + box[2].slice(1); // flip the first ciphertext character
  assert.throws(() => sec.decrypt(box.join('.')), 'tampering is detected');
  const { signer } = TicketSigner.generate('k1');
  const t = signer.sign({ players: [{ id: 0, until: 1 }] });
  assert.deepEqual(signer.verify(t), { players: [{ id: 0, until: 1 }] });
  const [id, body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ players: [{ id: 0, until: null }] })).toString('base64url');
  assert.equal(signer.verify(`${id}.${forged}.${sig}`), null);
  assert.equal(TicketSigner.load('k1', TicketSigner.generate('k1').privatePem).verify(t), null, 'another key cannot verify');
  void body;
});

test('reports: fingerprints ignore line numbers and origins', () => {
  const a = fingerprint('crash', 'Cannot read properties of undefined (reading \'x\')', 'TypeError\n    at step (http://localhost:8080/js/sim/world.js:120:14)\n    at loop (http://localhost:8080/js/ui/game.js:200:3)');
  const b = fingerprint('crash', 'Cannot read properties of undefined (reading \'y\')', 'TypeError\n    at step (capacitor://localhost/js/sim/world.js:131:9)\n    at loop (capacitor://localhost/js/ui/game.js:210:3)');
  assert.equal(a.fp, b.fp);
  assert.notEqual(a.fp, fingerprint('crash', 'Other', 'at other (x.js:1:1)').fp);
});

test('NODE_ENV has no default: a server that forgets it refuses to boot', () => {
  // The whole point: an unset NODE_ENV used to mean "development", which opened a passwordless
  // sign-in, the mail outbox, cookies without Secure and the fixed development encryption key.
  assert.throws(() => loadConfig({} as any), /NODE_ENV must be set explicitly/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' } as any), /Production requires/);
});

test('the development sign-in needs DEV_AUTH as well as a non-production NODE_ENV', () => {
  const dev = loadConfig({ NODE_ENV: 'development' } as any);
  assert.equal(dev.dev, true);
  assert.equal(dev.DEV_AUTH, false, 'not available unless it is asked for');

  const asked = loadConfig({ NODE_ENV: 'development', DEV_AUTH: '1' } as any);
  assert.equal(asked.DEV_AUTH, true);

  // ...and never in production, however the flag is set.
  const prod = loadConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/d',
    SECRET_KEY: Buffer.alloc(32, 7).toString('base64'), SMTP_URL: 'smtps://u:p@smtp.example:465',
    DEV_AUTH: '1',
  } as any);
  assert.equal(prod.prod, true);
  assert.equal(prod.DEV_AUTH, true, 'the flag is recorded, and the route gate refuses it in production');
});

test('sign-up refuses rather than waving everyone through when no captcha is configured in production', async () => {
  // The old behaviour returned true when TURNSTILE_SECRET was unset, so a production server that
  // never configured Turnstile accepted unlimited sign-ups — the live state when this was filed.
  const prod = { cfg: { prod: true, TURNSTILE_SECRET: undefined } } as any;
  await assert.rejects(() => captchaOk(prod, undefined), (e: any) => e.status === 503 && e.code === 'captcha_unconfigured');
  // Local development is unaffected: no captcha service is reachable from a laptop.
  const dev = { cfg: { prod: false, TURNSTILE_SECRET: undefined } } as any;
  assert.equal(await captchaOk(dev, undefined), true);
});

test('validEmail refuses the characters that turn one recipient into another', () => {
  // These are the shapes nodemailer's addressparser advisories are about; the only legitimate use
  // is a quoted local part, which this app does not accept.
  for (const bad of ['a<b>@example.com', '"a"@example.com', 'a;b@example.com', 'a,b@example.com', 'a b@example.com', 'a@exa<mple.com', 'a@exa;mple.com', 'no-at-sign.example.com', 'a@example']) {
    assert.equal(validEmail(bad), false, bad);
  }
  for (const good of ['player@example.com', 'first.last+tag@sub.example.co.uk', "o'brien@example.com"]) {
    assert.equal(validEmail(good), true, good);
  }
});

test('transactional mail escapes what it interpolates into the HTML', () => {
  const html = templates.emailChanged('<img src=x onerror=alert(1)>@example.com').html!;
  assert.ok(!html.includes('<img'), 'the address must not survive as markup');
  assert.ok(html.includes('&lt;img'), 'it appears escaped instead');
});
