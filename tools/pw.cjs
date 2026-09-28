// Playwright for tests and tools, wherever it lives: PW (a path), a playwright or
// playwright-core install in this repo, or this machine's shared copy.
//   BROWSER=chromium (default) | firefox | webkit     CHROME=/path/to/chromium
const fs = require('fs'), path = require('path');
function lib() {
  for (const c of [process.env.PW, 'playwright', 'playwright-core', '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core']) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error('Playwright not found. npm i -D playwright && npx playwright install --with-deps');
}
const LOCAL_CHROME = path.join(process.env.HOME || '', '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
exports.name = process.env.BROWSER || 'chromium';
exports.launch = (opts = {}) => {
  const L = lib(), name = opts.browser || exports.name, o = { headless: opts.headless !== false };
  if (name === 'chromium') {
    o.args = opts.args || [];
    const exe = process.env.CHROME || (process.env.PW || !fs.existsSync(LOCAL_CHROME) ? undefined : LOCAL_CHROME);
    if (exe) o.executablePath = exe;
  }
  // loopback WebRTC between two pages needs real host candidates
  if (name === 'firefox') o.firefoxUserPrefs = { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.navigator.permission.disabled': true, 'media.peerconnection.ice.loopback': true };
  return L[name].launch(o);
};
