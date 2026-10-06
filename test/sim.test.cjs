// SPDX-License-Identifier: AGPL-3.0-only
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
test('healing: slow knitting out of combat, fast paid mending at the nest, Mend order, structures regrow', () => {
  const w = new E.World({ cfg: { map: { size: 's', seed: 7, powerups: 0, currents: false, fog: false }, players: [{ culture: 'verdant', kind: 'human', team: 0 }, { culture: 'bloom', kind: 'human', team: 0 }] } });
  const s = w.s, u = s.units.find(x => x.o === 0), st = w.stats(u), nest = s.structs.find(b => b.o === 0 && b.kind === 'nucleus');
  const away = () => { u.x = nest.x + 900 * Math.sign(s.map.w / 2 - nest.x || 1); u.y = nest.y; u.order = { t: 'hold', x: u.x, y: u.y }; };
  const steps = sec => { for (let i = 0; i < Math.round(sec * 30); i++) { w.step(); if (u.order.t === 'hold') { u.x = u.order.x; u.y = u.order.y; } } };
  away(); w.damage(u, st.hp * 0.6, 1, null); const hurt = u.hp;
  steps(4); assert(Math.abs(u.hp - hurt) < 0.01, 'no knitting while the wound is fresh');
  steps(6); const knit = (u.hp - hurt) / st.hp; assert(knit > 0.03 && knit < 0.08, 'about 1% a second once out of combat: ' + knit.toFixed(3));
  // nest: fast and paid
  u.hp = st.hp; u.x = nest.x + 60; u.y = nest.y; u.order = { t: 'hold', x: u.x, y: u.y }; w.damage(u, st.hp * 0.5, 1, null);
  const h0 = u.hp, l0 = s.players[0].lumen; steps(4);
  assert(u.hp - h0 > st.hp * 0.2, 'mends fast beside the nest'); void l0;
  // without lumen the nest cannot pay: only natural knitting remains
  u.hp = st.hp * 0.3; u.lastHit = { o: 1, t: s.t, src: 0 }; s.players[0].lumen = 0; s.players[0].income = 0; const h1 = u.hp; steps(4);
  assert(u.hp - h1 < st.hp * 0.05, 'no lumen, no fast mending'); s.players[0].lumen = 500; s.players[0].income = 1;
  assert(s.players[0].stats.mended > 0);
  // Mend order brings it home and releases it when whole
  u.hp = st.hp; away(); w.damage(u, st.hp * 0.7, 1, null); u.lastHit.t = s.t - 10;
  w.command(0, { c: 'mend', ids: [u.id] }); w.step(); assert.strictEqual(u.order.t, 'mend');
  for (let i = 0; i < 30 * 60 && u.order.t === 'mend'; i++) w.step();
  assert.strictEqual(u.order.t, 'idle', 'released when whole'); assert(u.hp >= st.hp - 0.5, 'whole');
  assert(Math.hypot(u.x - nest.x, u.y - nest.y) < 200, 'at home');
  // structures regrow once left alone
  const sd = E.STRUCTS.nucleus; w.damage(nest, 1000, 1, null); const b0 = nest.hp;
  for (let i = 0; i < 30 * 5; i++) w.step(); assert(nest.hp - b0 < 1, 'not while freshly hit');
  for (let i = 0; i < 30 * 10; i++) w.step(); assert(nest.hp - b0 > sd.hp * 0.004 * 5, 'regrows slowly');
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
