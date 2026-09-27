// Specials: 12 unit abilities, 12 colony powers (tech tree), 12 powerups.
// Effects operate on a World (js/sim/world.js) through its small helper API:
//   w.damage, w.heal, w.buff, w.enemiesNear, w.alliesNear, w.cloud, w.shot,
//   w.spawnUnit, w.event, w.stats(u), w.player(i), w.unitById
(function (E) {
  'use strict';
  const TAU = E.TAU;

  // ── 12 unit abilities ───────────────────────────────────────────
  // target: 'self' (instant), 'point' or 'unit'. auto(w,u,s) returns a cast target or null.
  const A = [
    { id: 'jet', name: 'Jet Dash', glyph: '➹', color: '#80d0ff', target: 'point', range: 230, cd: 10,
      desc: 'Blast forward up to 230 units in a burst of siphon-thrust.',
      auto(w, u, s) {
        const e = w.targetOf(u); if (e) { const d = E.dist(u, e); if (d > s.range + 40 && d < 260) return { x: e.x, y: e.y }; }
        if (u.hp < s.hp * 0.3) { const n = w.enemiesNear(u.o, u.x, u.y, 140)[0]; if (n) { const a = Math.atan2(u.y - n.y, u.x - n.x); return { x: u.x + Math.cos(a) * 200, y: u.y + Math.sin(a) * 200 }; } }
        return null;
      },
      cast(w, u, tg) { const a = Math.atan2(tg.y - u.y, tg.x - u.x), d = Math.min(230, Math.hypot(tg.x - u.x, tg.y - u.y)); u.a = a; u.dash = { vx: Math.cos(a) * d / 0.4, vy: Math.sin(a) * d / 0.4, t: 0.4 }; } },
    { id: 'ink', name: 'Ink Cloud', glyph: '◍', color: '#b090ff', target: 'self', cd: 22,
      desc: 'Release a cloud of ink. Enemies inside cannot target. Allies inside are hidden.',
      auto(w, u, s) { return u.hp < s.hp * 0.6 && w.enemiesNear(u.o, u.x, u.y, 110).length >= 2 ? u : null; },
      cast(w, u) { w.cloud({ kind: 'ink', o: u.o, x: u.x, y: u.y, r: 95, dur: 6 }); } },
    { id: 'dazzle', name: 'Dazzle', glyph: '✺', color: '#fff3a0', target: 'self', cd: 20,
      desc: 'A blinding photophore flash that stuns enemies within 110 for 2s.',
      auto(w, u) { return w.enemiesNear(u.o, u.x, u.y, 110).length >= 3 ? u : null; },
      cast(w, u) { for (const e of w.enemiesNear(u.o, u.x, u.y, 110)) if (e.kind === undefined) w.buff(e, 'stun', 2, 1, u.o); w.event('flash', { x: u.x, y: u.y, r: 110, o: u.o }); } },
    { id: 'camo', name: 'Camouflage', glyph: '◌', color: '#9ff6e4', target: 'self', cd: 25,
      desc: 'Turn glass-clear. Unseen for 8s, or until it bites.',
      auto(w, u, s) { return u.hp < s.hp * 0.5 && w.enemiesNear(u.o, u.x, u.y, 150).length ? u : null; },
      cast(w, u) { w.buff(u, 'camo', 8, 1, u.o); } },
    { id: 'spit', name: 'Spit Volley', glyph: '✶', color: '#60f0ff', target: 'point', range: 170, cd: 12,
      desc: 'Fire five nematocyst darts into an area. Each splashes 20.',
      auto(w, u, s) { const e = w.targetOf(u); return e && E.dist(u, e) < (s.shotRange || 170) ? { x: e.x, y: e.y } : null; },
      cast(w, u, tg) {
        const s = w.stats(u), dmg = (s.shot || 10) * 1.2;
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU, r = i ? 22 : 0; w.shot(u, tg.x + Math.cos(a) * r, tg.y + Math.sin(a) * r, dmg, { aoe: 20, speed: 340 + i * 20 }); }
      } },
    { id: 'venom', name: 'Venom Burst', glyph: '☣', color: '#9aff5a', target: 'point', range: 150, cd: 18,
      desc: 'Hurl a venom cloud: 8 poison per second and 30% slow for 5s.',
      auto(w, u) {
        const e = w.targetOf(u); if (!e || E.dist(u, e) > 150) return null;
        return w.enemiesNear(u.o, e.x, e.y, 80).length >= 3 ? { x: e.x, y: e.y } : null;
      },
      cast(w, u, tg) { w.cloud({ kind: 'venom', o: u.o, x: tg.x, y: tg.y, r: 80, dur: 5, dps: 8 }); } },
    { id: 'harden', name: 'Harden', glyph: '⬢', color: '#ffd28a', target: 'self', cd: 20,
      desc: 'Seal the plates: take 70% less damage for 5s, but cannot move.',
      auto(w, u, s) { return u.hp < s.hp * 0.45 && w.enemiesNear(u.o, u.x, u.y, 90).length ? u : null; },
      cast(w, u) { w.buff(u, 'harden', 5, 0.7, u.o); } },
    { id: 'lash', name: 'Tentacle Lash', glyph: '≋', color: '#ffa0d8', target: 'self', cd: 10,
      desc: 'Whip every enemy within 75 for 25 damage and knock them back.',
      auto(w, u) { return w.enemiesNear(u.o, u.x, u.y, 75).filter(e => e.kind === undefined).length >= 2 ? u : null; },
      cast(w, u) {
        for (const e of w.enemiesNear(u.o, u.x, u.y, 75)) {
          w.damage(e, 25, u.o, u, { ability: true });
          if (e.kind === undefined) { const a = Math.atan2(e.y - u.y, e.x - u.x); e.x += Math.cos(a) * 30; e.y += Math.sin(a) * 30; }
        }
        w.event('ring', { x: u.x, y: u.y, r: 75, o: u.o });
      } },
    { id: 'warsong', name: 'War Song', glyph: '♫', color: '#ffe066', target: 'self', cd: 30,
      desc: 'Allies within 200 bite 30% harder and swim 15% faster for 8s.',
      auto(w, u) { return w.alliesNear(u.o, u.x, u.y, 200).filter(a => a.engaged).length >= 3 ? u : null; },
      cast(w, u) { for (const a of w.alliesNear(u.o, u.x, u.y, 200)) w.buff(a, 'song', 8, 0.3, u.o); w.event('ring', { x: u.x, y: u.y, r: 200, o: u.o }); } },
    { id: 'mend', name: 'Mend Spores', glyph: '✚', color: '#9fffc0', target: 'self', cd: 15,
      desc: 'Burst healing spores: allies within 150 recover 40 HP.',
      auto(w, u) { return w.alliesNear(u.o, u.x, u.y, 150).some(a => a.hp < w.stats(a).hp * 0.6) ? u : null; },
      cast(w, u) { for (const a of w.alliesNear(u.o, u.x, u.y, 150)) w.heal(a, 40); w.event('heal', { x: u.x, y: u.y, r: 150, o: u.o }); } },
    { id: 'tether', name: 'Tether Drain', glyph: '⟟', color: '#d090ff', target: 'unit', range: 150, cd: 16,
      desc: 'Hook an enemy and drain 12 HP per second into yourself for 5s.',
      auto(w, u) { const e = w.targetOf(u); return e && e.kind === undefined && E.dist(u, e) < 150 ? e : null; },
      cast(w, u, tg) { if (tg && tg.kind === undefined) w.buff(tg, 'drain', 5, 12, u.o, u.id); } },
    { id: 'split', name: 'Bud Split', glyph: '❋', color: '#38f8c8', target: 'self', cd: 40,
      desc: 'Bud off a zooid: a half-strength copy that lives for 30s.',
      auto(w, u) { return u.engaged ? u : null; },
      cast(w, u) {
        const c = w.spawnUnit(u.o, u.d, u.x + Math.cos(u.a + 2) * 16, u.y + Math.sin(u.a + 2) * 16, { temp: 30, hpFrac: 0.5, zooid: true });
        if (c) { c.order = E.deepCopy(u.order); c.a = u.a; }
      } },
  ];
  E.ABILITIES = {}; A.forEach(a => (E.ABILITIES[a.id] = a));
  E.ABILITY_LIST = A;

  // ── 12 colony powers (researched on the tech tree) ─────────────
  const P = [
    { id: 'frenzy', name: 'Frenzy', glyph: '♨', color: '#ff5a5a', kind: 'active', target: 'none', cd: 30, cost: { l: 60, s: 0 }, time: 10,
      desc: 'Surge the colony’s fever by 30% instantly.',
      cast(w, p) { p.fever = Math.min(1, p.fever + 0.3); w.event('power', { id: 'frenzy', o: p.idx }); } },
    { id: 'flare', name: 'Lumen Flare', glyph: '☀', color: '#fff3a0', kind: 'active', target: 'point', cd: 60, cost: { l: 120, s: 10 }, time: 14,
      desc: 'Reveal a 600-wide area anywhere on the map for 12s.',
      cast(w, p, tg) { w.cloud({ kind: 'flare', o: p.idx, x: tg.x, y: tg.y, r: 300, dur: 12 }); } },
    { id: 'tidecall', name: 'Tidecall', glyph: '🌀', color: '#30b8ff', kind: 'active', target: 'point', cd: 75, cost: { l: 200, s: 40 }, time: 20,
      desc: 'Summon a whirlpool for 15s that flings enemies outward and slows them.',
      cast(w, p, tg) { w.cloud({ kind: 'tide', o: p.idx, x: tg.x, y: tg.y, r: 190, dur: 15 }); } },
    { id: 'bloom', name: 'Spore Bloom', glyph: '✿', color: '#9fffc0', kind: 'active', target: 'point', cd: 60, cost: { l: 180, s: 40 }, time: 18, useSpore: 20,
      desc: 'Costs 20 spore per cast. Allies within 250 regenerate 60% HP over 5s.',
      cast(w, p, tg) { w.cloud({ kind: 'bloom', o: p.idx, x: tg.x, y: tg.y, r: 250, dur: 5 }); } },
    { id: 'apex', name: 'Apex Spawn', glyph: '♛', color: '#ffe066', kind: 'active', target: 'none', cd: 180, cost: { l: 400, s: 120 }, time: 40, useLumen: 300, useSpore: 100,
      desc: 'Costs 300 lumen and 100 spore per cast. Hatches a Leviathan at your nucleus, one at a time.', req: p => p.specials.length >= 3,
      reqText: 'Requires 3 other powers',
      cast(w, p) { return w.spawnApex(p); } },
    { id: 'mitosis', name: 'Mitosis', glyph: '⚭', color: '#38f8c8', kind: 'passive', cost: { l: 200, s: 40 }, time: 22,
      desc: 'Each hatching has a 15% chance to produce a free twin.' },
    { id: 'chitin', name: 'Chitin Weave', glyph: '⛨', color: '#ffd28a', kind: 'passive', cost: { l: 180, s: 30 }, time: 20,
      desc: 'All creatures gain +10% armor.' },
    { id: 'roots', name: 'Deep Roots', glyph: '⚘', color: '#9fd8c8', kind: 'passive', cost: { l: 150, s: 0 }, time: 16,
      desc: 'Structures regenerate 4 HP/s and silt income doubles.' },
    { id: 'symbiosis', name: 'Symbiosis', glyph: '❦', color: '#9fffc0', kind: 'passive', cost: { l: 160, s: 20 }, time: 18,
      desc: 'Creatures regenerate 1.5 HP/s while three or more allies are within 90.' },
    { id: 'hivemind', name: 'Hive Mind', glyph: '◎', color: '#b090ff', kind: 'passive', cost: { l: 160, s: 30 }, time: 18,
      desc: '+30% sight for every creature, and hidden enemies are detected from 60 farther.' },
    { id: 'hunger', name: 'Abyssal Hunger', glyph: '☾', color: '#d090ff', kind: 'passive', cost: { l: 200, s: 30 }, time: 20,
      desc: 'Kills grant 8 lumen, and every bite heals for 10% of its damage.' },
    { id: 'metamorph', name: 'Metamorphosis', glyph: '❂', color: '#ffa0d8', kind: 'passive', cost: { l: 180, s: 40 }, time: 20,
      desc: 'Veterancy comes twice as fast and each rank is 50% stronger.' },
  ];
  E.POWERS = {}; P.forEach(p => (E.POWERS[p.id] = p));
  E.POWER_LIST = P;

  // ── 12 powerups (spawn at vents; any creature collects) ────────
  const U = [
    { id: 'geode', name: 'Lumen Geode', glyph: '◆', color: '#8ffcff', scope: 'colony', desc: '+150 lumen.', apply(w, u, p) { p.lumen += 150; p.stats.gathered += 150; } },
    { id: 'cluster', name: 'Spore Cluster', glyph: '✦', color: '#ffe066', scope: 'colony', desc: '+40 spore.', apply(w, u, p) { p.spore += 40; } },
    { id: 'pearl', name: 'Adrenal Pearl', glyph: '●', color: '#80d0ff', scope: 'unit', desc: '+50% speed for 25s.', apply(w, u) { w.buff(u, 'haste', 25, 0.5, u.o); } },
    { id: 'shard', name: 'Chitin Shard', glyph: '⬣', color: '#ffd28a', scope: 'unit', desc: '+30% armor for 40s.', apply(w, u) { w.buff(u, 'plate', 40, 0.3, u.o); } },
    { id: 'gland', name: 'Venom Gland', glyph: '☣', color: '#9aff5a', scope: 'unit', desc: 'Bites poison for 40s.', apply(w, u) { w.buff(u, 'coat', 40, 6, u.o); } },
    { id: 'kelp', name: 'Healing Kelp', glyph: '✚', color: '#9fffc0', scope: 'area', desc: 'Heals allies within 200 by 80 HP.', apply(w, u) { for (const a of w.alliesNear(u.o, u.x, u.y, 200)) w.heal(a, 80); w.event('heal', { x: u.x, y: u.y, r: 200, o: u.o }); } },
    { id: 'echo', name: 'Echo Shell', glyph: '◉', color: '#b090ff', scope: 'colony', desc: 'Reveals the entire map for 15s.', apply(w, u, p) { p.echoT = 15; } },
    { id: 'coral', name: 'Frenzy Coral', glyph: '♨', color: '#ff7a7a', scope: 'colony', desc: 'Fever to 80% with no burn for 20s.', apply(w, u, p) { p.fever = Math.max(p.fever, 0.8); p.coralT = 20; } },
    { id: 'mutagen', name: 'Mutagen', glyph: '⚗', color: '#ffa0d8', scope: 'unit', desc: 'Instantly gains a veterancy rank.', apply(w, u) { w.rankUp(u); } },
    { id: 'veil', name: 'Phantom Veil', glyph: '◌', color: '#9ff6e4', scope: 'unit', desc: 'Hidden for 25s, even while biting.', apply(w, u) { w.buff(u, 'veil', 25, 1, u.o); } },
    { id: 'egg', name: 'Swarm Egg', glyph: '⬭', color: '#ff70c0', scope: 'colony', desc: 'Hatches three free sporelings here.', apply(w, u, p) { for (let i = 0; i < 3; i++) { const c = w.spawnUnit(p.idx, '_sporeling', u.x + Math.cos(i * 2.1) * 20, u.y + Math.sin(i * 2.1) * 20, { free: true }); if (c) c.order = { t: 'idle', x: c.x, y: c.y }; } } },
    { id: 'heart', name: 'Abyssal Heart', glyph: '♥', color: '#ff5a8a', scope: 'unit', desc: 'Becomes elite for good: double HP and a crown of light.', apply(w, u) { u.elite = 1; u.hp = w.stats(u).hp; } },
  ];
  E.POWERUPS = {}; U.forEach(x => (E.POWERUPS[x.id] = x));
  E.POWERUP_LIST = U;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
