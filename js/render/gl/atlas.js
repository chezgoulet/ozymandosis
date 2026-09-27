// Atlas baker: renders the seed-style Canvas2D organ/chassis/effect drawings
// once into a texture atlas for the GPU pipeline.
//
// Channel encoding: drawings are made with body color = pure red, accent =
// pure green and white = pure blue. The sprite shader decodes
//   rgb = r·body + g·accent + b·white
// so one bake serves every culture, palette, fever and blight state.
//
// Organs: 30 organs × 4 research tiers × FRAMES animation frames, baked on a
// straight reference spine relative to an anchor (head, mid-body or tail).
// The shader cross-fades neighbouring frames so the loop reads as continuous motion.
(function (E) {
  'use strict';
  const TAU = E.TAU;
  const FRAMES = 8;
  const CYCLE = TAU / 2.5;           // seconds per baked loop
  const SPINE = 2.7;                  // reference spacing (organs were designed on this)
  const ENC = { body: { r: 255, g: 0, b: 0 }, accent: { r: 0, g: 255, b: 0 }, white: { r: 0, g: 0, b: 255 } };
  // Anchor classes (the point on the live spine the sprite is pinned to).
  const HEAD = new Set(['mandible', 'antenna']);
  const ANCHOR = id => {
    const o = E.ORGANS[id];
    if (o.cls === 'flagella') return 'tail';
    if (id === 'photophores') return 'body';
    if (id === 'lures') return 'head';
    return HEAD.has(o.cls) ? 'head' : 'body';
  };
  const ANCHOR_I = { head: 0, body: 5, tail: 19 };
  E.GL_FRAMES = FRAMES; E.GL_CYCLE = CYCLE; E.GL_ANCHOR_I = ANCHOR_I;

  function straightPts() { const p = []; for (let i = 0; i < 20; i++) p.push({ x: -i * SPINE, y: 0 }); return p; }
  function withEncoding(fn) {
    const w = E.WHITE; E.WHITE = ENC.white;
    try { fn(); } finally { E.WHITE = w; }
  }
  const PAL = { accent: ENC.accent, primary: ENC.body, bgCenter: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 }, panic: 0, starve: 0, e: 0.4 };

  // Decor drawings for chassis parts that are not the body ribbon.
  const DECOR = {
    bell: { frames: FRAMES, w: 44, h: 44, ox: 14, draw(ctx, f) {
      const pulse = 0.5 + 0.5 * Math.sin(f * TAU), R = 9 * (0.9 + pulse * 0.18), H = 7 * (1.1 - pulse * 0.25), hc = ENC.body, W = ENC.white;
      const g = ctx.createRadialGradient(H * 0.3, 0, 0, 0, 0, R * 1.2);
      g.addColorStop(0, E.rgba(E.mix(hc, W, 0.5), 0.45)); g.addColorStop(0.6, E.rgba(hc, 0.22)); g.addColorStop(1, E.rgba(hc, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-H * 0.4, -R); ctx.quadraticCurveTo(H * 1.6, -R * 0.9, H * 1.2, 0); ctx.quadraticCurveTo(H * 1.6, R * 0.9, -H * 0.4, R); ctx.quadraticCurveTo(-H * 0.1, 0, -H * 0.4, -R); ctx.fill();
      ctx.strokeStyle = E.rgba(E.mix(hc, W, 0.3), 0.75); ctx.lineWidth = 1; ctx.stroke();
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-H * 0.2, (k / 3 - 0.5) * R * 1.4); ctx.lineTo(H * 0.9, (k / 3 - 0.5) * R * 0.5); ctx.strokeStyle = E.rgba(ENC.accent, 0.3); ctx.stroke(); }
    } },
    comb: { frames: FRAMES, w: 30, h: 18, ox: 0, draw(ctx, f) {
      const L = 12, Wd = 6.5, hc = ENC.body, t = f * CYCLE;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
      g.addColorStop(0, E.rgba(E.mix(hc, ENC.white, 0.4), 0.3)); g.addColorStop(1, E.rgba(hc, 0.05));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, L, Wd, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = E.rgba(hc, 0.65); ctx.lineWidth = 0.9; ctx.stroke();
      for (let r = 0; r < 6; r++) {
        const y = (r / 5 - 0.5) * Wd * 1.5;
        for (let k = 0; k < 7; k++) {
          const x = (k / 6 - 0.5) * L * 1.6 * Math.sqrt(1 - Math.pow(y / Wd, 2) * 0.9);
          const on = 0.4 + 0.6 * Math.max(0, Math.sin(t * 8 - k * 0.9 + r));
          // comb rows shimmer between accent and white
          ctx.fillStyle = E.rgba(E.mix(ENC.accent, ENC.white, (k + r) % 3 / 2), 0.6 * on); ctx.fillRect(x - 0.7, y - 0.35, 1.4, 0.7);
        }
      }
    } },
    shell: { frames: FRAMES, w: 40, h: 40, ox: -4, draw(ctx, f) {
      const R = 9, hc = ENC.body, t = f * CYCLE;
      for (let k = 0; k < 7; k++) {
        const ta = (k / 6 - 0.5) * 1.2, l = R * (0.8 + 0.3 * Math.sin(t * 3 + k));
        ctx.beginPath(); ctx.moveTo(R * 0.4 + R * 0.6, 0);
        ctx.quadraticCurveTo(R * 0.6 + Math.cos(ta) * l, Math.sin(ta) * l, R * 0.6 + Math.cos(ta + Math.sin(t * 2 + k) * 0.3) * l * 1.4, Math.sin(ta + Math.sin(t * 2 + k) * 0.3) * l * 1.4);
        ctx.strokeStyle = E.rgba(hc, 0.5); ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.save(); ctx.rotate(Math.PI);
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const th = i / 60 * TAU * 1.6, r = R * 0.12 * Math.exp(0.21 * th); const x = Math.cos(th) * r, y = Math.sin(th) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.fillStyle = E.rgba(hc, 0.3); ctx.fill(); ctx.strokeStyle = E.rgba(E.mix(hc, ENC.white, 0.3), 0.85); ctx.lineWidth = 1.1; ctx.stroke();
      for (let k = 1; k < 7; k++) { const th = k / 7 * TAU * 1.6, r = R * 0.12 * Math.exp(0.21 * th); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r); ctx.strokeStyle = E.rgba(ENC.accent, 0.35); ctx.lineWidth = 0.6; ctx.stroke(); }
      ctx.restore();
    } },
    plate: { frames: 1, w: 10, h: 18, ox: 0, draw(ctx) {
      ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 7.5, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fillStyle = E.rgba(ENC.body, 0.4); ctx.fill(); ctx.strokeStyle = E.rgba(E.mix(ENC.body, ENC.white, 0.25), 0.8); ctx.lineWidth = 0.9; ctx.stroke();
    } },
    petal: { frames: 1, w: 60, h: 36, ox: 28, draw(ctx) {
      const L = 50, w = 0.42;
      ctx.beginPath(); ctx.moveTo(-28, 0);
      ctx.quadraticCurveTo(-28 + Math.cos(-w) * L * 0.8, Math.sin(-w) * L * 0.8, -28 + L, 0);
      ctx.quadraticCurveTo(-28 + Math.cos(w) * L * 0.8, Math.sin(w) * L * 0.8, -28, 0);
      ctx.fillStyle = E.rgba(ENC.body, 0.16); ctx.fill(); ctx.strokeStyle = E.rgba(ENC.accent, 0.6); ctx.lineWidth = 1.2; ctx.stroke();
    } },
  };
  // Culture shape markers (colour is never the only signal): white glyphs.
  const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'hexagon', 'star'];
  function shapePath(ctx, k, r) {
    ctx.beginPath();
    if (k === 'circle') ctx.arc(0, 0, r, 0, TAU);
    else if (k === 'square') ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
    else {
      const n = { triangle: 3, diamond: 4, hexagon: 6, star: 10 }[k];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i / n * TAU, rr = k === 'star' && i % 2 ? r * 0.48 : k === 'triangle' ? r * 1.15 : r;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
  }
  E.SHAPES = SHAPES; E.shapePath = shapePath;

  class Atlas {
    constructor(opts) {
      opts = opts || {};
      this.scale = opts.scale || 1;
      this.maxSize = opts.maxSize || 4096;
      this.cells = {}; this.organs = {}; this.decor = {};
    }
    // Measure each organ's union bounding box over all tiers and frames.
    measure(id) {
      const S = 400, cv = document.createElement('canvas'); cv.width = S; cv.height = S / 2;
      const ctx = cv.getContext('2d'), a = ANCHOR(id), ai = ANCHOR_I[a], pts = straightPts(), o = E.ORGANS[id];
      const ox = S / 2 - pts[ai].x, oy = S / 4;
      withEncoding(() => {
        for (const v of E.TIER_V) for (let f = 0; f < FRAMES; f += 2) {
          ctx.setTransform(1, 0, 0, 1, ox, oy);
          o.draw(ctx, pts, 1, { speed: 1, phase: 0 }, f / FRAMES * CYCLE, v, PAL, ENC.body);
        }
      });
      const d = ctx.getImageData(0, 0, S, S / 2).data;
      let x0 = S, y0 = S, x1 = 0, y1 = 0;
      for (let y = 0; y < S / 2; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) { x0 = S / 2 - 4; x1 = S / 2 + 4; y0 = S / 4 - 4; y1 = S / 4 + 4; }
      // bounds relative to the anchor point, symmetric in y so mirrored sides share a cell
      const ay = Math.max(S / 4 - y0, y1 - S / 4) + 2;
      return { l: x0 - S / 2 - 2, r: x1 - S / 2 + 2, t: -ay, b: ay, anchor: a };
    }
    build() {
      const t0 = performance.now();
      const s = this.scale, items = [];
      for (const o of E.ORGAN_LIST) {
        const b = this.measure(o.id);
        const w = Math.ceil((b.r - b.l) * s) + 2, h = Math.ceil((b.b - b.t) * s) + 2;
        this.organs[o.id] = { b, anchor: b.anchor, w, h, cells: [] };
        for (let ti = 0; ti < 4; ti++) for (let f = 0; f < FRAMES; f++) items.push({ kind: 'organ', id: o.id, ti, f, w, h });
      }
      for (const k in DECOR) { const d = DECOR[k]; this.decor[k] = { d, w: Math.ceil(d.w * s) + 2, h: Math.ceil(d.h * s) + 2, cells: [] }; for (let f = 0; f < d.frames; f++) items.push({ kind: 'decor', id: k, f, w: this.decor[k].w, h: this.decor[k].h }); }
      this.shapes = {}; for (const k of SHAPES) items.push({ kind: 'shape', id: k, w: Math.ceil(24 * s) + 2, h: Math.ceil(24 * s) + 2 });
      this.glyphs = {}; for (const p of E.POWERUP_LIST) items.push({ kind: 'glyph', id: p.id, ch: p.glyph, w: Math.ceil(28 * s) + 2, h: Math.ceil(28 * s) + 2 });
      // shelf pack, tallest first
      items.sort((a, b) => b.h - a.h);
      let W = 2048;
      const pack = (W, H) => { let x = 1, y = 1, row = 0; for (const it of items) { if (x + it.w + 1 > W) { x = 1; y += row + 1; row = 0; } it.x = x; it.y = y; x += it.w + 1; row = Math.max(row, it.h); } return y + row + 1 <= H; };
      let H = 1024; while (!pack(W, H) && H < this.maxSize) H *= 2;
      if (!pack(W, H)) { W = this.maxSize; H = this.maxSize; pack(W, H); }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      withEncoding(() => {
        for (const it of items) {
          ctx.save(); ctx.beginPath(); ctx.rect(it.x, it.y, it.w, it.h); ctx.clip();
          if (it.kind === 'organ') {
            const O = this.organs[it.id], b = O.b, pts = straightPts(), ai = ANCHOR_I[O.anchor];
            ctx.setTransform(s, 0, 0, s, it.x + 1 + (-b.l) * s - pts[ai].x * s, it.y + 1 + (-b.t) * s);
            E.ORGANS[it.id].draw(ctx, pts, 1, { speed: 1, phase: 0 }, it.f / FRAMES * CYCLE, E.TIER_V[it.ti], PAL, ENC.body);
            (O.cells[it.ti] || (O.cells[it.ti] = []))[it.f] = [it.x / W, it.y / H, (it.x + it.w) / W, (it.y + it.h) / H];
          } else if (it.kind === 'decor') {
            const D = this.decor[it.id];
            ctx.setTransform(s, 0, 0, s, it.x + it.w / 2 + D.d.ox * s * 0, it.y + it.h / 2);
            D.d.draw(ctx, it.f / D.d.frames);
            D.cells[it.f] = [it.x / W, it.y / H, (it.x + it.w) / W, (it.y + it.h) / H];
          } else if (it.kind === 'shape') {
            ctx.setTransform(s, 0, 0, s, it.x + it.w / 2, it.y + it.h / 2);
            shapePath(ctx, it.id, 8.5); ctx.fillStyle = 'rgba(255,0,0,0.6)'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(0,0,255,1)'; ctx.stroke();
            this.shapes[it.id] = [it.x / W, it.y / H, (it.x + it.w) / W, (it.y + it.h) / H];
          } else if (it.kind === 'glyph') {
            ctx.setTransform(s, 0, 0, s, it.x + it.w / 2, it.y + it.h / 2);
            ctx.fillStyle = 'rgb(255,0,0)'; ctx.font = '600 20px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.ch, 0, 1);
            this.glyphs[it.id] = [it.x / W, it.y / H, (it.x + it.w) / W, (it.y + it.h) / H];
          }
          ctx.restore();
        }
      });
      this.canvas = cv; this.W = W; this.H = H;
      this.buildMs = performance.now() - t0;
      return this;
    }
  }
  E.Atlas = Atlas;
})(window.E);
