// Minimap: whole-map overview with fog, entities and the camera frame.
(function (E) {
  'use strict';
  class Minimap {
    constructor(canvas, renderer) { this.cv = canvas; this.ctx = canvas.getContext('2d'); this.r = renderer; this.t = 0; }
    resize() {
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = r.width; this.h = r.height; this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr); this.dpr = dpr;
    }
    // map-space scale fitted into the canvas
    fit(view) { const m = view.s.map, k = Math.min(this.w / m.w, this.h / m.h); return { k, ox: (this.w - m.w * k) / 2, oy: (this.h - m.h * k) / 2 }; }
    toWorld(view, sx, sy) { const f = this.fit(view); return { x: (sx - f.ox) / f.k, y: (sy - f.oy) / f.k }; }
    draw(view, dt, alerts) {
      if (!this.w) this.resize();
      this.t -= dt; if (this.t > 0) return; this.t = 0.15;
      const ctx = this.ctx, s = view.s, R = this.r, f = this.fit(view), k = f.k;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = 'rgba(3,12,16,.9)'; ctx.fillRect(f.ox, f.oy, s.map.w * k, s.map.h * k);
      ctx.translate(f.ox, f.oy); ctx.scale(k, k);
      for (const c of s.map.currents) { ctx.strokeStyle = 'rgba(96,240,255,.08)'; ctx.lineWidth = 2 / k; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, E.TAU); ctx.stroke(); }
      for (const r of s.pools) {
        if (R.fogActive && !R.explore(r.x, r.y)) continue;
        ctx.fillStyle = r.kind === 'spore' ? 'rgba(255,224,102,.75)' : 'rgba(160,250,255,.6)';
        ctx.beginPath(); ctx.arc(r.x, r.y, (r.great ? 70 : 42) * (0.5 + 0.5 * r.amt / r.max), 0, E.TAU); ctx.fill();
      }
      for (const kk of s.pickups) if (R.seen(kk.x, kk.y)) { ctx.fillStyle = E.POWERUPS[kk.k].color; ctx.fillRect(kk.x - 40, kk.y - 40, 80, 80); }
      for (const b of s.structs) {
        if (b.o !== R.local && R.fogActive && !R.explore(b.x, b.y)) continue;
        const cult = E.CULTURES[s.players[b.o].culture];
        ctx.fillStyle = cult.hex[1];
        const sz = b.kind === 'nucleus' ? 150 : b.kind === 'bud' ? 110 : 70;
        ctx.fillRect(b.x - sz / 2, b.y - sz / 2, sz, sz);
        if (b.o === R.local) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 20; ctx.strokeRect(b.x - sz / 2, b.y - sz / 2, sz, sz); }
      }
      const dot = Math.max(28, 2.2 / k);
      for (const u of s.units) {
        const own = R.local >= 0 && !view.isEnemy(R.local, u.o);
        if (!own && (!R.seen(u.x, u.y) || view.isStealthed(u))) continue;
        ctx.fillStyle = E.CULTURES[s.players[u.o].culture].hex[own ? 0 : 1];
        ctx.fillRect(u.x - dot / 2, u.y - dot / 2, dot, dot);
      }
      if (R.fogActive) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        const cs = 64;
        for (let cy = 0; cy < R.rows; cy++) for (let cx = 0; cx < R.cols; cx++) {
          const i = cy * R.cols + cx;
          if (!R.explored[i]) { ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(cx * cs, cy * cs, cs + 1, cs + 1); }
          else if (!R.visGrid[i]) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(cx * cs, cy * cs, cs + 1, cs + 1); }
        }
      }
      const now = performance.now() / 1000;
      for (const a of alerts || []) {
        const age = now - a.t; if (age > 5) continue;
        ctx.strokeStyle = `rgba(255,90,90,${1 - age / 5})`; ctx.lineWidth = 30; ctx.beginPath(); ctx.arc(a.x, a.y, 200 + (age % 1) * 300, 0, E.TAU); ctx.stroke();
      }
      const v0 = R.s2w(0, 0), v1 = R.s2w(R.W, R.H);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5 / k;
      ctx.strokeRect(v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  E.Minimap = Minimap;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
