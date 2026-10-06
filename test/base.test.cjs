// Which play service the client talks to (O.base). Native builds run from https://localhost
// (Capacitor), so "localhost" alone must not mean a development machine.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '../js/net/online.js'), 'utf8');
function base(href, native) {
  const E = { Settings: {}, LS: { get: () => null, set() {}, del() {} }, Native: native ? { is: true, platform: native } : { is: false, platform: 'web' } };
  const u = new URL(href);
  vm.runInNewContext(SRC, { window: { E }, location: { search: u.search, hostname: u.hostname }, URLSearchParams, setTimeout, clearTimeout, console });
  return E.Online.base();
}
let fails = 0;
const test = (n, f) => { try { f(); console.log('ok  ', n); } catch (e) { fails++; console.log('FAIL', n, '\n', e.message); } };
test('android build (https://localhost) uses the production service', () => assert.strictEqual(base('https://localhost/', 'android'), 'https://play.ozymandosis.com'));
test('ios build (capacitor://localhost) uses the production service', () => assert.strictEqual(base('capacitor://localhost/', 'ios'), 'https://play.ozymandosis.com'));
test('a browser on localhost uses the local dev service', () => assert.strictEqual(base('http://localhost:8080/', null), 'http://localhost:8787'));
test('?play= overrides everything', () => assert.strictEqual(base('https://localhost/?play=http://x:1/', 'android'), 'http://x:1'));
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
