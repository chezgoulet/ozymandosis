// Organs: 5 classes × 6 forms = 30. Form 1 of each class is the seed's own
// renderer; forms 2–6 are new renderers written in the seed's idiom
// (round caps, low-alpha strokes on the heat-shifted body color).
(function (E) {
  'use strict';
  const TAU = E.TAU;
  const SEED = BioluminescentDreamscape;

  E.TIER_V = [0, 3, 6, 9];
  E.CLASSES = {
    leg:      { id: 'leg',      name: 'Legs',      verb: 'Stride',  idx: 0, role: 'Durability', icon: 'L', tiers: ['Nascent', 'Hardened', 'Sinewed', 'Ancient'] },
    flagella: { id: 'flagella', name: 'Flagella',  verb: 'Current', idx: 1, role: 'Mobility',   icon: 'F', tiers: ['Nascent', 'Tapered', 'Driven', 'Ancient'] },
    pili:     { id: 'pili',     name: 'Pili',      verb: 'Grasp',   idx: 2, role: 'Harvest',    icon: 'P', tiers: ['Nascent', 'Dense', 'Lush', 'Ancient'] },
    mandible: { id: 'mandible', name: 'Mandibles', verb: 'Bite',    idx: 3, role: 'Offense',    icon: 'M', tiers: ['Nascent', 'Keen', 'Cruel', 'Ancient'] },
    antenna:  { id: 'antenna',  name: 'Antennae',  verb: 'Sense',   idx: 4, role: 'Perception', icon: 'A', tiers: ['Nascent', 'Attuned', 'Resonant', 'Ancient'] },
  };
  E.CLASS_IDS = Object.keys(E.CLASSES);

  // ── geometry helpers ────────────────────────────────────────────
  function frame(pts, i) {
    i = Math.max(0, Math.min(pts.length - 1, i));
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = a.x - b.x, ty = a.y - b.y; const l = Math.hypot(tx, ty) || 0.001; tx /= l; ty /= l;
    return { x: pts[i].x, y: pts[i].y, tx, ty, nx: -ty, ny: tx };
  }
  const S = (ctx, c, a, w) => { ctx.strokeStyle = rgba(c, a); ctx.lineWidth = w; };
  const F = (ctx, c, a) => { ctx.fillStyle = rgba(c, a); };
  function begin(ctx) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
  function glowDot(ctx, x, y, r, c, a) {
    F(ctx, c, a * 0.25); ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
    F(ctx, E.mix(c, E.WHITE, 0.5), a); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  const seedDraw = (cls) => function (ctx, pts, side, par, t, v, pal, hc) {
    SEED._BODY_PARTS[E.CLASSES[cls].idx * 10 + v].render(ctx, pts, side, par, t, null, pal, hc);
  };

  // ── LEGS ────────────────────────────────────────────────────────
  function drawPaddles(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const len = 12 + v * 1.6;
    for (const i of [3, 7, 11]) {
      if (i >= pts.length) continue;
      const f = frame(pts, i), stroke = Math.sin(t * par.speed * 3 + i + par.phase);
      const ang = stroke * 0.7 - 0.4;
      const dx = f.nx * side * Math.cos(ang) - f.tx * Math.sin(ang), dy = f.ny * side * Math.cos(ang) - f.ty * Math.sin(ang);
      const ex = f.x + dx * len, ey = f.y + dy * len;
      S(ctx, hc, 0.6, 0.9 + v * 0.06); ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
      F(ctx, hc, 0.28); ctx.beginPath(); ctx.ellipse(0, 0, 3 + v * 0.3, 1.6 + v * 0.12, 0, 0, TAU); ctx.fill();
      S(ctx, pal.accent, 0.5, 0.6); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  function drawGrapnel(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const len = 9 + v * 1.5;
    for (const i of [2, 5, 8]) {
      if (i >= pts.length) continue;
      const f = frame(pts, i), c = Math.sin(t * par.speed * 2.2 + i + par.phase) * 0.5;
      const kx = f.x + (f.nx * side * Math.cos(c) + f.tx * 0.4) * len * 0.6, ky = f.y + (f.ny * side * Math.cos(c) + f.ty * 0.4) * len * 0.6;
      const ex = kx + (f.nx * side - f.tx * 0.6) * len * 0.6, ey = ky + (f.ny * side - f.ty * 0.6) * len * 0.6;
      S(ctx, hc, 0.7, 0.9 + v * 0.08); ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
      S(ctx, pal.accent, 0.7, 0.8 + v * 0.05); ctx.beginPath();
      const ha = Math.atan2(ey - ky, ex - kx);
      ctx.arc(ex - Math.cos(ha) * 2.5, ey - Math.sin(ha) * 2.5, 2.5 + v * 0.15, ha - 1.2 * side, ha + 1.8 * side, side < 0); ctx.stroke();
    }
    ctx.restore();
  }
  function drawThorns(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const len = 6 + v * 1.2, n = 5 + Math.floor(v / 3);
    for (let k = 0; k < n; k++) {
      const i = 2 + Math.round(k * (Math.min(pts.length - 3, 14) - 2) / Math.max(1, n - 1));
      const f = frame(pts, i), wob = Math.sin(t * par.speed * 1.5 + k + par.phase) * 0.12;
      const dx = f.nx * side * 0.8 - f.tx * (0.55 + wob), dy = f.ny * side * 0.8 - f.ty * (0.55 + wob);
      const l = len * (1 - k / (n * 1.6));
      ctx.beginPath(); ctx.moveTo(f.x + f.tx * 1.6, f.y + f.ty * 1.6); ctx.lineTo(f.x + dx * l, f.y + dy * l); ctx.lineTo(f.x - f.tx * 1.6, f.y - f.ty * 1.6);
      F(ctx, hc, 0.22); ctx.fill(); S(ctx, E.mix(hc, E.WHITE, 0.3), 0.7, 0.7); ctx.stroke();
    }
    ctx.restore();
  }
  function drawTubeFeet(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const n = Math.min(pts.length - 2, 10 + v), h = 3 + v * 0.45;
    for (let i = 1; i <= n; i++) {
      const f = frame(pts, i), ext = h * (0.6 + 0.4 * Math.sin(t * par.speed * 4 - i * 0.9 + par.phase));
      const ex = f.x + f.nx * side * ext, ey = f.y + f.ny * side * ext;
      S(ctx, hc, 0.35, 0.6); ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
      F(ctx, pal.accent, 0.6); ctx.beginPath(); ctx.arc(ex, ey, 0.8 + v * 0.06, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawStilts(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const len = 14 + v * 2.2;
    for (const [k, i] of [[0, 3], [1, 8]]) {
      if (i >= pts.length) continue;
      const f = frame(pts, i), step = Math.sin(t * par.speed * 2 + k * Math.PI + par.phase);
      const kx = f.x + (f.nx * side * 0.7 + f.tx * (0.5 + step * 0.3)) * len * 0.55, ky = f.y + (f.ny * side * 0.7 + f.ty * (0.5 + step * 0.3)) * len * 0.55;
      const ex = kx + (f.nx * side * 0.4 - f.tx * (0.8 - step * 0.3)) * len * 0.6, ey = ky + (f.ny * side * 0.4 - f.ty * (0.8 - step * 0.3)) * len * 0.6;
      S(ctx, hc, 0.75, 1.1 + v * 0.1); ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
      glowDot(ctx, kx, ky, 1.1 + v * 0.05, pal.accent, 0.7);
    }
    ctx.restore();
  }

  // ── FLAGELLA ────────────────────────────────────────────────────
  function tailFrame(pts) {
    const tail = pts[pts.length - 1], t2 = pts[Math.max(0, pts.length - 3)];
    let dx = tail.x - t2.x, dy = tail.y - t2.y; const l = Math.hypot(dx, dy) || 0.001; dx /= l; dy /= l;
    return { x: tail.x, y: tail.y, dx, dy, px: -dy, py: dx };
  }
  function whip(ctx, f, ang, len, amp, t, par, segs, off) {
    const c = Math.cos(ang), s = Math.sin(ang), dx = f.dx * c - f.dy * s, dy = f.dx * s + f.dy * c, px = -dy, py = dx;
    ctx.beginPath(); ctx.moveTo(f.x, f.y);
    for (let i = 1; i <= segs; i++) {
      const q = i / segs, w = Math.sin(t * par.speed * 2.5 - i * 0.7 + par.phase + (off || 0)) * amp * q * q;
      ctx.lineTo(f.x + dx * len * q - px * w, f.y + dy * len * q - py * w);
    }
    ctx.stroke();
  }
  function drawTwinWhip(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const f = tailFrame(pts), len = 26 + v * 4, amp = 8 + v * 1.6;
    S(ctx, pal.accent, 0.42, 0.5 + v * 0.1); whip(ctx, f, 0.32 * side, len, amp, t, par, 12, 0);
    S(ctx, hc, 0.38, 0.45 + v * 0.1); whip(ctx, f, -0.32 * side, len * 0.92, amp, t, par, 12, 1.4);
    ctx.restore();
  }
  function drawCorkscrew(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const f = tailFrame(pts), len = 28 + v * 4, amp = 4 + v * 0.7, turns = 3 + v * 0.3;
    for (const [ph, c, a] of [[0, pal.accent, 0.5], [Math.PI, hc, 0.35]]) {
      S(ctx, c, a, 0.6 + v * 0.07); ctx.beginPath(); ctx.moveTo(f.x, f.y);
      for (let i = 1; i <= 24; i++) {
        const q = i / 24, w = Math.sin(q * turns * TAU - t * par.speed * 8 + ph + par.phase) * amp * Math.min(1, q * 3);
        ctx.lineTo(f.x + f.dx * len * q + f.px * w, f.y + f.dy * len * q + f.py * w);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawFinVeil(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 12) return; begin(ctx);
    const w = 4 + v * 0.8, start = 6, end = pts.length - 1;
    ctx.beginPath();
    const f0 = frame(pts, start); ctx.moveTo(f0.x, f0.y);
    for (let i = start; i <= end; i++) {
      const f = frame(pts, i), q = (i - start) / (end - start), h = w * Math.sin(q * Math.PI) * (1 + 0.35 * Math.sin(t * par.speed * 3 - i * 0.6 + par.phase));
      ctx.lineTo(f.x + f.nx * side * h, f.y + f.ny * side * h);
    }
    for (let i = end; i >= start; i--) ctx.lineTo(pts[i].x, pts[i].y);
    F(ctx, E.mix(hc, pal.accent, 0.4), 0.16); ctx.fill(); S(ctx, pal.accent, 0.4, 0.6); ctx.stroke();
    ctx.restore();
  }
  function drawJetSiphon(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const f = tailFrame(pts), pulse = 0.5 + 0.5 * Math.sin(t * par.speed * 6 + par.phase);
    const r = 2.6 + v * 0.35;
    F(ctx, hc, 0.25); ctx.beginPath(); ctx.ellipse(f.x, f.y, r * 1.6, r * (0.8 + pulse * 0.4), Math.atan2(f.dy, f.dx), 0, TAU); ctx.fill();
    S(ctx, pal.accent, 0.6, 0.8); ctx.stroke();
    for (let i = 1; i <= 5 + Math.floor(v / 2); i++) {
      const q = ((i + t * par.speed * 3) % 6) / 6, d = 6 + q * (22 + v * 3);
      F(ctx, E.mix(pal.accent, E.WHITE, 0.4), (1 - q) * 0.5);
      ctx.beginPath(); ctx.arc(f.x + f.dx * d + f.px * Math.sin(i * 2.1) * 2, f.y + f.dy * d + f.py * Math.sin(i * 2.1) * 2, (1 - q) * (1.4 + v * 0.1), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawStinger(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const f = tailFrame(pts), segs = 5 + Math.floor(v / 3), sl = 4 + v * 0.5;
    let x = f.x, y = f.y, a = Math.atan2(f.dy, f.dx);
    const curl = (0.35 + 0.1 * Math.sin(t * par.speed * 2 + par.phase)) * side;
    for (let i = 0; i < segs; i++) {
      const nx = x + Math.cos(a) * sl, ny = y + Math.sin(a) * sl;
      S(ctx, hc, 0.7, 2.4 - i * 0.25 + v * 0.08); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny; a += curl;
    }
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (4 + v * 0.4), y + Math.sin(a) * (4 + v * 0.4));
    S(ctx, pal.accent, 0.9, 1.2); ctx.stroke(); glowDot(ctx, x, y, 1 + v * 0.06, pal.accent, 0.6);
    ctx.restore();
  }

  // ── PILI ────────────────────────────────────────────────────────
  function drawCombs(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const n = Math.min(pts.length - 2, 8 + v);
    for (let i = 1; i <= n; i++) {
      const f = frame(pts, i), beat = Math.sin(t * par.speed * 5 - i * 0.8 + par.phase);
      const h = 2.5 + v * 0.35, a = beat * 0.6;
      const dx = f.nx * side * Math.cos(a) + f.tx * Math.sin(a), dy = f.ny * side * Math.cos(a) + f.ty * Math.sin(a);
      const hue = (i * 28 + t * 60) % 360;
      ctx.strokeStyle = `hsla(${hue},90%,72%,${0.25 + 0.3 * (beat * 0.5 + 0.5)})`; ctx.lineWidth = 0.9 + v * 0.05;
      ctx.beginPath(); ctx.moveTo(f.x + f.nx * side, f.y + f.ny * side); ctx.lineTo(f.x + dx * h, f.y + dy * h); ctx.stroke();
    }
    ctx.restore();
  }
  function drawFronds(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const cnt = 3 + Math.floor(v / 3), h = 6 + v * 0.9;
    for (let k = 0; k < cnt; k++) {
      const i = 2 + Math.round(k * (Math.min(pts.length - 3, 15) - 2) / Math.max(1, cnt - 1));
      const f = frame(pts, i), sway = Math.sin(t * par.speed * 2 + k + par.phase) * 0.4;
      const dx = f.nx * side * Math.cos(sway) - f.tx * Math.sin(sway) * 0.8 - f.tx * 0.3, dy = f.ny * side * Math.cos(sway) - f.ty * Math.sin(sway) * 0.8 - f.ty * 0.3;
      S(ctx, hc, 0.32, 0.5 + v * 0.04);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + dx * h, f.y + dy * h); ctx.stroke();
      for (let b = 1; b <= 4; b++) {
        const q = b / 5, bx = f.x + dx * h * q, by = f.y + dy * h * q, bl = h * 0.28 * (1 - q * 0.5);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - f.tx * bl + dx * bl * 0.4, by - f.ty * bl + dy * bl * 0.4); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawTethers(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const n = 2 + Math.floor(v / 4), len = 24 + v * 4;
    for (let k = 0; k < n; k++) {
      const f = frame(pts, 4 + k * 3);
      S(ctx, pal.accent, 0.22, 0.45); ctx.beginPath(); ctx.moveTo(f.x, f.y);
      let lx = f.x, ly = f.y;
      for (let i = 1; i <= 10; i++) {
        const q = i / 10, w = Math.sin(t * par.speed * 1.4 - i * 0.5 + k * 2 + par.phase) * 5 * q;
        lx = f.x + (f.nx * side * 0.5 - f.tx) * len * q + f.nx * w; ly = f.y + (f.ny * side * 0.5 - f.ty) * len * q + f.ny * w;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke(); glowDot(ctx, lx, ly, 0.9, pal.accent, 0.55);
    }
    ctx.restore();
  }
  function drawSporeSacs(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const gold = { r: 0xff, g: 0xe0, b: 0x66 };
    const n = 2 + Math.floor(v / 3);
    for (let k = 0; k < n; k++) {
      const i = 3 + k * 3; if (i >= pts.length) break;
      const f = frame(pts, i), p = 0.5 + 0.5 * Math.sin(t * par.speed * 2.4 + k * 1.3 + par.phase), r = 2 + v * 0.22 + p * 0.8;
      const x = f.x + f.nx * side * (r + 1.5), y = f.y + f.ny * side * (r + 1.5);
      F(ctx, E.mix(hc, gold, 0.6), 0.18 + 0.1 * p); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      S(ctx, gold, 0.5, 0.6); ctx.stroke();
      glowDot(ctx, x, y, 0.8 + p * 0.5, gold, 0.5 + 0.3 * p);
    }
    ctx.restore();
  }
  function drawLures(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const f = frame(pts, 1), len = 14 + v * 2.2, sway = Math.sin(t * par.speed * 1.2 + par.phase) * 0.3;
    const bx = f.x + (f.tx * 0.9 + f.nx * side * (0.5 + sway)) * len, by = f.y + (f.ty * 0.9 + f.ny * side * (0.5 + sway)) * len;
    const cx = f.x + f.nx * side * len * 0.9, cy = f.y + f.ny * side * len * 0.9;
    S(ctx, hc, 0.55, 0.7 + v * 0.05); ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
    const p = 0.6 + 0.4 * Math.sin(t * 3 + par.phase);
    glowDot(ctx, bx, by, 1.6 + v * 0.18, E.mix(pal.accent, E.WHITE, 0.3), p);
    ctx.restore();
  }

  // ── MANDIBLES ───────────────────────────────────────────────────
  function headFrame(pts) {
    const pt = pts[1], head = pts[0];
    let fx = head.x - pt.x, fy = head.y - pt.y; const l = Math.hypot(fx, fy) || 0.001; fx /= l; fy /= l;
    return { x: head.x, y: head.y, bx: pt.x, by: pt.y, fx, fy, px: -fy, py: fx };
  }
  function drawPincers(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const h = headFrame(pts), len = 9 + v * 1.3, open = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * par.speed * 3 + par.phase));
    const ax = h.bx + h.px * side * 4, ay = h.by + h.py * side * 4;
    const ex = ax + (h.fx + h.px * side * 0.6) * len * 0.6, ey = ay + (h.fy + h.py * side * 0.6) * len * 0.6;
    S(ctx, hc, 0.75, 1.3 + v * 0.1); ctx.beginPath(); ctx.moveTo(h.bx, h.by); ctx.lineTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    const ca = Math.atan2(h.fy, h.fx);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ca);
    F(ctx, hc, 0.25); ctx.beginPath(); ctx.ellipse(0, 0, 3 + v * 0.3, 2.2 + v * 0.2, 0, 0, TAU); ctx.fill(); S(ctx, hc, 0.7, 0.8); ctx.stroke();
    S(ctx, pal.accent, 0.8, 0.9 + v * 0.06);
    ctx.beginPath(); ctx.moveTo(2, -1); ctx.quadraticCurveTo(6 + v * 0.5, -3 - open * 6, 8 + v * 0.7, -open * 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 1); ctx.quadraticCurveTo(6 + v * 0.5, 3 + open * 6, 8 + v * 0.7, open * 3); ctx.stroke();
    ctx.restore(); ctx.restore();
  }
  function drawSawjaw(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const h = headFrame(pts), len = 9 + v * 1.2, open = 0.35 + 0.35 * Math.sin(t * par.speed * 4 + par.phase);
    const ex = h.bx + (h.px * side * open + h.fx) * len, ey = h.by + (h.py * side * open + h.fy) * len;
    S(ctx, hc, 0.8, 1 + v * 0.08); ctx.beginPath(); ctx.moveTo(h.bx, h.by); ctx.lineTo(ex, ey); ctx.stroke();
    const teeth = 3 + Math.floor(v / 2);
    S(ctx, E.mix(pal.accent, E.WHITE, 0.3), 0.8, 0.6); ctx.beginPath();
    for (let i = 0; i <= teeth; i++) {
      const q = i / teeth, x = h.bx + (ex - h.bx) * q, y = h.by + (ey - h.by) * q, o = (i % 2 ? 2 : 0) + v * 0.1;
      const ix = x - h.px * side * o, iy = y - h.py * side * o;
      i ? ctx.lineTo(ix, iy) : ctx.moveTo(ix, iy);
    }
    ctx.stroke(); ctx.restore();
  }
  function drawProboscis(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3 || side < 0) return; begin(ctx);
    const h = headFrame(pts), len = 14 + v * 2.4, sw = Math.sin(t * par.speed * 1.5 + par.phase) * 0.12;
    const dx = h.fx + h.px * sw, dy = h.fy + h.py * sw;
    S(ctx, hc, 0.85, 1.6 + v * 0.06); ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + dx * len * 0.7, h.y + dy * len * 0.7); ctx.stroke();
    S(ctx, E.mix(pal.accent, E.WHITE, 0.4), 0.9, 0.7); ctx.beginPath(); ctx.moveTo(h.x + dx * len * 0.7, h.y + dy * len * 0.7); ctx.lineTo(h.x + dx * len, h.y + dy * len); ctx.stroke();
    glowDot(ctx, h.x + dx * len, h.y + dy * len, 0.9, pal.accent, 0.7);
    ctx.restore();
  }
  function drawVenom(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const venom = { r: 0x9a, g: 0xff, b: 0x5a };
    const h = headFrame(pts), len = 7 + v * 1.1;
    const bx = h.x + h.px * side * 2.5, by = h.y + h.py * side * 2.5;
    const cx = bx + (h.fx * 0.8 + h.px * side * 0.6) * len, cy = by + (h.fy * 0.8 + h.py * side * 0.6) * len;
    const ex = bx + (h.fx * 0.9 - h.px * side * 0.25) * len * 1.2, ey = by + (h.fy * 0.9 - h.py * side * 0.25) * len * 1.2;
    S(ctx, E.mix(hc, E.WHITE, 0.35), 0.85, 1.3 + v * 0.07); ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    const q = (t * par.speed * 0.8 + par.phase) % 1;
    F(ctx, venom, 0.7 * (1 - q)); ctx.beginPath(); ctx.arc(ex + h.fx * q * 6, ey + h.fy * q * 6, 0.9 + v * 0.06, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawNematocyst(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const h = headFrame(pts), n = 4 + Math.floor(v / 2), r = 4 + v * 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(h.fy, h.fx) + side * (0.25 + i * 0.28), l = r + Math.sin(t * par.speed * 5 + i * 1.7 + par.phase) * 1.5;
      const sx = h.x + Math.cos(a) * 2, sy = h.y + Math.sin(a) * 2;
      S(ctx, pal.accent, 0.6, 0.6); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); ctx.stroke();
      F(ctx, E.WHITE, 0.6); ctx.beginPath(); ctx.arc(sx + Math.cos(a) * l, sy + Math.sin(a) * l, 0.6, 0, TAU); ctx.fill();
    }
    const p = 0.5 + 0.5 * Math.sin(t * 4 + par.phase);
    glowDot(ctx, h.bx + h.px * side * 2, h.by + h.py * side * 2, 1.2 + v * 0.1 + p * 0.6, pal.accent, 0.4 + p * 0.3);
    ctx.restore();
  }

  // ── ANTENNAE ────────────────────────────────────────────────────
  function drawPlumes(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 2) return; begin(ctx);
    const head = pts[0], p2 = pts[1], base = Math.atan2(head.y - p2.y, head.x - p2.x);
    const len = 14 + v * 2.6, sweep = Math.sin(t * par.speed * 1.6 + par.phase) * (0.2 + v * 0.03);
    const a = base + sweep + 0.55 * side;
    const col = E.mix(hc, pal.accent, 0.3);
    S(ctx, col, 0.7, 0.6 + v * 0.06); ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(head.x + Math.cos(a) * len, head.y + Math.sin(a) * len); ctx.stroke();
    S(ctx, col, 0.35, 0.5);
    for (let i = 2; i <= 9; i++) {
      const q = i / 10, x = head.x + Math.cos(a) * len * q, y = head.y + Math.sin(a) * len * q, bl = (2 + v * 0.3) * Math.sin(q * Math.PI);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a + 1.9) * bl, y + Math.sin(a + 1.9) * bl); ctx.lineTo(x, y); ctx.lineTo(x + Math.cos(a - 1.9) * bl, y + Math.sin(a - 1.9) * bl); ctx.stroke();
    }
    ctx.restore();
  }
  function drawWhiskers(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 2) return; begin(ctx);
    const head = pts[0], p2 = pts[1], base = Math.atan2(head.y - p2.y, head.x - p2.x);
    const n = 3 + Math.floor(v / 3), len = 10 + v * 1.8;
    for (let i = 0; i < n; i++) {
      const a = base + side * (0.4 + i * 0.32) + Math.sin(t * par.speed * 3 + i + par.phase) * 0.08;
      S(ctx, E.mix(hc, E.WHITE, 0.4), 0.45, 0.45); ctx.beginPath(); ctx.moveTo(head.x, head.y);
      ctx.quadraticCurveTo(head.x + Math.cos(a) * len * 0.6, head.y + Math.sin(a) * len * 0.6, head.x + Math.cos(a + 0.2 * side) * len, head.y + Math.sin(a + 0.2 * side) * len); ctx.stroke();
    }
    ctx.restore();
  }
  function drawEyestalks(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 2) return; begin(ctx);
    const head = pts[0], p2 = pts[1], base = Math.atan2(head.y - p2.y, head.x - p2.x);
    const len = 7 + v * 1.1, a = base + side * 0.7 + Math.sin(t * par.speed + par.phase) * 0.15;
    const ex = head.x + Math.cos(a) * len, ey = head.y + Math.sin(a) * len;
    S(ctx, hc, 0.7, 0.9); ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(ex, ey); ctx.stroke();
    const blink = Math.sin(t * 0.7 + par.phase) > 0.97 ? 0.2 : 1;
    F(ctx, E.WHITE, 0.85); ctx.beginPath(); ctx.ellipse(ex, ey, 1.8 + v * 0.14, (1.8 + v * 0.14) * blink, a, 0, TAU); ctx.fill();
    F(ctx, E.mix(pal.accent, { r: 0, g: 0, b: 0 }, 0.4), 1); ctx.beginPath(); ctx.arc(ex + Math.cos(base) * 0.6, ey + Math.sin(base) * 0.6, (0.8 + v * 0.06) * blink, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawHorns(ctx, pts, side, par, t, v, pal, hc) {
    if (pts.length < 3) return; begin(ctx);
    const h = headFrame(pts), len = 9 + v * 1.4, a0 = Math.atan2(h.fy, h.fx);
    const bx = h.x + h.px * side * 2, by = h.y + h.py * side * 2;
    ctx.beginPath(); ctx.moveTo(bx, by);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const q = i / steps, a = a0 + side * (0.9 + q * 1.6);
      ctx.lineTo(bx + Math.cos(a) * len * q, by + Math.sin(a) * len * q);
    }
    S(ctx, hc, 0.25, 3 + v * 0.2); ctx.stroke();
    S(ctx, E.mix(pal.accent, E.WHITE, 0.25), 0.75, 1 + v * 0.07); ctx.stroke();
    const p = 0.5 + 0.5 * Math.sin(t * 2 + par.phase);
    ctx.strokeStyle = rgba(pal.accent, 0.12 * p); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(h.x, h.y, 8 + p * (6 + v), 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function drawPhotophores(ctx, pts, side, par, t, v, pal, hc) {
    begin(ctx);
    const n = Math.min(pts.length - 1, 5 + v);
    for (let i = 1; i <= n; i++) {
      const f = frame(pts, i * 1.5 | 0), on = Math.max(0, Math.sin(t * par.speed * 3 - i * 0.9 + par.phase));
      glowDot(ctx, f.x + f.nx * side * 2.4, f.y + f.ny * side * 2.4, 0.7 + v * 0.05, E.mix(pal.accent, E.WHITE, 0.2), 0.2 + on * 0.7);
    }
    const h = headFrame(pts);
    S(ctx, pal.accent, 0.6, 0.8); ctx.beginPath(); ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x - h.fx * 3 + h.px * side * (4 + v * 0.5), h.y - h.fy * 3 + h.py * side * (4 + v * 0.5)); ctx.stroke();
    ctx.restore();
  }

  // ── organ table ─────────────────────────────────────────────────
  // stats(v) returns additive stat deltas; tags are passive effects; ability is an active id.
  const O = [
    // Legs
    { id: 'cilia', cls: 'leg', form: 1, name: 'Cilia-feet', blurb: 'The original walking cilia. Plain, sturdy, cheap.', draw: seedDraw('leg'),
      stats: v => ({ hp: 22 + 4 * v, speed: 4 }) },
    { id: 'paddles', cls: 'leg', form: 2, name: 'Oar-paddles', blurb: 'Flat oars that trade some bulk for pace.', draw: drawPaddles,
      stats: v => ({ hp: 12 + 2 * v, speed: 8 + 1.2 * v }) },
    { id: 'grapnel', cls: 'leg', form: 3, name: 'Grapnel-hooks', blurb: 'Hooked limbs that snag prey. Hits slow the target.', draw: drawGrapnel,
      stats: v => ({ hp: 16 + 3 * v, slowOnHit: 0.25 + 0.01 * v }) },
    { id: 'thorn', cls: 'leg', form: 4, name: 'Thorn-limbs', blurb: 'Rows of spines. Attackers take a share of their own bite back.', draw: drawThorns,
      stats: v => ({ hp: 18 + 3 * v, thorns: 0.2 + 0.02 * v }) },
    { id: 'tubefeet', cls: 'leg', form: 5, name: 'Tube-feet', blurb: 'Starfish-soft feet that knit wounds closed.', draw: drawTubeFeet,
      stats: v => ({ hp: 14 + 3 * v, regen: 0.8 + 0.15 * v }) },
    { id: 'stilts', cls: 'leg', form: 6, name: 'Anchor-stilts', blurb: 'Long jointed struts: heavy, armored, slow.', draw: drawStilts,
      stats: v => ({ hp: 26 + 5 * v, armor: 0.08 + 0.01 * v, speed: -4 }) },
    // Flagella
    { id: 'whiptail', cls: 'flagella', form: 1, name: 'Whiptail', blurb: 'The seed’s traveling-wave tail.', draw: seedDraw('flagella'),
      stats: v => ({ speed: 16 + 2.2 * v }) },
    { id: 'twinwhip', cls: 'flagella', form: 2, name: 'Twin-whips', blurb: 'Forked tails: blistering speed, thinner body.', draw: drawTwinWhip,
      stats: v => ({ speed: 24 + 3 * v, hp: -8 }) },
    { id: 'corkscrew', cls: 'flagella', form: 3, name: 'Corkscrew', blurb: 'A helical drive that makes the swimmer hard to pin down.', draw: drawCorkscrew,
      stats: v => ({ speed: 12 + 1.6 * v, evasion: 0.06 + 0.01 * v }) },
    { id: 'finveil', cls: 'flagella', form: 4, name: 'Fin-veil', blurb: 'Rippling veils for tight, graceful turns.', draw: drawFinVeil,
      stats: v => ({ speed: 12 + 1.8 * v, turn: 0.8 }) },
    { id: 'jetsiphon', cls: 'flagella', form: 5, name: 'Jet-siphon', blurb: 'A pulsing siphon. Grants Jet Dash.', draw: drawJetSiphon, ability: 'jet',
      stats: v => ({ speed: 8 + 1.2 * v }) },
    { id: 'stinger', cls: 'flagella', form: 6, name: 'Stinger-tail', blurb: 'A curled tail that stings as it swims.', draw: drawStinger,
      stats: v => ({ speed: 8 + v, dps: 3 + 0.8 * v }) },
    // Pili
    { id: 'fuzz', cls: 'pili', form: 1, name: 'Fuzz', blurb: 'The seed’s swaying pili. Honest gatherers.', draw: seedDraw('pili'),
      stats: v => ({ harvest: 4 + 0.8 * v, cargo: 14 + 2.5 * v }) },
    { id: 'combs', cls: 'pili', form: 2, name: 'Comb-rows', blurb: 'Rainbow comb plates with deep holds.', draw: drawCombs,
      stats: v => ({ harvest: 3 + 0.6 * v, cargo: 26 + 4 * v }) },
    { id: 'fronds', cls: 'pili', form: 3, name: 'Siphon-fronds', blurb: 'Feathered fronds that drink light fast.', draw: drawFronds,
      stats: v => ({ harvest: 6 + 1.1 * v, cargo: 10 + 2 * v }) },
    { id: 'tether', cls: 'pili', form: 4, name: 'Tether-lines', blurb: 'Sticky threads that siphon life. Grants Tether Drain.', draw: drawTethers, ability: 'tether',
      stats: v => ({ harvest: 2 + 0.4 * v, cargo: 8, leech: 0.1 + 0.01 * v }) },
    { id: 'sporesacs', cls: 'pili', form: 5, name: 'Spore-sacs', blurb: 'Gold bladders, twice as good with Spore. Grants Mend Spores.', draw: drawSporeSacs, ability: 'mend',
      stats: v => ({ harvest: 2 + 0.5 * v, cargo: 10 + 2 * v, sporeBonus: 1 }) },
    { id: 'lures', cls: 'pili', form: 6, name: 'Glow-lures', blurb: 'Angler lures: wider sight, and nearby enemies slow down.', draw: drawLures,
      stats: v => ({ harvest: 3 + 0.5 * v, cargo: 12, vision: 40 + 6 * v, lure: 0.15 }) },
    // Mandibles
    { id: 'nippers', cls: 'mandible', form: 1, name: 'Nippers', blurb: 'The seed’s opening mandibles.', draw: seedDraw('mandible'),
      stats: v => ({ dps: 5 + 1.1 * v, range: 14 + 1.4 * v }) },
    { id: 'pincers', cls: 'mandible', form: 2, name: 'Pincers', blurb: 'Crushing claws: brutal but short.', draw: drawPincers,
      stats: v => ({ dps: 7 + 1.5 * v, range: 10 + 0.8 * v }) },
    { id: 'sawjaw', cls: 'mandible', form: 3, name: 'Sawjaw', blurb: 'Serrated jaws that leave targets bleeding.', draw: drawSawjaw,
      stats: v => ({ dps: 4 + 0.9 * v, range: 14 + v, bleed: 2 + 0.4 * v }) },
    { id: 'proboscis', cls: 'mandible', form: 4, name: 'Proboscis', blurb: 'A long needle that slips through armor.', draw: drawProboscis,
      stats: v => ({ dps: 4 + 1.0 * v, range: 24 + 2 * v, pierce: 0.5 }) },
    { id: 'venom', cls: 'mandible', form: 5, name: 'Venom-fangs', blurb: 'Poisonous, numbing fangs. Grants Venom Burst.', draw: drawVenom, ability: 'venom',
      stats: v => ({ dps: 3 + 0.7 * v, range: 14 + v, poison: 3 + 0.5 * v, slowOnHit: 0.15 }) },
    { id: 'nematocyst', cls: 'mandible', form: 6, name: 'Nematocysts', blurb: 'Stinging cells fired as darts. Ranged. Grants Spit Volley.', draw: drawNematocyst, ability: 'spit',
      stats: v => ({ shot: 8 + 1.6 * v, shotRange: 110 + 6 * v, shotCd: 1.2 }) },
    // Antennae
    { id: 'feelers', cls: 'antenna', form: 1, name: 'Feelers', blurb: 'The seed’s sweeping antennae.', draw: seedDraw('antenna'),
      stats: v => ({ sense: 30 + 6 * v }) },
    { id: 'plumes', cls: 'antenna', form: 2, name: 'Plume-fans', blurb: 'Feathered fans that sift the water for miles.', draw: drawPlumes,
      stats: v => ({ sense: 50 + 8 * v }) },
    { id: 'whiskers', cls: 'antenna', form: 3, name: 'Whisker array', blurb: 'Pressure whiskers that feel hidden things.', draw: drawWhiskers,
      stats: v => ({ sense: 20 + 4 * v, detect: 120 + 10 * v }) },
    { id: 'eyestalks', cls: 'antenna', form: 4, name: 'Eye-stalks', blurb: 'True eyes. Extends the reach of ranged attacks.', draw: drawEyestalks,
      stats: v => ({ sense: 30 + 5 * v, shotRangeBonus: 20 + 3 * v }) },
    { id: 'horns', cls: 'antenna', form: 5, name: 'Resonant horns', blurb: 'Horns that hum courage into allies. Grants War Song.', draw: drawHorns, ability: 'warsong',
      stats: v => ({ sense: 15 + 3 * v, aura: 0.08 }) },
    { id: 'photophores', cls: 'antenna', form: 6, name: 'Photophores', blurb: 'Rows of flashing lights. Grants Dazzle.', draw: drawPhotophores, ability: 'dazzle',
      stats: v => ({ sense: 15 + 3 * v }) },
  ];
  E.ORGANS = {};
  O.forEach(o => { o.icon = E.CLASSES[o.cls].icon + o.form; E.ORGANS[o.id] = o; });
  E.ORGAN_LIST = O;
  E.organsOf = cls => O.filter(o => o.cls === cls);
  E.frame = frame; E.headFrame = headFrame; E.glowDot = glowDot;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
