// Visual language shared by the renderer and UI previews: palettes (the
// seed's _palette generalized), creature colors, cached glow sprites, and the
// creature drawer used everywhere a creature appears.
(function (E) {
  'use strict';
  const TAU = E.TAU;

  // _palette() generalized to any culture and fed colony signals
  E.palette = function (cult, e, fever, reserves, blighted) {
    const [c0, c1] = cult.colors;
    const hotP = E.mix(c0, c1, 0.3), hotA = E.mix(c1, E.WHITE, 0.3);
    const temp = 33 + fever * 15, tempT = E.clamp((temp - 35) / 10, 0, 1);
    let P = E.mix(E.mix(c0, hotP, e), { r: 0xea, g: 0xb3, b: 0x08 }, tempT);
    let A = E.mix(E.mix(c1, hotA, e), { r: 0xff, g: 0x5a, b: 0x5a }, tempT);
    if (temp > 42) { const k = E.clamp((temp - 42) / 6, 0, 1); P = E.mix(P, E.RED, k); A = E.mix(A, E.RED, k); }
    let bgC = E.mix({ r: 6, g: 18, b: 24 }, c0, 0.06 + 0.03 * e), bg = E.mix({ r: 3, g: 8, b: 11 }, c0, 0.025);
    const starve = E.clamp((20 - reserves) / 20, 0, 1);
    if (starve > 0) {
      const dim = 1 - starve * 0.7;
      P = E.mix(P, { r: 0x1a * dim, g: 0x4c * dim, b: 0x78 * dim }, starve); A = E.mix(A, { r: 0x1a * dim, g: 0x3a * dim, b: 0x5c * dim }, starve);
      bg = E.mix(bg, { r: 2, g: 6, b: 8 }, starve); bgC = E.mix(bgC, { r: 4, g: 8, b: 16 }, starve);
    }
    if (blighted) { P = E.mix(P, E.RED, 0.6); A = E.RED; bgC = E.mix(bgC, { r: 20, g: 6, b: 8 }, 0.7); bg = E.mix(bg, { r: 10, g: 3, b: 4 }, 0.7); }
    return { primary: P, accent: A, bgCenter: bgC, bg, panic: E.panicOf(fever), starve, blighted, e };
  };
  E.playerPalette = function (w, p) {
    const n = w.s.structs.find(b => b.o === p.idx && b.kind === 'nucleus');
    const blighted = n ? n.hp < E.STRUCTS.nucleus.hp * 0.35 : false;
    return E.palette(E.CULTURES[p.culture], p.energy, p.fever, p.alive ? p.lumen : 100, blighted);
  };
  E.creatureColor = function (cult, pal, indiv, phase, t) {
    const [c0, c1] = cult.colors, e = pal.e;
    let c = E.mix(c0, c1, e * 0.4 + indiv * 0.25);
    const vib = e > 0.5 ? E.clamp((e - 0.5) * 2, 0, 1) : 0;
    if (vib > 0) c = E.mix(c, E.mix({ r: 255, g: 128, b: 255 }, { r: 255, g: 96, b: 128 }, Math.sin(phase + t * 0.3) * 0.5 + 0.5), vib * 0.12);
    const pn = pal.panic;
    if (pn > 0) c = { r: c.r + (255 - c.r) * pn * 0.3, g: c.g * (1 - pn * 0.4), b: c.b * (1 - pn * 0.4) };
    if (pal.starve > 0) c = E.mix(c, pal.primary, pal.starve * 0.8);
    if (pal.blighted) c = E.mix(c, E.RED, 0.45);
    return c;
  };

  // ── Glow sprites ────────────────────────────────────────────────
  const spriteCache = new Map();
  E.glowSprite = function (c, soft) {
    const key = ((c.r >> 3) << 10) | ((c.g >> 3) << 5) | (c.b >> 3) | (soft ? 1 << 16 : 0);
    let cv = spriteCache.get(key);
    if (!cv) {
      if (spriteCache.size > 600) spriteCache.clear();
      cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      if (soft) { g.addColorStop(0, E.rgba(c, 0.5)); g.addColorStop(0.5, E.rgba(c, 0.18)); g.addColorStop(1, E.rgba(c, 0)); }
      else { g.addColorStop(0, E.rgba(E.mix(c, E.WHITE, 0.55), 1)); g.addColorStop(0.25, E.rgba(c, 0.5)); g.addColorStop(1, E.rgba(c, 0)); }
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      spriteCache.set(key, cv);
    }
    return cv;
  };
  E.drawGlow = function (ctx, x, y, r, c, a, soft) {
    if (a <= 0.003 || r <= 0) return;
    const ga = ctx.globalAlpha; ctx.globalAlpha = ga * Math.min(1, a);
    ctx.drawImage(E.glowSprite(c, soft), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = ga;
  };

  // ── Visual body state (renderer-owned; never simulated) ─────────
  E.makeVis = function (x, y, a, bodyLen, seed) {
    const rng = E.RNG(seed || 1), spacing = 2, n = Math.max(12, Math.round(bodyLen / spacing)), trail = [];
    for (let j = 0; j < n; j++) trail.push({ x: x - Math.cos(a) * j * spacing, y: y - Math.sin(a) * j * spacing });
    return { trail, spacing, phase: rng.next() * TAU, driftPhase: rng.next() * TAU, swimFreq: 3 + rng.next() * 3, undul: 0.3 + rng.next() * 0.15, indiv: rng.next(), orgPh: Array.from({ length: 8 }, () => ({ speed: 0.8 + rng.next() * 0.4, phase: rng.next() * TAU })) };
  };
  E.advanceVis = function (v, x, y, dt) {
    const tr = v.trail; let h = tr[0], dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy);
    if (d > 240) { for (const p of tr) { p.x = x; p.y = y; } return; }
    while (d >= v.spacing) { const f = v.spacing / d; h = { x: h.x + dx * f, y: h.y + dy * f }; tr.unshift(h); tr.pop(); dx = x - h.x; dy = y - h.y; d = Math.hypot(dx, dy); }
    v.driftPhase += (dt || 0.016) * 0.3;
  };
  E.buildPts = function (v, x, y, t, size) {
    const tr = v.trail, n = tr.length, segs = 20, pts = [], step = (n - 1) / (segs - 1);
    for (let si = 0; si < segs; si++) {
      const idx = Math.min(n - 1, Math.round(si * step));
      const pt = si === 0 ? { x, y } : tr[idx];
      const pv = tr[Math.max(0, idx - 1)], nx = tr[Math.min(n - 1, idx + 1)];
      const dx = nx.x - pv.x, dy = nx.y - pv.y, dl = Math.hypot(dx, dy) || 0.001;
      const w = Math.sin(t * v.swimFreq * 3 - si * 0.7 + v.phase + v.driftPhase * 2) * size * 5 * v.undul * (si / (segs - 1));
      pts.push({ x: pt.x + (-dy / dl) * w, y: pt.y + (dx / dl) * w });
    }
    return pts;
  };
  // Sides alternate per organ class so a second copy mirrors the first.
  E.organSides = function (organs) {
    const seen = {};
    return organs.map(id => { const c = E.ORGANS[id] ? E.ORGANS[id].cls : id; seen[c] = (seen[c] || 0) + 1; return seen[c] % 2 ? 1 : -1; });
  };

  // Draw one creature. o: {design, tier, hc, pal, t, alpha, activity, flicker, lod, size, rank, elite, vOverride}
  E.drawCreature = function (ctx, v, pts, o) {
    const ch = E.CHASSIS[o.design.chassis] || E.CHASSIS.serpent;
    const size = o.size, hc = o.hc, pal = o.pal, ba = o.alpha * (o.flicker || 1), act = o.activity || 1;
    if (o.lod >= 2) {
      E.drawGlow(ctx, pts[0].x, pts[0].y, 9 * size, hc, ba * 0.9);
      ctx.strokeStyle = E.rgba(hc, ba * 0.7); ctx.lineWidth = 2 * size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[10].x, pts[10].y); ctx.stroke();
      return;
    }
    if (o.lod === 0) {
      const tr = v.trail, n = tr.length, ws = Math.max(2, Math.floor(n / 8));
      ctx.fillStyle = E.rgba(hc, ba * 0.035);
      for (let wi = n - 1; wi > 0; wi -= ws) { const f = wi / n; ctx.beginPath(); ctx.arc(tr[wi].x, tr[wi].y, size * (1 + f * 2), 0, TAU); ctx.fill(); }
    }
    ch.draw(ctx, pts, size, hc, pal, o.t, ba, act);
    if (o.lod === 0) {
      const ga = ctx.globalAlpha; ctx.globalAlpha = ga * E.clamp(ba * 1.15, 0, 1);
      const sides = E.organSides(o.design.organs);
      o.design.organs.slice(0, ch.slots).forEach((id, i) => {
        const org = E.ORGANS[id]; if (!org) return;
        const vv = o.vOverride ? o.vOverride[i] : E.TIER_V[(o.tier && o.tier[org.cls]) || 0];
        const par = v.orgPh[i % 8];
        org.draw(ctx, pts, sides[i], par, o.t, vv, pal, hc);
      });
      ctx.globalAlpha = ga;
    } else {
      E.glowStroke(ctx, pts, 10, size * 0.6, hc, ba * 0.5, 1);
    }
    const hs = 3.5 * size * act * (ch.id === 'medusa' || ch.id === 'nautiloid' ? 0.7 : 1);
    E.drawGlow(ctx, pts[0].x, pts[0].y, hs * 4, pal.accent, ba * 0.9);
    if (o.elite) {
      const k = 0.5 + 0.5 * Math.sin(o.t * 3);
      ctx.strokeStyle = E.rgba({ r: 255, g: 224, b: 102 }, 0.35 + 0.3 * k); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, hs * 3.2, 0, TAU); ctx.stroke();
    }
  };
})(typeof window !== 'undefined' ? window.E : globalThis.E);
