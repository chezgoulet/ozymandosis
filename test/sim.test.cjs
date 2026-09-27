const E = require('./load.cjs')();
const assert = require('assert');
let fails = 0;
function test(name, fn) { const t0 = Date.now(); try { fn(); console.log('ok  ', name, `(${Date.now() - t0}ms)`); } catch (e) { fails++; console.log('FAIL', name, '\n', e.stack); } }

const cultures = E.CULTURE_LIST.map(c => c.id);
function cfg(n, size, seed, diffs) {
  return { map: { size, seed, powerups: 1, currents: true }, players: Array.from({ length: n }, (_, i) => ({ culture: cultures[(i + seed) % 6], kind: 'bot', diff: (diffs || ['normal'])[i % (diffs || ['normal']).length], team: 0 })) };
}
function run(w, maxT) { while (!w.s.over && w.s.t < maxT) w.step(); return w; }

test('content counts', () => {
  assert.strictEqual(E.ORGAN_LIST.length, 30);
  assert.strictEqual(E.CHASSIS_LIST.length, 6);
  assert.strictEqual(E.ABILITY_LIST.length, 12);
  assert.strictEqual(E.POWER_LIST.length, 12);
  assert.strictEqual(E.POWERUP_LIST.length, 12);
  for (const c of E.CLASS_IDS) assert.strictEqual(E.organsOf(c).length, 6);
});
test('every organ × chassis computes finite stats', () => {
  for (const ch of E.CHASSIS_LIST) for (const o of E.ORGAN_LIST) for (const v of [0, 9]) {
    const s = E.computeStats({ chassis: ch.id, organs: [o.id] }, {}, { v: [v] });
    for (const k of ['hp', 'speed', 'dps', 'cost', 'hatch', 'vision']) assert(Number.isFinite(s[k]), `${ch.id}/${o.id}/${k}`);
  }
});
test('mapgen sizes and player counts', () => {
  for (const size of Object.keys(E.MAP_SIZES)) for (let n = 2; n <= 6; n++) {
    const m = E.generateMap(Object.assign({}, E.DEFAULT_MAP, { size, seed: n * 11 }), Array.from({ length: n }, () => ({ team: 0 })));
    assert.strictEqual(m.starts.length, n);
    assert(m.pools.length >= n * 4, 'pools');
    for (const s of m.starts) assert(s.x > 0 && s.y > 0 && s.x < m.w && s.y < m.h);
  }
});
test('save/load mid-game is deterministic', () => {
  const a = new E.World({ cfg: cfg(3, 's', 5) });
  for (let i = 0; i < 30 * 200; i++) a.step();
  const b = new E.World({ state: a.serialize() });
  for (let i = 0; i < 30 * 60; i++) { a.step(); b.step(); }
  assert.strictEqual(a.serialize(), b.serialize());
});
for (const [n, size, seed, diffs] of [[2, 's', 1, ['normal', 'hard']], [2, 'm', 2], [4, 'm', 3, ['easy', 'normal', 'hard', 'brutal']], [6, 'l', 4], [3, 'xl', 6, ['brutal']]]) {
  test(`bot game ${n}p ${size}`, () => {
    const w = new E.World({ cfg: cfg(n, size, seed, diffs) });
    const t0 = Date.now();
    run(w, 30 * 60);
    const s = w.s;
    const techs = s.players.map(p => p.specials.length + p.forms.length + Object.values(p.tier).reduce((a, b) => a + b, 0) + p.chassis.length);
    console.log(`     t=${E.fmtTime(s.t)} over=${s.over} winner=${s.winner} units=${s.units.length} structs=${s.structs.length} ms/tick=${((Date.now() - t0) / s.tick).toFixed(2)}`);
    console.log('     ' + s.players.map(p => `${p.culture}:${p.alive ? 'A' : 'x'} k${p.stats.kills} h${p.stats.hatched} g${Math.round(p.stats.gathered)} tech${techs[p.idx]} d${p.designs.length}`).join(' | '));
    assert(s.players.some(p => p.stats.kills > 0), 'no combat happened');
    assert(techs.some(t => t > 13), "little research");
  });
}
process.exitCode = fails ? 1 : 0;
