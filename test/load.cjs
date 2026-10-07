// SPDX-License-Identifier: AGPL-3.0-only
// Loads the browser-style scripts into a Node vm context for headless tests.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SIM = ['js/core/seed.js', 'js/core/util.js', 'js/data/organs.js', 'js/data/chassis.js', 'js/data/specials.js', 'js/data/techs.js', 'js/sim/stats.js', 'js/sim/mapgen.js', 'js/sim/world.js', 'js/sim/ai.js'];
module.exports = function load(extra) {
  const ctx = { console, Math, JSON, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, performance: globalThis.performance, Promise, Map, Set, TextEncoder, TextDecoder, Uint8Array, Float32Array, Int32Array, Uint16Array, Int16Array, DataView, ArrayBuffer };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of SIM.concat(extra || [])) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.E;
};
module.exports.SIM = SIM;
