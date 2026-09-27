// Loads the browser-style scripts into a Node vm context for headless tests.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SIM = ['js/core/seed.js', 'js/core/util.js', 'js/data/organs.js', 'js/data/chassis.js', 'js/data/specials.js', 'js/data/techs.js', 'js/sim/stats.js', 'js/sim/mapgen.js', 'js/sim/world.js', 'js/sim/ai.js'];
module.exports = function load() {
  const ctx = { console, Math, JSON, Date, setTimeout };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of SIM) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.E;
};
module.exports.SIM = SIM;
