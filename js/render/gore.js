// Wounds, debris and residue. Renderer-only: the simulation knows health, and
// everything here is derived from it, so wounds heal exactly as health returns.
//
//  - Organs tear away as a creature is hurt (each at its own damage threshold)
//    and tumble off as real pieces; they bud back, growing in, as it heals.
//  - Tails wear down: the spine contracts and the lost length drifts away.
//  - Hits spray residue in the creature's own colours (bioluminescent ichor,
//    never red blood) that hangs in the water and settles into fading stains.
//  - A dead creature breaks apart into drifting chunks and loose organs.
//
// Gatherers and fighters also get their silhouettes here (E.roleClass,
// E.drawRoleCanvas): soft, pale harvest sacs versus dark plates and spikes.
(function (E) {
  'use strict';
  const TAU = E.TAU, WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };
  const hash = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
  const MAX_TAIL = 6;

  // Gatherers: can harvest and barely bite. Everything else fights.
  E.roleClass = st => (st && st.canHarvest && st.dps < 6 && !st.shot ? 'gatherer' : 'fighter');

  // Wound state for a creature at this health.
  E.woundOf = function (id, hpF, nOrg) {
    const hurt = 1 - E.clamp(hpF, 0, 1);
    let mask = 0;
    for (let i = 0; i < nOrg; i++) if (hurt > 0.2 + 0.6 * hash(id * 31 + i * 7 + 1)) mask |= 1 << i;
    return { mask, tail: Math.floor(E.clamp((hurt - 0.25) / 0.6, 0, 1) * MAX_TAIL), hurt };
  };
  // Shorten a 20-point spine in place by `cut` points (resampled so organs still fit).
  E.contractSpine = function (X, Y, cut) {
    if (!cut) return;
    const L = 19 - cut, tx = new Float32Array(20), ty = new Float32Array(20);
    for (let i = 0; i < 20; i++) { const s = i * L / 19, a = Math.floor(s), b = Math.min(19, a + 1), f = s - a; tx[i] = X[a] + (X[b] - X[a]) * f; ty[i] = Y[a] + (Y[b] - Y[a]) * f; }
    for (let i = 0; i < 20; i++) { X[i] = tx[i]; Y[i] = ty[i]; }
  };
  E.contractPts = function (pts, cut) {
    if (!cut) return pts;
    const X = pts.map(p => p.x), Y = pts.map(p => p.y); E.contractSpine(X, Y, cut);
    return X.map((x, i) => ({ x, y: Y[i] }));
  };
  // Residue colours: the creature's own palette, darkened ichor with bright motes.
  E.residueColors = function (cult) {
    const [c0, c1] = cult.colors;
    return { ichor: E.mix(E.mix(c0, c1, 0.4), BLACK, 0.35), glow: E.mix(c1, WHITE, 0.25), stain: E.mix(c0, BLACK, 0.55) };
  };

  class Gore {
    constructor() { this.debris = []; this.drops = []; this.stains = []; this.t = 0; }
    clear() { this.debris.length = 0; this.drops.length = 0; this.stains.length = 0; }
    // Compare a creature's wounds with last frame and shed or regrow parts.
    // v: renderer vis state; anchors(i) → {x, y, rot, side} for organ i on the live spine.
    update(v, id, hpF, design, nOrg, tier, cols, t, spine, anchors, size) {
      const w = E.woundOf(id, hpF, nOrg);
      if (v.wmask === undefined) { v.wmask = w.mask; v.wtail = w.tail; v.regrow = {}; return w; } // first sight: no shedding
      const lost = w.mask & ~v.wmask, grown = v.wmask & ~w.mask;
      for (let i = 0; i < nOrg; i++) {
        if (lost & (1 << i)) { const a = anchors(i); if (a) this.organ(design.organs[i], tier, a, cols, size); }
        if (grown & (1 << i)) v.regrow[i] = t;
      }
      if (w.tail > v.wtail && spine) this.tailChunk(spine, v.wtail, w.tail, cols, size);
      v.wmask = w.mask; v.wtail = w.tail;
      return w;
    }
    growScale(v, i, t) { const t0 = v.regrow && v.regrow[i]; if (t0 === undefined) return 1; const k = (t - t0) / 0.8; if (k >= 1) { delete v.regrow[i]; return 1; } return 0.25 + 0.75 * k * k * (3 - 2 * k); }
    organ(id, tier, a, cols, size) {
      if (this.debris.length > 160) this.debris.shift();
      const ang = a.rot + (a.side || 1) * Math.PI / 2 + (Math.random() - 0.5) * 1.2, sp = 25 + Math.random() * 35;
      this.debris.push({ k: 'organ', id, ti: tier, side: a.side || 1, x: a.x, y: a.y, rot: a.rot, spin: (Math.random() - 0.5) * 5, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t: 0, life: 2.6 + Math.random(), cols, size, ph: Math.random() * TAU });
      this.spray(a.x, a.y, cols, 0.25, ang);
    }
    // A length of body (spine points i0..i1) torn free, kept as a local polyline.
    chunk(X, Y, i0, i1, cols, size, vx, vy) {
      if (this.debris.length > 160) this.debris.shift();
      let cx = 0, cy = 0; const n = i1 - i0 + 1;
      for (let i = i0; i <= i1; i++) { cx += X[i]; cy += Y[i]; }
      cx /= n; cy /= n;
      const pts = []; for (let i = i0; i <= i1; i++) pts.push(X[i] - cx, Y[i] - cy);
      this.debris.push({ k: 'body', pts, x: cx, y: cy, rot: 0, spin: (Math.random() - 0.5) * 3, vx, vy, t: 0, life: 2.4 + Math.random() * 1.2, cols, size });
    }
    tailChunk(spine, from, to, cols, size) {
      const X = spine.X, Y = spine.Y, i1 = 19 - from, i0 = Math.min(i1 - 1, 19 - to);
      const a = Math.atan2(Y[19] - Y[14], X[19] - X[14]), sp = 15 + Math.random() * 20;
      this.chunk(X, Y, Math.max(1, i0), Math.max(2, i1), cols, size, Math.cos(a) * sp, Math.sin(a) * sp);
      this.spray(X[19], Y[19], cols, 0.3, a);
    }
    // Death: the body breaks into three and every organ comes loose.
    dismember(X, Y, design, tier, cols, size, anchorsAll) {
      const cx = X[9], cy = Y[9];
      for (const [i0, i1] of [[0, 6], [6, 13], [13, 19]]) {
        const mx = (X[i0] + X[i1]) / 2 - cx, my = (Y[i0] + Y[i1]) / 2 - cy, d = Math.hypot(mx, my) || 1, sp = 18 + Math.random() * 22;
        this.chunk(X, Y, i0, i1, cols, size, mx / d * sp + (Math.random() - 0.5) * 10, my / d * sp + (Math.random() - 0.5) * 10);
      }
      for (const a of anchorsAll) this.organ(a.id, tier, a, cols, size);
      this.spray(cx, cy, cols, 1, null);
    }
    // Residue: droplets that fan out, hang, and settle into stains.
    spray(x, y, cols, amount, dir) {
      const n = Math.max(2, Math.min(14, Math.round(2 + amount * 22)));
      for (let i = 0; i < n; i++) {
        if (this.drops.length > 420) this.drops.shift();
        const a = dir === null || dir === undefined ? Math.random() * TAU : dir + (Math.random() - 0.5) * 2.2, sp = 20 + Math.random() * 60 * (0.5 + amount);
        this.drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.7 + Math.random() * 0.9, r: 0.9 + Math.random() * 1.8, bright: Math.random() < 0.3, cols });
      }
      if (amount > 0.08 && this.stains.length < 140) this.stains.push({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8, r: 6 + amount * 26, t: 0, life: 7 + Math.random() * 5, cols });
    }
    step(dt) {
      const drag = Math.exp(-2.2 * dt);
      for (const d of this.debris) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= drag; d.vy *= drag; d.rot += d.spin * dt; d.spin *= Math.exp(-0.6 * dt);
        // chunks keep weeping a little residue as they drift
        if (d.t < d.life * 0.6 && Math.random() < dt * 6 && this.drops.length < 420) this.drops.push({ x: d.x, y: d.y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, t: 0, life: 0.8, r: 0.8 + Math.random(), bright: false, cols: d.cols }); }
      for (const p of this.drops) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag; }
      for (const s of this.stains) s.t += dt;
      this.debris = this.debris.filter(d => d.t < d.life);
      this.drops = this.drops.filter(p => p.t < p.life);
      this.stains = this.stains.filter(s => s.t < s.life);
    }
    // Draw through the structure adapter (glow, glowTop, poly, organ).
    draw(D, t, inView) {
      for (const s of this.stains) {
        if (inView && !inView(s.x, s.y, s.r)) continue;
        const a = Math.min(1, s.t / 0.4) * (1 - s.t / s.life);
        D.glow(s.x, s.y, s.r * (1 + 0.3 * s.t / s.life), 8, s.cols.stain, 0.45 * a);
      }
      const P = this._P || (this._P = new Float32Array(64));
      for (const d of this.debris) {
        if (inView && !inView(d.x, d.y, 60)) continue;
        const f = d.t / d.life, a = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
        if (d.k === 'body') {
          const c = Math.cos(d.rot), s = Math.sin(d.rot), n = d.pts.length / 2;
          for (let i = 0; i < n; i++) { const px = d.pts[i * 2], py = d.pts[i * 2 + 1]; P[i * 2] = d.x + px * c - py * s; P[i * 2 + 1] = d.y + px * s + py * c; }
          D.poly(P, n, false, d.size * 0.9, d.size * 0.6, 0, d.cols.ichor, 0.85 * a, 1);
          D.glowTop(P[0], P[1], d.size * 2.2, 1, d.cols.glow, 0.5 * a); // the torn end glows
        } else {
          D.organ(d.id, d.x, d.y, d.rot, 1, d.ti, d.side, d.ph, 0.4, t, d.cols.ichor, d.cols.glow, 0.9 * a);
        }
      }
      for (const p of this.drops) {
        if (inView && !inView(p.x, p.y, 10)) continue;
        const a = 1 - p.t / p.life;
        D.glowTop(p.x, p.y, p.r, 4, p.bright ? p.cols.glow : p.cols.ichor, 0.9 * a);
        if (p.bright) D.glow(p.x, p.y, p.r * 3.5, 0, p.cols.glow, 0.35 * a);
      }
    }
  }
  E.Gore = Gore;

  // Canvas silhouettes for gatherers and fighters (the GL backend draws its own with batches).
  E.drawRoleCanvas = function (ctx, pts, role, size, hc, pal, t, ba, cargo) {
    const n = pts.length, dirAt = i => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; return Math.atan2(a.y - b.y, a.x - b.x); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (role === 'gatherer') {
      // a soft, translucent harvest sac amidships that fills with what it carries
      const c = { x: (pts[4].x + pts[6].x) / 2, y: (pts[4].y + pts[6].y) / 2 }, r = size * 5.6, cf = E.clamp(cargo || 0, 0, 1);
      E.drawGlow(ctx, c.x, c.y, r * 2, E.mix(hc, WHITE, 0.35), ba * 0.45, true);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(dirAt(5));
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r, 0, 0, TAU);
      ctx.fillStyle = E.rgba(E.mix(hc, WHITE, 0.45), ba * (0.16 + 0.3 * cf)); ctx.fill();
      ctx.strokeStyle = E.rgba(E.mix(hc, WHITE, 0.6), ba * 0.75); ctx.lineWidth = Math.max(0.8, size * 0.9); ctx.stroke();
      ctx.restore();
    } else {
      // war plates along the back, glowing spikes, and a crown of forward spines
      const dark = E.mix(hc, BLACK, 0.5), edge = E.mix(pal.accent, WHITE, 0.35);
      for (const k of [8, 6, 4, 2]) {
        const p = pts[k], a = dirAt(k), w = size * (6.2 - k * 0.3);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, 0, size * 3.2, w, 0, -Math.PI / 2, Math.PI / 2);
        ctx.fillStyle = E.rgba(dark, ba * 0.8); ctx.fill(); ctx.strokeStyle = E.rgba(edge, ba * 0.85); ctx.lineWidth = Math.max(0.8, size); ctx.stroke();
        ctx.restore();
      }
      const spike = (x0, y0, x1, y1, w) => { for (const [lw, al] of [[w * 3.5, 0.18], [w * 1.6, 0.9]]) { ctx.strokeStyle = E.rgba(edge, ba * al); ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); } };
      for (let k = 3, s = 1; k <= 11; k += 2, s = -s) { const p = pts[k], a = dirAt(k) + s * (Math.PI / 2 + 0.6), l = size * (7 - k * 0.3); spike(p.x, p.y, p.x + Math.cos(a) * l, p.y + Math.sin(a) * l, Math.max(0.7, size * 0.6)); }
      const h = pts[0], a0 = dirAt(1);
      for (const s of [-0.4, 0.4]) spike(h.x, h.y, h.x + Math.cos(a0 + s) * size * 6.5, h.y + Math.sin(a0 + s) * size * 6.5, Math.max(0.8, size * 0.7));
    }
    void t;
  };
})(window.E);
