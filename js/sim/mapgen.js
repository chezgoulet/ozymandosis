// SPDX-License-Identifier: AGPL-3.0-only
// Procedural Dreamscape maps. Deterministic from cfg.seed.
(function (E) {
  'use strict';
  const TAU = E.TAU;

  E.MAP_SIZES = {
    s: { name: 'Tidepool', w: 2400, h: 1600 },
    m: { name: 'Lagoon', w: 3600, h: 2400 },
    l: { name: 'Reef', w: 4800, h: 3200 },
    xl: { name: 'Abyss', w: 6400, h: 4200 },
  };
  E.DEFAULT_MAP = { size: 'm', seed: 1, richness: 1, powerups: 1, currents: true, fog: true, startLumen: 220, startSpore: 0, layout: 'ring' };

  // players: [{team}] (only count and team order matter here)
  E.generateMap = function (cfg, players) {
    const sz = cfg.size === 'custom' ? { w: E.clamp(Math.round(cfg.w || 4000), 1600, 9600), h: E.clamp(Math.round(cfg.h || 3000), 1200, 6400) } : (E.MAP_SIZES[cfg.size] || E.MAP_SIZES.m);
    const W = sz.w, H = sz.h, rng = E.RNG(cfg.seed >>> 0 || 1);
    const n = players.length;
    const map = { w: W, h: H, starts: [], pools: [], vents: [], currents: [] };
    // Start positions on an ellipse, allies adjacent
    const order = players.map((p, i) => i).sort((a, b) => (players[a].team || 99 + a) - (players[b].team || 99 + b));
    const a0 = rng.next() * TAU;
    const rx = W * 0.39, ry = H * 0.37;
    const starts = new Array(n);
    if (cfg.layout === 'scatter') {
      // random starts with generous spacing (falls back to the ring if it can't fit them)
      const minD = Math.min(W, H) * (n <= 2 ? 0.6 : n <= 4 ? 0.42 : 0.34);
      for (let tries = 0, k = 0; k < n && tries < 5000; tries++) {
        const x = W * (0.1 + rng.next() * 0.8), y = H * (0.1 + rng.next() * 0.8);
        if (starts.slice(0, k).every(s => Math.hypot(s.x - x, s.y - y) > minD)) { starts[order[k]] = { x, y, a: 0 }; k++; }
      }
    }
    order.forEach((pi, k) => {
      if (starts[pi]) return;
      let a = a0 + (k / n) * TAU;
      if (n === 2) a = a0 + k * Math.PI;
      starts[pi] = { x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry, a };
    });
    map.starts = starts;
    const rich = cfg.richness || 1;
    const pools = map.pools;
    let id = 1;
    const addPool = (x, y, kind, great) => {
      const r = kind === 'spore' ? 42 : great ? 80 : 48 + rng.next() * 10;
      const max = (kind === 'spore' ? 500 : great ? 2600 : 1100) * rich;
      pools.push({ id: id++, kind, x, y, ax: x, ay: y, r, amt: max, max, orbit: kind === 'spore' ? 20 : 24 + rng.next() * 30, spd: TAU / (90 + rng.next() * 60), ph: rng.next() * TAU, great: !!great });
    };
    const far = (x, y, d, list) => list.every(o => Math.hypot(o.x - x, o.y - y) > d);
    // Home resources: identical ring for fairness
    starts.forEach(s => {
      const toC = Math.atan2(H / 2 - s.y, W / 2 - s.x);
      [-0.9, 0, 0.9].forEach((o, i) => addPool(s.x + Math.cos(toC + o) * (290 + i * 20), s.y + Math.sin(toC + o) * (290 + i * 20), 'lumen'));
      addPool(s.x + Math.cos(toC + 2.2) * 330, s.y + Math.sin(toC + 2.2) * 330, 'spore');
    });
    // Contested great caustics
    addPool(W / 2, H / 2, 'lumen', true);
    if (n >= 3) starts.forEach((s, i) => {
      const t = starts[(i + 1) % n]; const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      const gx = W / 2 + (mx - W / 2) * 0.55, gy = H / 2 + (my - H / 2) * 0.55;
      if (far(gx, gy, 500, pools)) addPool(gx, gy, 'lumen', true);
    });
    // Scatter
    const area = W * H, target = Math.round(area / (560 * 560) * rich);
    for (let tries = 0, made = 0; tries < 4000 && made < target; tries++) {
      const x = 120 + rng.next() * (W - 240), y = 120 + rng.next() * (H - 240);
      if (!far(x, y, 360, pools) || !far(x, y, 560, starts)) continue;
      addPool(x, y, rng.chance(0.18) ? 'spore' : 'lumen'); made++;
    }
    // Vents
    const vc = Math.round(area / (1100 * 1100) * 2 * (cfg.powerups || 0));
    for (let tries = 0; tries < 3000 && map.vents.length < vc; tries++) {
      const x = 150 + rng.next() * (W - 300), y = 150 + rng.next() * (H - 300);
      if (!far(x, y, 650, starts) || !far(x, y, 500, map.vents) || !far(x, y, 140, pools)) continue;
      map.vents.push({ id: id++, x, y, t: 20 + rng.next() * 40 });
    }
    // Currents
    if (cfg.currents) {
      const cc = Math.round(area / (1400 * 1400) * 1.4) + 2;
      for (let tries = 0; tries < 2000 && map.currents.length < cc; tries++) {
        const x = rng.next() * W, y = rng.next() * H, r = 260 + rng.next() * 340;
        if (!far(x, y, r + 260, starts) || !far(x, y, 500, map.currents)) continue;
        const kind = rng.chance(0.5) ? 'vortex' : 'jet';
        map.currents.push({ x, y, r, kind, s: (kind === 'vortex' ? 26 : 34) * (rng.chance(0.5) ? 1 : -1), a: rng.next() * TAU });
      }
    }
    map.nextId = id;
    return map;
  };

  E.MODES = {
    annihilation: { name: 'Annihilation', desc: 'Destroy every enemy structure.' },
    regicide: { name: 'Heartfall', desc: 'Destroy the enemy nucleus. When a nucleus dies, its colony dies with it.' },
    tide: { name: 'Hold the Tide', desc: 'Hold the great caustics. Every half-second a team holds one alone earns a point.' },
    bloom: { name: 'Luminance', desc: 'The first team to gather the goal amount of lumen wins.' },
  };
  E.objectiveGoal = function (m) {
    if (m.mode === 'tide') return m.goal || 240;
    if (m.mode === 'bloom') return m.goal || ({ s: 6000, m: 9000, l: 12000, xl: 15000 }[m.size] || 10000) * (m.richness || 1);
    return 0;
  };
  // Current force at a point (units/s)
  E.currentAt = function (currents, x, y) {
    let fx = 0, fy = 0;
    for (const c of currents) {
      const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
      if (d >= c.r || d < 1) continue;
      const k = (1 - d / c.r) * Math.min(1, d / 60);
      if (c.kind === 'vortex') { fx += (-dy / d) * c.s * k; fy += (dx / d) * c.s * k; }
      else { const s = Math.abs(c.s) * k; fx += Math.cos(c.a) * s; fy += Math.sin(c.a) * s; }
    }
    return { x: fx, y: fy };
  };
})(typeof window !== 'undefined' ? window.E : globalThis.E);
