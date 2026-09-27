// Every ability, power and powerup does something observable.
const E = require('./load.cjs')();
const assert = require('assert');
let fails = 0;
const test = (n, f) => { try { f(); console.log('ok  ', n); } catch (e) { fails++; console.log('FAIL', n, '\n', e.stack.split('\n').slice(0, 4).join('\n')); } };
function arena() {
  const w = new E.World({ cfg: { map: { size: 's', seed: 3, powerups: 0, currents: false, fog: false }, players: [{ culture: 'luminant', kind: 'human' }, { culture: 'verdant', kind: 'human' }] } });
  w.s.units = []; w.index();
  return w;
}
function unit(w, o, chassis, organs, x, y) {
  const p = w.s.players[o]; const id = 't' + p.dseq++;
  p.designs.push({ id, name: id, chassis, organs });
  for (const org of organs) if (!p.forms.includes(org)) p.forms.push(org);
  if (!p.chassis.includes(chassis)) p.chassis.push(chassis);
  const u = w.spawnUnit(o, id, x, y, { fade: 1, noOrder: true }); u.order = { t: 'hold', x, y };
  return u;
}
function tick(w, n) { for (let i = 0; i < n; i++) w.step(); }

const ABILITY_SRC = {};
for (const o of E.ORGAN_LIST) if (o.ability) ABILITY_SRC[o.ability] = { chassis: 'serpent', organs: [o.id] };
for (const c of E.CHASSIS_LIST) if (c.ability) ABILITY_SRC[c.ability] = { chassis: c.id, organs: ['nippers'] };
test('every ability has a source', () => assert.strictEqual(Object.keys(ABILITY_SRC).length, 12));

for (const A of E.ABILITY_LIST) test(`ability ${A.id}`, () => {
  const w = arena(); const src = ABILITY_SRC[A.id];
  const me = unit(w, 0, src.chassis, src.organs, 1000, 800);
  const foes = [0, 1, 2, 3].map(i => unit(w, 1, 'serpent', ['cilia'], 1040 + i * 12, 800 + (i % 2) * 14));
  const ally = unit(w, 0, 'serpent', ['cilia'], 990, 820); ally.hp = 20;
  me.hp = w.stats(me).hp * 0.9;
  w.s.players[0].autocast = Object.fromEntries(E.ABILITY_LIST.map(a => [a.id, 1]));
  w.s.players[1].autocast = Object.fromEntries(E.ABILITY_LIST.map(a => [a.id, 1]));
  tick(w, 2);
  const before = JSON.stringify({ foes: foes.map(f => [Math.round(f.hp), Math.round(f.x), f.buffs.length]), me: [me.buffs.length, Math.round(me.x)], ally: Math.round(ally.hp), units: w.s.units.length, clouds: w.s.clouds.length, shots: w.s.shots.length });
  w.command(0, { c: 'ability', ids: [me.id], ab: A.id, x: 1060, y: 805, tid: foes[0].id });
  tick(w, A.id === 'spit' ? 12 : 2);
  assert(me.cds[A.id] > 0, 'went on cooldown');
  const after = JSON.stringify({ foes: foes.map(f => [Math.round(f.hp), Math.round(f.x), f.buffs.length]), me: [me.buffs.length, Math.round(me.x)], ally: Math.round(ally.hp), units: w.s.units.length, clouds: w.s.clouds.length, shots: w.s.shots.length });
  assert.notStrictEqual(before, after, 'no observable effect');
});

for (const P of E.POWER_LIST) test(`power ${P.id}`, () => {
  const w = arena(); const p = w.s.players[0];
  p.lumen = 5000; p.spore = 5000; p.specials.push('frenzy', 'flare', 'chitin');
  if (!p.specials.includes(P.id)) w.complete(p, 'power:' + P.id);
  assert(p.specials.includes(P.id));
  const u = unit(w, 0, 'serpent', ['nippers'], 1000, 800);
  const hp0 = w.stats(u).hp, armor0 = w.stats(u).armor;
  if (P.kind === 'active') {
    const snap = JSON.stringify([p.fever, w.s.clouds.length, w.s.units.length]);
    w.command(0, { c: 'power', id: P.id, x: 1000, y: 800 }); tick(w, 2);
    assert(p.powerCd[P.id] > 0, 'cooldown set');
    assert.notStrictEqual(JSON.stringify([p.fever, w.s.clouds.length, w.s.units.length]), snap, 'no effect');
  } else {
    // passives are flags consumed by rules; spot-check the ones that change stats
    if (P.id === 'hivemind') assert(w.stats(u).sense > 110);
  }
});

for (const U of E.POWERUP_LIST) test(`powerup ${U.id}`, () => {
  const w = arena(); const p = w.s.players[0];
  const u = unit(w, 0, 'serpent', ['nippers'], 1000, 800); u.hp = 30;
  const ally = unit(w, 0, 'serpent', ['cilia'], 1010, 810); ally.hp = 10;
  const snap = JSON.stringify([p.lumen | 0, p.spore | 0, p.echoT, p.coralT, u.buffs.length, u.rank, u.elite, Math.round(ally.hp), w.s.units.length]);
  const k = { id: w.id(), k: U.id, x: 1000, y: 800 }; w.s.pickups.push(k); w.index();
  tick(w, 1);
  assert(!w.s.pickups.length, 'collected');
  assert.notStrictEqual(JSON.stringify([p.lumen | 0, p.spore | 0, p.echoT, p.coralT, u.buffs.length, u.rank, u.elite, Math.round(ally.hp), w.s.units.length]), snap, 'no effect');
});

test('every organ changes stats', () => {
  for (const o of E.ORGAN_LIST) {
    const base = E.computeStats({ chassis: 'serpent', organs: [] }, {});
    const s = E.computeStats({ chassis: 'serpent', organs: [o.id] }, {});
    const diff = Object.keys(s).some(k => typeof s[k] === 'number' && k !== 'cost' && k !== 'hatch' && Math.abs(s[k] - base[k]) > 1e-6) || s.abilities.length > base.abilities.length;
    assert(diff, o.id);
  }
});
test('designs, conversions and structures', () => {
  const w = new E.World({ cfg: { map: { size: 's', seed: 9 }, players: [{ culture: 'umbral', kind: 'bot', diff: 'brutal' }, { culture: 'bloom', kind: 'bot' }] } });
  let conv = 0, buds = 0; const t = w.s;
  while (!t.over && t.t < 900) { w.step(); for (const e of w.drainEvents()) { if (e.e === 'convert') conv++; if (e.e === 'built') buds++; } }
  console.log(`     conversions=${conv} built=${buds} t=${E.fmtTime(t.t)}`);
  assert(conv > 0, 'umbral converted nobody'); assert(buds > 0, 'no structure built');
});
process.exitCode = fails ? 1 : 0;
