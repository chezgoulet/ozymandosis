// SPDX-License-Identifier: AGPL-3.0-only
// Backend-independent renderer core: camera, vision grid, fog memory, event
// effects, damage numbers. Canvas2D and three.js backends both extend this.
(function (E) {
  'use strict';
  const CELL = 32;
  E.FOG_CELL = CELL;
  class RenderCore {
    constructor(canvas) {
      this.cv = canvas;
      this.cam = { x: 0, y: 0, z: 1 };
      this.vis = new Map(); this.corpses = []; this.fx = []; this.texts = [];
      this.quality = 'high'; this.W = 1; this.H = 1; this.dpr = 1; this.cell = CELL;
      this.hpSeen = new Map();
      this.gore = new E.Gore();
    }
    reset(view, local) {
      this.vis.clear(); this.corpses = []; this.fx = []; this.texts = []; this.hpSeen = new Map(); this.gore.clear(); this.structHp = new Map();
      const m = view.s.map;
      this.cols = Math.ceil(m.w / CELL); this.rows = Math.ceil(m.h / CELL);
      this.explored = new Uint8Array(this.cols * this.rows);
      this.visGrid = new Uint8Array(this.cols * this.rows);
      // soft channels (0..255) for display only: vision falls off over ~2 cells
      this.visSoft = new Uint8Array(this.cols * this.rows); this.expSoft = new Uint8Array(this.cols * this.rows);
      this.visT = 0; this.local = local; this.visVer = 0;
    }
    fogOn(view) { return view.s.cfg.map.fog && this.local >= 0 && view.s.players[this.local] && view.s.players[this.local].alive && !(view.s.players[this.local].echoT > 0); }
    updateVision(view) {
      const g = this.visGrid; g.fill(0); this.visVer++;
      const vs = this.visSoft, es = this.expSoft; vs.fill(0);
      if (this.local < 0) { this.sources = []; return; }
      const src = view.visionSources(this.local);
      const cols = this.cols, rows = this.rows, ex = this.explored;
      for (const s of src) {
        const r = s.r, c0 = Math.max(0, Math.floor((s.x - r) / CELL)), c1 = Math.min(cols - 1, Math.floor((s.x + r) / CELL));
        const r0 = Math.max(0, Math.floor((s.y - r) / CELL)), r1 = Math.min(rows - 1, Math.floor((s.y + r) / CELL));
        const rr = r * r, fall = CELL * 2.2;
        for (let cy = r0; cy <= r1; cy++) {
          const dy = (cy + 0.5) * CELL - s.y, dy2 = dy * dy, row = cy * cols;
          for (let cx = c0; cx <= c1; cx++) {
            const dx = (cx + 0.5) * CELL - s.x, d2 = dx * dx + dy2;
            if (d2 <= rr) {
              g[row + cx] = 1; ex[row + cx] = 1;
              const k = Math.min(255, ((r - Math.sqrt(d2)) / fall) * 255 + 40) | 0;
              if (k > vs[row + cx]) vs[row + cx] = k;
              if (k > es[row + cx]) es[row + cx] = k;
            }
          }
        }
      }
      this.sources = src;
    }
    s2w(sx, sy) { return { x: (sx - this.W / 2) / this.cam.z + this.cam.x, y: (sy - this.H / 2) / this.cam.z + this.cam.y }; }
    w2s(x, y) { return { x: (x - this.cam.x) * this.cam.z + this.W / 2, y: (y - this.cam.y) * this.cam.z + this.H / 2 }; }
    clampCam(view) {
      const m = view.s.map, c = this.cam;
      const minZ = Math.max(0.12, Math.min(this.W / (m.w + 600), this.H / (m.h + 600)));
      c.z = E.clamp(c.z, minZ, 2.4);
      const hw = this.W / 2 / c.z, hh = this.H / 2 / c.z;
      c.x = m.w + 300 < hw * 2 ? m.w / 2 : E.clamp(c.x, hw - 300, m.w + 300 - hw);
      c.y = m.h + 300 < hh * 2 ? m.h / 2 : E.clamp(c.y, hh - 300, m.h + 300 - hh);
    }
    seen(x, y) {
      if (!this.fogActive) return true;
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
      return this.visGrid[cy * this.cols + cx] === 1;
    }
    explore(x, y) { const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && this.explored[cy * this.cols + cx] === 1; }

    // ── events → fx ─────────────────────────────────────────────
    consume(view, events) {
      const t = this.t || 0;
      for (const ev of events) {
        const vis = ev.x === undefined || this.seen(ev.x, ev.y);
        const p = ev.o !== undefined ? view.s.players[ev.o] : null;
        const cult = p ? E.CULTURES[p.culture] : null;
        const c0 = cult ? cult.colors[0] : E.WHITE, c1 = cult ? cult.colors[1] : E.WHITE;
        if (!vis) { if (ev.e === 'die') this.vis.delete(ev.id); continue; }
        switch (ev.e) {
          case 'hatch': this.burst(ev.x, ev.y, c0, 50, 0.9); break;
          case 'die': {
            const v = this.vis.get(ev.id);
            if (v && v.last) this.corpses.push({ v, pts: v.last.pts, o: v.last.o, t0: t });
            this.vis.delete(ev.id);
            if (!ev.withered) this.burst(ev.x, ev.y, c1, 46, 0.8); break;
          }
          case 'hit': this.burst(ev.x, ev.y, c1, 18, 0.35, 0.5); break;
          case 'ability': { const a = E.ABILITIES[ev.id]; this.ring(ev.x, ev.y, E.hex(a.color), 60, 0.7); if (ev.id === 'dazzle') this.burst(ev.x, ev.y, E.WHITE, 130, 1.2, 0.6); break; }
          case 'flash': this.burst(ev.x, ev.y, E.WHITE, ev.r * 1.2, 1.3, 0.5); break;
          case 'ring': this.ring(ev.x, ev.y, c1, ev.r, 0.8); break;
          case 'heal': this.ring(ev.x, ev.y, { r: 160, g: 255, b: 190 }, ev.r, 0.8); this.burst(ev.x, ev.y, { r: 160, g: 255, b: 190 }, ev.r * 0.6, 0.5); break;
          case 'pickup': { const pu = E.POWERUPS[ev.k]; this.burst(ev.x, ev.y, E.hex(pu.color), 80, 1.1); if (ev.o === this.local) this.text(ev.x, ev.y - 20, pu.name, pu.color); break; }
          case 'built': case 'plant': this.ring(ev.x, ev.y, c1, 90, 1.2); this.burst(ev.x, ev.y, c0, 70, 1); break;
          case 'destroy': this.burst(ev.x, ev.y, c1, 220, 1.8, 1.2); this.ring(ev.x, ev.y, c1, 240, 1.6); break;
          case 'convert': this.burst(ev.x, ev.y, c1, 70, 1.2); this.ring(ev.x, ev.y, c1, 50, 0.9); break;
          case 'rank': this.text(ev.x, ev.y - 16, '▲'.repeat(ev.rank), '#ffe066'); break;
          case 'spire': {
            this.burst(ev.x, ev.y, c1, 24, 0.4);
            const b = view.s.structs.find(s => s.x === ev.x && s.y === ev.y), sv = b && this.structVis && this.structVis.get(b.id);
            if (sv) sv.fireT = t;
            break;
          }
          case 'apex': this.burst(ev.x, ev.y, c1, 260, 2, 1); this.ring(ev.x, ev.y, c1, 300, 2); break;
          case 'deposit': if (ev.o === this.local && this.quality !== 'low') this.burst(ev.x, ev.y, { r: 200, g: 255, b: 255 }, 22, 0.3, 0.5); break;
          case 'cloud': if (ev.kind === 'flare') this.burst(ev.x, ev.y, { r: 255, g: 243, b: 160 }, ev.r, 1.4, 0.7); break;
        }
      }
    }
    burst(x, y, c, r, dur, hot) { if (this.fx.length >= 400) this.fx.shift(); this.fx.push({ k: 'burst', x, y, c, r, dur, hot: hot || 1, t0: this.t || 0 }); }
    ring(x, y, c, r, dur) { if (this.fx.length >= 400) this.fx.shift(); this.fx.push({ k: 'ring', x, y, c, r, dur, t0: this.t || 0 }); }
    text(x, y, s, color) { if (this.texts.length >= 80) this.texts.shift(); this.texts.push({ x, y, s, color, t0: this.t || 0 }); }

    // Floating damage numbers from observed hp loss (works for hosts and network guests alike).
    trackDamage(view, dt) {
      const seen = this.hpSeen;
      this.dmgT = (this.dmgT || 0) - dt;
      const emit = this.dmgT <= 0; if (emit) this.dmgT = 0.35;
      for (const u of view.s.units) {
        let h = seen.get(u.id);
        if (!h) { seen.set(u.id, { hp: u.hp, acc: 0, heal: 0, gen: this.visVer }); continue; }
        const d = h.hp - u.hp; h.hp = u.hp; h.gen = this.visVer;
        if (d > 0) h.acc += d; else if (d < -0.5) h.heal -= d;
        // residue on every visible wound, in the creature's own colours
        if (d > 0.3 && this.seen(u.x, u.y) && (!this.inView || this.inView(u.x, u.y, 40))) {
          const pl = view.s.players[u.o], cult = pl && E.CULTURES[pl.culture];
          if (cult) this.gore.spray(u.x, u.y, E.residueColors(cult), Math.min(1, d / Math.max(1, view.stats(u).hp) * 3), null);
        }
        if (emit && (h.acc >= 1 || h.heal >= 4) && this.seen(u.x, u.y) && (!this.inView || this.inView(u.x, u.y, 0))) {
          if (h.acc >= 1) this.texts.push({ x: u.x + (Math.random() - 0.5) * 10, y: u.y - 10, s: String(Math.round(h.acc)), color: u.o === this.local ? '#ff8a8a' : '#fff3c4', t0: this.t || 0, dmg: 1, size: Math.min(1.6, 0.8 + h.acc / 40) });
          if (h.heal >= 4) this.texts.push({ x: u.x, y: u.y - 16, s: '+' + Math.round(h.heal), color: '#9fffc0', t0: this.t || 0, dmg: 1, size: 0.9 });
          h.acc = 0; h.heal = 0;
        }
      }
      // structures weep residue from the rim when struck
      const sh = this.structHp || (this.structHp = new Map());
      for (const b of view.s.structs) {
        const prev = sh.get(b.id); sh.set(b.id, b.hp);
        if (prev === undefined || prev - b.hp < 2 || !this.seen(b.x, b.y) || b.build < 1) continue;
        const pl = view.s.players[b.o], cult = pl && E.CULTURES[pl.culture]; if (!cult) continue;
        const a = Math.random() * E.TAU, R = E.STRUCTS[b.kind].r;
        this.gore.spray(b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, E.residueColors(cult), Math.min(0.6, (prev - b.hp) / E.STRUCTS[b.kind].hp * 40), a);
      }
      if (emit && seen.size > view.s.units.length + 200) for (const [id, h] of seen) if (!view.byId.get(id)) seen.delete(id);
      if (this.texts.length > 80) this.texts.splice(0, this.texts.length - 80);
    }
  }
  E.RenderCore = RenderCore;
})(window.E);
