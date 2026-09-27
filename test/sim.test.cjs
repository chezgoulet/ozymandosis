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
test('custom and scattered maps', () => {
  const m = E.generateMap(Object.assign({}, E.DEFAULT_MAP, { size: 'custom', w: 9000, h: 6000, layout: 'scatter', seed: 5 }), Array.from({ length: 6 }, () => ({ team: 0 })));
  if (m.w !== 9000 || m.h !== 6000 || m.starts.length !== 6) throw new Error('custom map');
  const w = new E.World({ cfg: { map: { size: 'custom', w: 2000, h: 1400, layout: 'scatter', seed: 2 }, players: [{ culture: 'bloom', kind: 'bot' }, { culture: 'current', kind: 'bot' }] } });
  for (let i = 0; i < 30 * 60; i++) w.step();
});
test('queued waypoints, patrol and undo restore', () => {
  const w = new E.World({ cfg: { map: { size: 's', seed: 4, currents: false }, players: [{ culture: 'verdant', kind: 'human' }, { culture: 'bloom', kind: 'human' }] } });
  const u = w.s.units.find(u => u.o === 0 && u.d === 'warden');
  w.command(0, { c: 'move', ids: [u.id], x: u.x + 200, y: u.y });
  w.command(0, { c: 'move', ids: [u.id], x: u.x + 200, y: u.y + 200, queue: true });
  w.command(0, { c: 'amove', ids: [u.id], x: u.x, y: u.y + 200, queue: true });
  w.step();
  if (u.q.length !== 2) throw new Error('queue ' + u.q.length);
  for (let i = 0; i < 30 * 30 && u.q.length; i++) w.step();
  if (u.q.length) throw new Error('queue not consumed');
  const before = JSON.parse(JSON.stringify({ order: u.order, q: u.q }));
  w.command(0, { c: 'patrol', ids: [u.id], x: u.x + 300, y: u.y }); w.step();
  if (u.order.t !== 'patrol') throw new Error('no patrol');
  const x0 = u.order.x; for (let i = 0; i < 30 * 20; i++) w.step();
  if (u.order.t !== 'patrol') throw new Error('patrol ended');
  w.command(0, { c: 'restore', orders: [{ id: u.id, order: before.order, q: before.q }] }); w.step();
  if (u.order.t !== before.order.t) throw new Error('restore failed');
});
test('win conditions: heartfall, tide, luminance', () => {
  for (const mode of ['regicide', 'tide', 'bloom']) {
    const w = new E.World({ cfg: { map: { size: 's', seed: 8, mode, goal: mode === 'tide' ? 60 : mode === 'bloom' ? 2500 : undefined }, players: [{ culture: 'verdant', kind: 'bot', diff: 'hard' }, { culture: 'current', kind: 'bot' }] } });
    while (!w.s.over && w.s.t < 1200) w.step();
    console.log(`     ${mode}: over=${w.s.over} winner=${w.s.winner} t=${E.fmtTime(w.s.t)} score=${JSON.stringify(w.s.obj && w.s.obj.score)}`);
    if (!w.s.over) throw new Error(mode + ' never ended');
  }
});
test('culture counters and personas are deterministic', () => {
  const w = new E.World({ cfg: { map: { size: 's', seed: 2 }, players: [{ culture: 'bloom', kind: 'bot' }, { culture: 'verdant', kind: 'bot' }] } });
  if (w.counterMul(0, 1) !== 1.12 || w.counterMul(1, 0) !== 0.92) throw new Error('counter');
  for (const persona of Object.keys(E.PERSONAS)) {
    const mk = () => new E.World({ cfg: { map: { size: 's', seed: 3 }, players: [{ culture: 'luminant', kind: 'bot', persona }, { culture: 'choir', kind: 'bot', persona }] } });
    const a = mk(), b = mk(); for (let i = 0; i < 30 * 120; i++) { a.step(); b.step(); }
    if (a.serialize() !== b.serialize()) throw new Error('persona nondeterministic ' + persona);
  }
});
