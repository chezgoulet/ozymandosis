// SPDX-License-Identifier: AGPL-3.0-only
// Minimap with cached layers:
//   terrain — currents + pool positions, redrawn every 2 s (pools drift slowly)
//   fog     — one ImageData pixel per fog cell, rebuilt only when vision changes
//   dynamic — structures, creatures, pickups, alerts, camera frame (every 150 ms)
// Culture shapes, not just colours, mark structures (colour-blind safe).
(function (E) {
  'use strict';
  class Minimap {
    constructor(canvas, renderer) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.r = renderer; this.t = 0;
      this.terrain = document.createElement('canvas'); this.fogCv = document.createElement('canvas');
      this.terrainT = 0; this.fogVer = -1;
    }
    resize() {
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = r.width; this.h = r.height; this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr); this.dpr = dpr;
      this.terrainT = 0;
    }
    fit(view) { const m = view.s.map, k = Math.min(this.w / m.w, this.h / m.h); return { k, ox: (this.w - m.w * k) / 2, oy: (this.h - m.h * k) / 2 }; }
    toWorld(view, sx, sy) { const f = this.fit(view); return { x: (sx - f.ox) / f.k, y: (sy - f.oy) / f.k }; }
    drawTerrain(view, f) {
      const s = view.s, c = this.terrain, R = this.r;
      c.width = Math.max(1, Math.round(s.map.w * f.k * this.dpr)); c.height = Math.max(1, Math.round(s.map.h * f.k * this.dpr));
      const x = c.getContext('2d'), k = f.k * this.dpr;
      x.setTransform(k, 0, 0, k, 0, 0);
      x.fillStyle = 'rgba(3,12,16,.95)'; x.fillRect(0, 0, s.map.w, s.map.h);
      for (const cu of s.map.currents) { x.strokeStyle = 'rgba(96,240,255,.1)'; x.lineWidth = 2 / f.k; x.beginPath(); x.arc(cu.x, cu.y, cu.r, 0, E.TAU); x.stroke(); }
      for (const r of s.pools) {
        if (R.fogActive && !R.explore(r.x, r.y)) continue;
        x.fillStyle = r.kind === 'spore' ? 'rgba(255,224,102,.8)' : 'rgba(160,250,255,.6)';
        x.beginPath(); x.arc(r.x, r.y, (r.great ? 70 : 42) * (0.5 + 0.5 * r.amt / r.max), 0, E.TAU); x.fill();
      }
    }
    drawFog() {
      const R = this.r, c = this.fogCv;
      if (c.width !== R.cols || c.height !== R.rows) { c.width = R.cols; c.height = R.rows; this.img = c.getContext('2d').createImageData(R.cols, R.rows); }
      const d = this.img.data, ex = R.explored, g = R.visGrid;
      for (let i = 0, n = ex.length; i < n; i++) { d[i * 4 + 3] = !ex[i] ? 220 : !g[i] ? 100 : 0; }
      c.getContext('2d').putImageData(this.img, 0, 0);
      this.fogVer = R.visVer;
    }
    draw(view, dt, alerts) {
      if (!this.w) this.resize();
      this.t -= dt; this.terrainT -= dt;
      if (this.t > 0) return; this.t = 0.15;
      const ctx = this.ctx, s = view.s, R = this.r, f = this.fit(view), k = f.k;
      if (this.terrainT <= 0) { this.drawTerrain(view, f); this.terrainT = 2; }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.drawImage(this.terrain, f.ox, f.oy, s.map.w * k, s.map.h * k);
      ctx.save(); ctx.translate(f.ox, f.oy); ctx.scale(k, k);
      for (const kk of s.pickups) if (R.seen(kk.x, kk.y)) { ctx.fillStyle = E.POWERUPS[kk.k].color; ctx.fillRect(kk.x - 40, kk.y - 40, 80, 80); }
      for (const b of s.structs) {
        if (b.o !== R.local && R.fogActive && !R.explore(b.x, b.y)) continue;
        const cult = E.CULTURES[s.players[b.o].culture], sz = b.kind === 'nucleus' ? 170 : b.kind === 'bud' ? 120 : 80;
        ctx.save(); ctx.translate(b.x, b.y);
        E.shapePath(ctx, E.SHAPES[cult.idx], sz / 2);
        ctx.fillStyle = cult.hex[1]; ctx.fill();
        ctx.lineWidth = b.o === R.local ? 26 : 14; ctx.strokeStyle = b.o === R.local ? '#fff' : 'rgba(0,0,0,.7)'; ctx.stroke();
        ctx.restore();
      }
      const dot = Math.max(28, 2.2 / k);
      for (const u of s.units) {
        const own = R.local >= 0 && !view.isEnemy(R.local, u.o);
        if (!own && (!R.seen(u.x, u.y) || view.isStealthed(u))) continue;
        ctx.fillStyle = E.CULTURES[s.players[u.o].culture].hex[own ? 0 : 1];
        ctx.fillRect(u.x - dot / 2, u.y - dot / 2, dot, dot);
      }
      ctx.restore();
      if (R.fogActive) {
        if (this.fogVer !== R.visVer) this.drawFog();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.fogCv, f.ox, f.oy, R.cols * R.cell * k, R.rows * R.cell * k);
      }
      ctx.save(); ctx.translate(f.ox, f.oy); ctx.scale(k, k);
      const now = performance.now() / 1000;
      for (const a of alerts || []) {
        const age = now - a.t; if (age > 5) continue;
        ctx.strokeStyle = `rgba(255,90,90,${1 - age / 5})`; ctx.lineWidth = 30; ctx.beginPath(); ctx.arc(a.x, a.y, 200 + (age % 1) * 300, 0, E.TAU); ctx.stroke();
      }
      const v0 = R.s2w(0, 0), v1 = R.s2w(R.W, R.H);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5 / k;
      ctx.strokeRect(v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
      ctx.restore();
    }
  }
  E.Minimap = Minimap;
})(window.E);
