// SPDX-License-Identifier: AGPL-3.0-only
// Playwright for tests and tools, wherever it lives: PW (a path), a playwright or
// playwright-core install in this repo, or this machine's shared copy.
//   BROWSER=chromium (default) | firefox | webkit     CHROME=/path/to/chromium
//
// Browsers launch silent. CI runs on the workstation its owner is sitting at, the game
// starts its music on the first click, and these jobs play the game for minutes at a
// time — so an unmuted leg plays Ozymandosis out of the room.
//   • Chromium is already covered: Playwright passes --mute-audio by default (it is in
//     its default arguments; `ignoreDefaultArgs: ['--mute-audio']` is the documented way
//     to turn it back on). Nothing to add here, and adding it again would only suggest
//     this file is what silences Chromium.
//   • Firefox is not: media.volume_scale is set to zero below.
//   • WebKit has no launch flag for it and is the one leg that can still make a noise —
//     if it does, give the job a null sink, as test/steamrt.test.cjs already does.
// AUDIO=1 opts a leg back into sound.
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
  const quiet = opts.audio !== true && process.env.AUDIO !== '1';
  if (name === 'chromium') {
    o.args = opts.args || [];
    const exe = process.env.CHROME || (process.env.PW || !fs.existsSync(LOCAL_CHROME) ? undefined : LOCAL_CHROME);
    if (exe) o.executablePath = exe;
  }
  // loopback WebRTC between two pages needs real host candidates
  if (name === 'firefox') o.firefoxUserPrefs = Object.assign({
    'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.navigator.permission.disabled': true, 'media.peerconnection.ice.loopback': true,
  }, quiet ? { 'media.volume_scale': '0.0' } : {});
  return L[name].launch(o);
};
