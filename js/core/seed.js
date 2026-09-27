// Verbatim seed: the Bioluminescent Dreamscape pack (helpers + pack object).
// Do not edit — the game layer builds on top of this.
// ── shared helpers ──────────────────────────────────────────────
function hexToRgb(hex) {
  const s = hex.replace("#", "");
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgba({ r, g, b }, a) { return `rgba(${r},${g},${b},${a})`; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerpRgb(c1, c2, t) {
  return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) };
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ════════════════════════════════════════════════════════════════
// BIOLUMINESCENT DREAMSCAPE — organic tidepool. Drifting motes
// of light, swaying kelp-like tendrils, and concentric pulse waves
// that bloom with device activity. A calm alternative to the
// existing packs.
// ════════════════════════════════════════════════════════════════
const BioluminescentDreamscape = {
 id: "bioluminescent",
 name: "Bioluminescent Dreamscape",
 description: "Free-swimming bioluminescent organisms drift through the abyss, their luminous bodies tracing sinuous paths in the dark. Caustic light shimmers across the depths, shifting with each pulse of device activity.",

 _energy: 0,
 _shimmers: [],
_lastShimmer: 0,
 _lastCascade: 0,
 _plankton: null,
 _swimmers: null,
 _caustics: null,
 _depthDust: null,

 // Rich color palette — blues, violets, pinks under heavy load
 _SWIMMER_COLORS: [
  [{r:0x38,g:0xF8,b:0xC8}, {r:0x60,g:0xF0,b:0xFF}],  // cyan-green
  [{r:0x22,g:0xE9,b:0xA8}, {r:0xFF,g:0xE0,b:0x66}],  // emerald + gold
  [{r:0x30,g:0xB8,b:0xFF}, {r:0x80,g:0xD0,b:0xFF}],  // ocean blue
  [{r:0x78,g:0x64,b:0xFF}, {r:0xB0,g:0x90,b:0xFF}],  // violet
  [{r:0xB0,g:0x60,b:0xFF}, {r:0xD0,g:0x90,b:0xFF}],  // purple
  [{r:0xFF,g:0x70,b:0xC0}, {r:0xFF,g:0xA0,b:0xD8}],  // pink
 ],

 _BODY_PARTS: (function() {
  const p = [];
  function leg(v, segs, len, amp, cyc, w) {
   return {
    type:'leg',var:v,
    render(ctx, pts, side, par, t, cr, pal, hc) {
     const attach = [2,4,6,8];
     ctx.save(); ctx.lineCap = 'round';
     for (let ai = 0; ai < attach.length; ai++) {
      const ai2 = attach[ai];
      if (ai2 >= pts.length) continue;
      const pt = pts[ai2];
      const dirN = Math.min(ai2+1, pts.length-1);
      const dirP = Math.max(0, ai2-1);
      const dx = pts[dirN].x - pts[dirP].x;
      const dy = pts[dirN].y - pts[dirP].y;
      const dl = Math.hypot(dx,dy)||0.001;
      const spx = (-dy / dl) * side, spy = (dx / dl) * side;
      const cycle = Math.sin(t * par.speed * cyc + ai + par.phase);
      let cx = pt.x + spx * 2, cy2 = pt.y + spy * 2;
      ctx.strokeStyle = rgba(hc, 0.7); ctx.lineWidth = w;
      for (let s = 0; s < segs; s++) {
       const f = (s + 1) / segs;
       const ang = cycle * amp * (1 - f * 0.5);
       const dirX = spx * Math.cos(ang) - spy * Math.sin(ang);
       const dirY = spx * Math.sin(ang) + spy * Math.cos(ang);
       ctx.beginPath(); ctx.moveTo(cx, cy2);
       ctx.lineTo(cx + dirX * len / segs, cy2 + dirY * len / segs); ctx.stroke();
       cx += dirX * len / segs; cy2 += dirY * len / segs;
      }
     }
     ctx.restore();
    }
   };
  }
  function flagella(v, len, amp, w) {
   return {
    type:'flagella',var:v,
    render(ctx, pts, side, par, t, cr, pal, hc) {
     if (pts.length < 3) return;
     const tail = pts[pts.length-1], t2 = pts[Math.max(0,pts.length-3)];
     const dx = tail.x - t2.x, dy = tail.y - t2.y;
     const dl = Math.hypot(dx,dy)||0.001, ndx = dx / dl, ndy = dy / dl;
     const px = -ndy, py = ndx;
     ctx.save(); ctx.lineCap = 'round';
     ctx.strokeStyle = rgba(pal.accent, 0.4 + 0.2 * Math.sin(t * 2 + par.phase));
     ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(tail.x, tail.y);
     for (let i = 1; i <= 12; i++) {
      const f = i / 12;
      const wave = Math.sin(t * par.speed * 2.5 - i * 0.7 + par.phase) * amp * f * f;
      ctx.lineTo(tail.x + ndx * len * f - px * wave, tail.y + ndy * len * f - py * wave);
     }
     ctx.stroke(); ctx.restore();
    }
   };
  }
  function pili(v, cnt, height, amp, w) {
   return {
    type:'pili',var:v,
    render(ctx, pts, side, par, t, cr, pal, hc) {
     ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = rgba(hc, 0.25);
     ctx.lineWidth = w;
     const step = Math.max(1, Math.floor((pts.length - 2) / cnt));
     for (let i = 1; i < pts.length - 1; i += step) {
      const pt = pts[i];
      const dx = pts[Math.min(i+1, pts.length-1)].x - pts[Math.max(0, i-1)].x;
      const dy = pts[Math.min(i+1, pts.length-1)].y - pts[Math.max(0, i-1)].y;
      const dl = Math.hypot(dx,dy)||0.001;
      const spx = (-dy / dl) * side, spy = (dx / dl) * side;
      const wave = Math.sin(t * par.speed * 2 + i * 0.5 + par.phase) * amp;
      const h = height + wave;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
      ctx.quadraticCurveTo(pt.x + spx * h * 0.7, pt.y + spy * h * 0.7, pt.x + spx * h, pt.y + spy * h);
      ctx.stroke();
     }
     ctx.restore();
    }
   };
  }
  function mandible(v, len, w) {
   return {
    type:'mandible',var:v,
    render(ctx, pts, side, par, t, cr, pal, hc) {
     if (pts.length < 3) return;
     const pt = pts[1], head = pts[0];
     const hdx = head.x - pt.x, hdy = head.y - pt.y;
     const hdl = Math.hypot(hdx,hdy)||0.001, fdx = hdx / hdl, fdy = hdy / hdl;
     const px = -fdy, py = fdx;
     const open = Math.sin(t * par.speed * 4 + par.phase) * 0.4 + 0.3;
     ctx.save(); ctx.lineCap = 'round';
     ctx.strokeStyle = rgba(hc, 0.8); ctx.lineWidth = w;
     ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
     ctx.quadraticCurveTo(pt.x + px * side * len * 0.6, pt.y + py * side * len * 0.6,
      pt.x + px * side * len * open + fdx * len * 0.3, pt.y + py * side * len * open + fdy * len * 0.3);
     ctx.stroke();
     ctx.strokeStyle = rgba(pal.accent, 0.55); ctx.lineWidth = w * 0.5;
     ctx.beginPath(); ctx.moveTo(pt.x + fdx * 2, pt.y + fdy * 2);
     ctx.quadraticCurveTo(pt.x + px * side * len * 0.2 + fdx * len * 0.2, pt.y + py * side * len * 0.2 + fdy * len * 0.2,
      pt.x * 0.3 + (pt.x + px * side * len * open + fdx * len * 0.3) * 0.7 + fdx * 2,
      pt.y * 0.3 + (pt.y + py * side * len * open + fdy * len * 0.3) * 0.7 + fdy * 2);
     ctx.stroke(); ctx.restore();
    }
   };
  }
  function antenna(v, len, amp, w) {
   return {
    type:'antenna',var:v,
    render(ctx, pts, side, par, t, cr, pal, hc) {
     if (pts.length < 2) return;
     const head = pts[0], p2 = pts[Math.min(1, pts.length-1)];
     const baseAngle = Math.atan2(head.y - p2.y, head.x - p2.x);
     const sweep = Math.sin(t * par.speed * 2 + par.phase) * amp;
     ctx.save(); ctx.lineCap = 'round';
     ctx.strokeStyle = rgba(lerpRgb(hc, pal.accent, 0.3), 0.7);
     ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(head.x, head.y);
     for (let i = 1; i <= 8; i++) {
      const f = i / 8;
      const angle = baseAngle + sweep + f * 0.8 * side;
      ctx.lineTo(head.x + Math.cos(angle) * f * len, head.y + Math.sin(angle) * f * len);
     }
     ctx.stroke(); ctx.restore();
    }
   };
  }
  for (let v = 0; v < 10; v++) p.push(leg(v, 3 + Math.floor(v/4), 10 + v * 2, 0.4 + v * 0.1, 2.5 + v * 0.15, 0.8 + v * 0.07));
  for (let v = 0; v < 10; v++) p.push(flagella(v, 30 + v * 5, 10 + v * 2, 0.5 + v * 0.14));
  for (let v = 0; v < 10; v++) p.push(pili(v, 4 + Math.floor(v/3), 4 + v * 0.8, 1 + v * 0.3, 0.3 + v * 0.05));
  for (let v = 0; v < 10; v++) p.push(mandible(v, 10 + v * 1.4, 0.8 + v * 0.12));
  for (let v = 0; v < 10; v++) p.push(antenna(v, 15 + v * 3, 0.3 + v * 0.1, 0.5 + v * 0.1));
  return p;
})(),

_assignParts(rng) {
  const pool = this._BODY_PARTS;
  const count = 2 + Math.floor(rng() * 4);
  const used = new Set();
  const parts = [];
  for (let i = 0; i < count; i++) {
   let tries = 0, defIdx;
   do {
    defIdx = Math.floor(rng() * pool.length);
    tries++;
   } while (tries < 10 && used.has(pool[defIdx].type) && rng() < 0.5);
   used.add(pool[defIdx].type);
   parts.push({ defIdx, side: rng() < 0.5 ? -1 : 1, speed: 0.8 + rng() * 0.4, phase: rng() * Math.PI * 2 });
  }
  return parts;
},

 reset() {
  this._energy = 0; this._shimmers = [];this._lastShimmer = 0; this._lastCascade = 0;
  this._plankton = null; this._swimmers = null;
  this._caustics = null; this._depthDust = null;
 },

 render(ctx, W, H, s, t, dt) {
      const lowPower = s.lowPowerMode;
  const target = lowPower ? 0 : (
   (s.isProcessing ? 0.35 : 0) +
   s.inferenceLoad * 0.55 +
   clamp(s.queueDepth / 15, 0, 1) * 0.2
  );
  const k = 1 - Math.pow(0.001, Math.min(dt, 0.05));
  this._energy += (target - this._energy) * k;
  const e = this._energy;
  const cx = W / 2, cy = H / 2, rMax = Math.hypot(W, H);

  // ── Palette ──
  const pal = this._palette(e, s.isHealthy, s.isCharging,
   s.batteryLevel, s.batteryTemperature);
  const panic = s.batteryTemperature > 38 ? clamp((s.batteryTemperature - 38) / 10, 0, 1) : 0;

  // ═══ LAYER 1: THE ABYSS ═══
  const bgGrad = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy * 0.9, rMax * 0.8);
  const toRgba = (c, a) => rgba({r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b)}, a);
  bgGrad.addColorStop(0, toRgba(pal.bgCenter, 1));
  bgGrad.addColorStop(0.5, toRgba(pal.bg, 1));
  bgGrad.addColorStop(0.85, toRgba(pal.bg, 0.7));
  bgGrad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  // Surface shimmer
  if (!lowPower) {
   const sfGrad = ctx.createLinearGradient(0, 0, 0, H * 0.35);
   sfGrad.addColorStop(0, toRgba(lerpRgb(pal.primary, {r:0x82,g:0xFF,b:0xF0}, 0.3),
    0.03 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.7))));
   sfGrad.addColorStop(0.5, toRgba(pal.bgCenter, 0.02));
   sfGrad.addColorStop(1, 'rgba(0,0,0,0)');
   ctx.fillStyle = sfGrad; ctx.fillRect(0, 0, W, H * 0.35);
  }
  // Caustic patches (12, drifting)
  if (!this._caustics) {
   const rng = mulberry32(133); const c = [];
   for (let i = 0; i < 12; i++) {
    c.push({
     x: rng() * W, y: 0.1 + rng() * 0.7 * H,
     phase: rng() * 6.28, speed: 0.3 + rng() * 0.5,
     sz: 0.15 + rng() * 0.25,
     driftAngle: rng() * 6.28, driftSpeed: 0.2 + rng() * 0.4,
     wobble: rng() * 6.28, wobbleSpeed: 0.2 + rng() * 0.4,
    });
   }
   this._caustics = c;
  }
  if (!lowPower) {
   const margin = W * 0.2;
   for (const c of this._caustics) {
    c.x += Math.cos(c.driftAngle) * c.driftSpeed * 60 * dt;
    c.y += Math.sin(c.driftAngle) * c.driftSpeed * 60 * dt;
    if (c.x < -margin) c.x = W + margin; if (c.x > W + margin) c.x = -margin;
    if (c.y < -margin) c.y = H + margin; if (c.y > H + margin) c.y = -margin;
    const cx2 = c.x + Math.sin(t * c.speed * 0.15 + c.phase) * W * 0.1;
    const cy2 = c.y + Math.sin(t * c.speed * 0.1 + c.phase * 1.3) * H * 0.08;
    const r = rMax * c.sz * (1 + 0.12 * Math.sin(t * c.wobbleSpeed + c.wobble));
    const cGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
    cGrad.addColorStop(0, toRgba(lerpRgb(pal.primary, {r:0xC8,g:0xFF,b:0xFF}, 0.5),
     0.045 * (0.5 + 0.5 * e)));
    cGrad.addColorStop(0.5, toRgba(pal.primary, 0.025 * (0.5 + 0.5 * e)));
    cGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cGrad; ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
   }
  }
  // Depth dust
  if (!this._depthDust) {
   const rng = mulberry32(211); const d = [];
   for (let i = 0; i < 45; i++) {
    d.push({
     x: rng() * W, y: rng() * H, phase: rng() * 6.28,
     sz: 0.6 + rng() * 1.3, depth: rng(),
     dx: rng() * W * 0.08, dy: rng() * H * 0.06,
    });
   }
   this._depthDust = d;
  }
  for (const d of this._depthDust) {
   const dx = d.x + Math.sin(t * (0.12 + d.depth * 0.2) + d.phase * 1.1) * d.dx;
   const dy = d.y + Math.sin(t * (0.1 + d.depth * 0.15) + d.phase * 0.8) * d.dy;
   const a = (0.2 + 0.3 * (1 - d.depth));
   ctx.fillStyle = rgba(pal.primary, a); ctx.beginPath();
   ctx.arc(dx, dy, d.sz, 0, Math.PI * 2); ctx.fill();
  }

  // ═══ LAYER 2: FREE-SWIMMERS — trail-based natural slithering ═══
  const MAX_TRAIL = 120;
  const maxSwimmers = lowPower ? 2 : 3 + Math.round(e * 8); // 3-8 depending on load
  if (!this._swimmers) {
   const rng = mulberry32(88);
   this._swimmers = [];
   for (let i = 0; i < 14; i++) {
    const sx = rng() * W, sy = rng() * H, sa = rng() * 6.28;
    const sSpeed = 0.2 + rng() * 0.3, sBodyLen = 50 + rng() * 20;
    const trail = [];
    for (let j = 0; j < MAX_TRAIL; j++) {
     trail.push({
      x: sx - Math.cos(sa) * j * (sSpeed * 60 / MAX_TRAIL),
      y: sy - Math.sin(sa) * j * (sSpeed * 60 / MAX_TRAIL),
     });
    }
    const hueOff = rng();
    const swimParts = this._assignParts(rng);
    this._swimmers.push({
     x: sx, y: sy, angle: sa, phase: rng() * 6.28, driftPhase: rng() * 6.28,
     size: 0.7 + rng() * 0.6, speed: sSpeed, swimFreq: 3 + rng() * 3,
     bodyLen: sBodyLen, hueOff: hueOff, colorIdx: Math.min(Math.floor(hueOff * 6), 5),
     targetX: rng() * W, targetY: rng() * H, turnTimer: 2 + rng() * 4,
     trail: trail, active: true, age: 0, lifeSpan: 15 + rng() * 15, fadeAlpha: 1,
     parts: swimParts,
    });
   }
  }

  const swimmers = this._swimmers;
  const swimCount = Math.min(maxSwimmers, swimmers.length);

  // Update — lifecycle, navigation, trail
  for (let i = 0; i < swimCount; i++) {
   const cr = swimmers[i];
   cr.age += dt;
   cr.fadeAlpha = 1;
   if (cr.age < 2) cr.fadeAlpha = cr.age / 2;
   const lifeRemaining = cr.lifeSpan - cr.age;
   if (lifeRemaining < 3 && lifeRemaining > 0) cr.fadeAlpha = lifeRemaining / 3;
   if (lifeRemaining <= 0) {
    const rng2 = mulberry32(Math.floor(t * 1000 + i * 7));
    cr.x = rng2() * W; cr.y = rng2() * H;
    cr.angle = rng2() * 6.28;
    cr.targetX = rng2() * W; cr.targetY = rng2() * H;
    cr.age = 0; cr.lifeSpan = 15 + rng2() * 15; cr.fadeAlpha = 0;
    cr.hueOff = rng2(); cr.colorIdx = Math.min(Math.floor(cr.hueOff * 6), 5);
     cr.parts = this._assignParts(rng2);
    for (let j = 0; j < MAX_TRAIL; j++) {
     cr.trail[j] = {
      x: cr.x - Math.cos(cr.angle) * j * (cr.speed * 60 / MAX_TRAIL),
      y: cr.y - Math.sin(cr.angle) * j * (cr.speed * 60 / MAX_TRAIL),
     };
    }
    continue;
   }

   // Wander toward target
   const tdx = cr.targetX - cr.x, tdy = cr.targetY - cr.y;
   const tDist = Math.hypot(tdx, tdy);
   cr.turnTimer -= dt;
   if (panic > 0) cr.turnTimer -= panic * dt * 2;
   if (cr.turnTimer <= 0 || tDist < 40) {
    cr.targetX = cx + (Math.random() * 2 - 1) * W * 0.38;
    cr.targetY = cy + (Math.random() * 2 - 1) * H * 0.38;
    cr.turnTimer = 2.5 + Math.random() * 3;
   }
   const tAngle = Math.atan2(tdy, tdx);
   let angleDiff = tAngle - cr.angle;
   while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
   while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
   const turnRate = (1.8 + e * 2 + panic * 3) * dt;
   cr.angle += clamp(angleDiff, -turnRate, turnRate);
   if (panic > 0 && Math.random() < 0.02) cr.angle += (Math.random() - 0.5) * panic * 0.5;
   const speedMul = lowPower ? 0.4 : lerp(0.6, 3.0, e) * (1 + panic * Math.random() * 0.3);
   cr.x += Math.cos(cr.angle) * cr.speed * speedMul * dt * 60;
   cr.y += Math.sin(cr.angle) * cr.speed * speedMul * dt * 60;
   cr.driftPhase += dt * 0.3;

   const m = cr.bodyLen * 0.5;
   if (cr.x < -m) cr.x = W + m; if (cr.x > W + m) cr.x = -m;
   if (cr.y < -m) cr.y = H + m; if (cr.y > H + m) cr.y = -m;

   cr.trail.unshift({x: cr.x, y: cr.y});
   if (cr.trail.length > MAX_TRAIL) cr.trail.pop();
  }

  // Interaction: proximity glow + mutual steering
  for (let i = 0; i < swimCount; i++) {
   for (let j = i + 1; j < swimCount; j++) {
    const a = swimmers[i], b = swimmers[j];
    const dx = a.x - b.x, dy = a.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 140) {
     const prox = 1 - dist / 140;
     const nearGlow = prox * (0.12 + prox * 0.2) * (0.5 + 0.5 * e);
     // Connection line
     ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
     ctx.strokeStyle = rgba(pal.accent, nearGlow * 0.3);
     ctx.lineWidth = 1.5 + prox * 3; ctx.stroke();
     // Midpoint glow
     const amidX = (a.x + b.x) / 2, amidY = (a.y + b.y) / 2;
     const connGrad = ctx.createRadialGradient(amidX, amidY, 0, amidX, amidY, 20 + prox * 20);
     connGrad.addColorStop(0, toRgba(pal.accent, nearGlow));
     connGrad.addColorStop(1, 'rgba(0,0,0,0)');
     ctx.fillStyle = connGrad; ctx.beginPath();
     ctx.arc(amidX, amidY, 20 + prox * 20, 0, Math.PI * 2); ctx.fill();
     // Mutual steering
     const steerA = Math.atan2(b.y - a.y, b.x - a.x);
     let diffA = steerA - a.angle;
     while (diffA > Math.PI) diffA -= Math.PI * 2;
     while (diffA < -Math.PI) diffA += Math.PI * 2;
     a.angle += diffA * dt * 0.7 * prox;
     const steerB = Math.atan2(a.y - b.y, a.x - b.x);
     let diffB = steerB - b.angle;
     while (diffB > Math.PI) diffB -= Math.PI * 2;
     while (diffB < -Math.PI) diffB += Math.PI * 2;
     b.angle += diffB * dt * 0.7 * prox;
    }
   }
  }

  // Render swimmers
  const numColors = e > 0.5 ? 6 : 3;
  for (let i = 0; i < swimCount; i++) {
   const cr = swimmers[i];
   const fade = cr.fadeAlpha;
   const trail = cr.trail;
   const trailLen = trail.length;
   if (trailLen < 3) continue;

   // Color: richer palette under heavy load
   const colorSet = this._SWIMMER_COLORS[cr.colorIdx % numColors];
   const activityCol = lerpRgb(colorSet[0], colorSet[1], e * 0.4);
   const vibrancy = e > 0.5 ? clamp((e - 0.5) * 2, 0, 1) : 0;
   const vividCol = lerpRgb(activityCol,
    lerpRgb({r:0xFF,g:0x80,b:0xFF}, {r:0xFF,g:0x60,b:0x80}, Math.sin(cr.phase + t * 0.3) * 0.5 + 0.5),
    vibrancy * 0.4);
   const heatShift = panic > 0
    ? {r: Math.round(vividCol.r + (255 - vividCol.r) * panic * 0.3),
       g: Math.round(vividCol.g * (1 - panic * 0.4)),
       b: Math.round(vividCol.b * (1 - panic * 0.4))}
    : vividCol;

   // Build body from trail — the trail captures the ACTUAL path the head traveled,
   // so the body follows naturally with zero mechanical pivot
   const segs = 20;
   const pts = [];
   const step = Math.max(1, (trailLen - 1) / (segs - 1));
   for (let si = 0; si < segs; si++) {
    const idx = Math.round(si * step);
    const safeIdx = Math.min(idx, trailLen - 1);
    const pt = trail[safeIdx];
    // Perpendicular to local trail direction for sine undulation
    const prevIdx = Math.max(0, safeIdx - 1);
    const nextIdx = Math.min(trailLen - 1, safeIdx + 1);
    const dirX = trail[nextIdx].x - trail[prevIdx].x;
    const dirY = trail[nextIdx].y - trail[prevIdx].y;
    const dirLen = Math.hypot(dirX, dirY) || 0.001;
    const perpX = -dirY / dirLen;
    const perpY = dirX / dirLen;
    // Traveling sine wave increases toward tail
    const waveAmp = cr.size * 5 * cr.speed * (si / (segs - 1));
    const wave = Math.sin(t * cr.swimFreq * 3 - si * 0.7 + cr.phase + cr.driftPhase * 2) * waveAmp;
    pts.push({x: pt.x + perpX * wave, y: pt.y + perpY * wave});
   }

   // ── Wake (fading trail glow) ──
   const wakeStep = Math.max(1, Math.floor(trailLen / 30));
   for (let wi = trailLen - 1; wi >= 0; wi -= wakeStep) {
    const f = wi / trailLen;
    const wakeA = fade * (1 - f) * 0.04 * (0.5 + 0.5 * e);
    if (wakeA < 0.001) continue;
    const wakeR = cr.size * lerp(0.5, 1.5, f) * (0.5 + 0.5 * e);
    ctx.fillStyle = rgba(heatShift, wakeA);
    ctx.beginPath(); ctx.arc(trail[wi].x, trail[wi].y, wakeR, 0, Math.PI * 2); ctx.fill();
   }

   // ── Body: smooth bezier path ──
   ctx.beginPath();
   ctx.moveTo(pts[0].x, pts[0].y);
   for (let k = 1; k < pts.length; k++) {
    const p0 = pts[k - 1], p1 = pts[k];
    ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
   }
   ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
   const panicFlicker = panic > 0 ? (0.7 + 0.3 * Math.sin(t * 12 + i * 3)) : 1;
   const bodyAlpha = fade * lerp(0.5, 0.9, e) * (0.6 + 0.4 * (1 - e * s.inferenceLoad)) * panicFlicker;
   const activity = s.isProcessing ? (1 + e * 0.5) : 1;

   // 3-layer glow body
   ctx.save(); ctx.strokeStyle = rgba(heatShift, bodyAlpha * 0.1);
   ctx.lineWidth = cr.size * 10 * activity; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
   ctx.save(); ctx.strokeStyle = rgba(heatShift, bodyAlpha * 0.25);
   ctx.lineWidth = cr.size * 5 * activity; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
   ctx.save(); ctx.strokeStyle = rgba(lerpRgb(heatShift, {r:0xFF,g:0xFF,b:0xFF}, 0.25), bodyAlpha * 0.85);
   ctx.lineWidth = Math.max(1.2, cr.size * 2.2 * activity); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();

   
   // ── Body parts (legs, flagella, pili, mandibles, antennae) ──
   if (cr.parts) {
    for (let pi = 0; pi < cr.parts.length; pi++) {
     const pDef = cr.parts[pi];
     const def = this._BODY_PARTS[pDef.defIdx];
     if (def) def.render(ctx, pts, pDef.side, pDef, t, cr, pal, heatShift);
    }
   }

   // Head glow
   const headSz = 3.5 * cr.size * activity;
   const headGrad = ctx.createRadialGradient(pts[0].x, pts[0].y, 0, pts[0].x, pts[0].y, headSz * 4);
   headGrad.addColorStop(0, toRgba(lerpRgb(pal.accent, {r:0xFF,g:0xFF,b:0xFF}, 0.5), bodyAlpha * 0.9 * fade * (panic > 0 ? (0.7 + 0.3 * Math.sin(t * 12 + i * 3)) : 1)));
   headGrad.addColorStop(0.5, toRgba(pal.accent, bodyAlpha * 0.2 * fade));
   headGrad.addColorStop(1, 'rgba(0,0,0,0)');
   ctx.fillStyle = headGrad; ctx.beginPath();
   ctx.arc(pts[0].x, pts[0].y, headSz * 4, 0, Math.PI * 2); ctx.fill();
  }

  // ═══ LAYER 3: PLANKTON (nano + micro) ═══
  if (!this._plankton) {
   const rng = mulberry32(42); const p = [];
   for (let i = 0; i < 25; i++) {
    p.push({type:'nano', ax:rng()*W, ay:rng()*H, phase:rng()*6.28,
     sz:0.7+rng()*1, depth:0.1+rng()*0.2, driftX:(rng()-0.5)*0.4, driftY:(rng()-0.5)*0.3});
   }
   for (let i = 0; i < 16; i++) {
    p.push({type:'micro', ax:rng()*W, ay:rng()*H, phase:rng()*6.28,
     sz:1.5+rng()*2.5, depth:0.3+rng()*0.3, driftX:(rng()-0.3)*0.5, driftY:(rng()-0.5)*0.4,
     trailLen:0.3+rng()*0.4});
   }
   this._plankton = p;
  }
  const plankSpeed = lowPower ? 0.2 : lerp(0.3, 1.2, e);
  const curDX = 0.3, curDY = -0.05;
  const plankPos = this._plankton.map(p => ({
   x: p.ax + Math.sin(t * plankSpeed * 0.4 + p.phase * 1.3) * p.driftX * W * 0.1 + t * curDX * W * 0.04,
   y: p.ay + Math.sin(t * plankSpeed * 0.35 + p.phase * 0.9) * p.driftY * H * 0.1 + t * curDY * H * 0.02,
  }));
  for (let i = 0; i < this._plankton.length; i++) {
   const p = this._plankton[i], pos = plankPos[i];
   const breathe = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.5 + p.phase));
   if (p.type === 'nano') {
    ctx.fillStyle = rgba(pal.primary, 0.06 * breathe * (1 + e * 0.5));
    ctx.beginPath(); ctx.arc(pos.x, pos.y, p.sz, 0, Math.PI * 2); ctx.fill();
   } else if (p.type === 'micro') {
    const ma = clamp(0.4 * breathe * (0.4 + e * 0.6), 0, 0.8);
    const szM = p.sz * (1 + e * 0.3);
    const tDirX = Math.cos(t * plankSpeed * 0.4 + p.phase * 1.3) * p.driftX;
    const tDirY = Math.cos(t * plankSpeed * 0.35 + p.phase * 0.9) * p.driftY;
    const tailLen2 = p.trailLen * 30;
    // Comet trail
    const tailGrad = ctx.createRadialGradient(
     pos.x - tDirX * tailLen2 * 2, pos.y - tDirY * tailLen2 * 2, 0,
     pos.x - tDirX * tailLen2 * 2, pos.y - tDirY * tailLen2 * 2, szM * 0.8);
    tailGrad.addColorStop(0, toRgba(pal.primary, ma * 0.3));
    tailGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tailGrad; ctx.beginPath();
    ctx.arc(pos.x - tDirX * tailLen2 * 2, pos.y - tDirY * tailLen2 * 2, szM * 0.8, 0, Math.PI * 2); ctx.fill();
    // Outer glow
    const glowGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, szM * 3.5);
    glowGrad.addColorStop(0, toRgba(pal.primary, ma * 0.25));
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad; ctx.beginPath(); ctx.arc(pos.x, pos.y, szM * 3.5, 0, Math.PI * 2); ctx.fill();
    // Core
    ctx.fillStyle = rgba(lerpRgb(pal.primary, {r:0xC8,g:0xFF,b:0xF0}, 0.3), ma * 0.8);
    ctx.beginPath(); ctx.arc(pos.x, pos.y, szM, 0, Math.PI * 2); ctx.fill();
   }
  }

  // ═══ LAYER 4: CAUSTIC SHIMMER BURSTS ═══
  if (!lowPower) {
   const emitGap = e > 0.7 ? lerp(0.6, 0.3, 1) :
    e > 0.3 ? lerp(3, 1.5, (e - 0.3) / 0.4) :
    s.isProcessing ? lerp(5, 3, e * 3) : 8;
   if (t - this._lastShimmer > emitGap) {
    const burstCount = 2 + Math.round(e * 3);
    for (let i = 0; i < burstCount; i++) {
     this._shimmers.push({born: t,
      x: (0.1 + Math.random() * 0.8) * W, y: (0.1 + Math.random() * 0.7) * H,
      hot: e * (0.6 + Math.random() * 0.4), phase: Math.random() * 6.28});
    }
    this._lastShimmer = t;
    if (e > 0.6 && t - this._lastCascade > 0.5) {
     for (let i = 0; i < 2; i++) {
      this._shimmers.push({born: t,
       x: (0.1 + Math.random() * 0.8) * W, y: (0.1 + Math.random() * 0.5) * H,
       hot: e * 0.5, phase: Math.random() * 6.28});
     }
     this._lastCascade = t;
    }
   }
   while (this._shimmers.length && t - this._shimmers[0].born >= 1.2) this._shimmers.shift();
   for (const s of this._shimmers) {
    const age = (t - s.born) / 1.2;
    const rad = lerp(W * 0.03, W * 0.25, age) * (0.7 + s.hot * 0.3);
    const alpha = (1 - age) * 0.15 * s.hot;
    const shGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
    shGrad.addColorStop(0, toRgba(lerpRgb(pal.accent, {r:0xFF,g:0xF8,b:0xF0}, 0.5), alpha));
    shGrad.addColorStop(0.5, toRgba(pal.primary, alpha * 0.4));
    shGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shGrad; ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill();
    // Secondary caustic lens
    const offX = Math.cos(s.phase + t * 0.6) * rad * 0.25;
    const offY = Math.sin(s.phase + t * 1.2) * rad * 0.2;
    const shGrad2 = ctx.createRadialGradient(s.x + offX, s.y + offY, 0, s.x + offX, s.y + offY, rad * 0.4);
    shGrad2.addColorStop(0, toRgba(pal.accent, alpha * 0.35));
    shGrad2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shGrad2; ctx.beginPath();
    ctx.arc(s.x + offX, s.y + offY, rad * 0.4, 0, Math.PI * 2); ctx.fill();
   }
   // Deep queue shimmer field
   if (s.queueDepth > 10) {
    const qbAlpha = clamp(s.queueDepth / 20, 0, 1) * 0.06;
    const qbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax * 0.35);
    qbGrad.addColorStop(0, toRgba(pal.accent, qbAlpha));
    qbGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = qbGrad; ctx.beginPath(); ctx.arc(cx, cy, rMax * 0.35, 0, Math.PI * 2); ctx.fill();
   }
  }

  // ═══ LAYER 6: OVERLAYS ═══
  if (s.isCharging && !lowPower) {
   const chgA = 0.04 + 0.06 * (0.5 + 0.5 * Math.sin(t * 2));
   const chgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax * 0.9);
   chgGrad.addColorStop(0, 'rgba(34,197,94,0)');
   chgGrad.addColorStop(1, rgba({r:0x22,g:0xC5,b:0x5E}, chgA));
   ctx.fillStyle = chgGrad; ctx.fillRect(0, 0, W, H);
  }
  if (!s.isHealthy) {
   const pulseAlpha = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(t * 3));
   ctx.fillStyle = rgba({ r: 255, g: 70, b: 70 }, pulseAlpha);
   ctx.fillRect(0, 0, W, H);
  }
 },

 _palette(e, isHealthy, isCharging, batteryLevel, batteryTemperature) {
  const idleP = {r:0x38,g:0xF8,b:0xC8}; const idleA = {r:0x60,g:0xF0,b:0xFF}; const idleBgC = {r:0x0A,g:0x18,b:0x20}; const idleBg = {r:0x04,g:0x0B,b:0x0F};
  const hotP = {r:0x22,g:0xE9,b:0xA8}; const hotA = {r:0xFF,g:0xE0,b:0x66}; const hotBgC = {r:0x0F,g:0x1E,b:0x1A}; const hotBg = {r:0x09,g:0x15,b:0x14};
  const tempT = clamp((batteryTemperature - 35) / 10, 0, 1);
  const warmP = lerpRgb(idleP, {r:0xEA,g:0xB3,b:0x08}, tempT);
  const warmA = lerpRgb(idleA, {r:0xFF,g:0x5A,b:0x5A}, tempT);
  const realP = batteryTemperature > 42 ? lerpRgb(warmP, {r:0xEF,g:0x44,b:0x44}, clamp((batteryTemperature - 42) / 6, 0, 1)) : warmP;
  const realA = batteryTemperature > 42 ? lerpRgb(warmA, {r:0xEF,g:0x44,b:0x44}, clamp((batteryTemperature - 42) / 6, 0, 1)) : warmA;
  const dim = 1 - (20 - batteryLevel) / 20 * 0.7;
  let battP = realP, battA = realA, battBg = hotBg, battBgC = hotBgC;
  if (batteryLevel < 20 && !isCharging) {
   battP = {r:Math.round(0x1A*dim),g:Math.round(0x4C*dim),b:Math.round(0x78*dim)};
   battA = {r:Math.round(0x1A*dim),g:Math.round(0x3A*dim),b:Math.round(0x5C*dim)};
   battBg = {r:0x02,g:0x06,b:0x08}; battBgC = {r:0x04,g:0x08,b:0x10};
  }
  if (!isHealthy) {
   return { primary: lerpRgb(battP, {r:0xEF,g:0x44,b:0x44}, 0.6),
    accent: {r:0xEF,g:0x44,b:0x44}, bgCenter: {r:0x14,g:0x06,b:0x08}, bg: {r:0x0A,g:0x03,b:0x04} };
  }
  return { primary: lerpRgb(battP, hotP, e), accent: lerpRgb(battA, hotA, e),
   bgCenter: lerpRgb(battBgC, hotBgC, e), bg: battBg };
 },
}

if (typeof window !== "undefined") window.BioluminescentDreamscape = BioluminescentDreamscape;
if (typeof globalThis !== "undefined") Object.assign(globalThis, { hexToRgb, rgba, lerp, clamp, lerpRgb, mulberry32, BioluminescentDreamscape });
