// World renderer: camera, layers, fog of war, effects, overlays.
(function (E) {
  'use strict';
  const TAU = E.TAU;
  const FOG_CELL = 64;

  class Renderer {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, z: 1 };
      this.vis = new Map(); this.corpses = []; this.fx = []; this.texts = []; this.streaks = [];
      this.fogCv = document.createElement('canvas'); this.fogCtx = this.fogCv.getContext('2d');
      this.hole = this.makeHole();
      this.quality = 'high';
      this.dust = [];
      const r = E.RNG(211);
      for (let i = 0; i < 90; i++) this.dust.push({ x: r.next(), y: r.next(), d: r.next(), ph: r.next() * TAU, sz: 0.6 + r.next() * 1.4 });
      this.W = 1; this.H = 1; this.dpr = 1;
    }
    makeHole() {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.7, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
    }
    resize() {
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(this.quality === 'low' ? 1 : 2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.dpr = dpr;
      const w = Math.round(this.W * dpr), h = Math.round(this.H * dpr);
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      this.fogCv.width = Math.ceil(this.W / 4); this.fogCv.height = Math.ceil(this.H / 4);
    }
    reset(view, local) {
      this.vis.clear(); this.corpses = []; this.fx = []; this.texts = []; this.streaks = [];
      const m = view.s.map;
      this.cols = Math.ceil(m.w / FOG_CELL); this.rows = Math.ceil(m.h / FOG_CELL);
      this.explored = new Uint8Array(this.cols * this.rows);
      this.visGrid = new Uint8Array(this.cols * this.rows);
      this.visT = 0; this.local = local;
      this.expCv = document.createElement('canvas'); this.expCv.width = Math.ceil(m.w / 16); this.expCv.height = Math.ceil(m.h / 16);
      this.expCtx = this.expCv.getContext('2d');
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
    // ── fog ─────────────────────────────────────────────────────
    fogOn(view) { return view.s.cfg.map.fog && this.local >= 0 && view.s.players[this.local] && view.s.players[this.local].alive && !(view.s.players[this.local].echoT > 0); }
    updateVision(view) {
      const g = this.visGrid; g.fill(0);
      if (this.local < 0) return;
      const src = view.visionSources(this.local);
      const cols = this.cols, rows = this.rows;
      for (const s of src) {
        const r = s.r, c0 = Math.max(0, Math.floor((s.x - r) / FOG_CELL)), c1 = Math.min(cols - 1, Math.floor((s.x + r) / FOG_CELL));
        const r0 = Math.max(0, Math.floor((s.y - r) / FOG_CELL)), r1 = Math.min(rows - 1, Math.floor((s.y + r) / FOG_CELL));
        const rr = r * r;
        for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
          const dx = (cx + 0.5) * FOG_CELL - s.x, dy = (cy + 0.5) * FOG_CELL - s.y;
          if (dx * dx + dy * dy <= rr) { g[cy * cols + cx] = 1; this.explored[cy * cols + cx] = 1; }
        }
      }
      this.sources = src;
      const ec = this.expCtx;
      for (const s of src) { const r = s.r / 16; ec.drawImage(this.hole, s.x / 16 - r, s.y / 16 - r, r * 2, r * 2); }
    }
    seen(x, y) {
      if (!this.fogActive) return true;
      const cx = Math.floor(x / FOG_CELL), cy = Math.floor(y / FOG_CELL);
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
      return this.visGrid[cy * this.cols + cx] === 1;
    }
    explore(x, y) { const cx = Math.floor(x / FOG_CELL), cy = Math.floor(y / FOG_CELL); return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && this.explored[cy * this.cols + cx] === 1; }

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
          case 'spire': this.burst(ev.x, ev.y, c1, 24, 0.4); break;
          case 'apex': this.burst(ev.x, ev.y, c1, 260, 2, 1); this.ring(ev.x, ev.y, c1, 300, 2); break;
          case 'deposit': if (ev.o === this.local && this.quality !== 'low') this.burst(ev.x, ev.y, { r: 200, g: 255, b: 255 }, 22, 0.3, 0.5); break;
          case 'cloud': if (ev.kind === 'flare') this.burst(ev.x, ev.y, { r: 255, g: 243, b: 160 }, ev.r, 1.4, 0.7); break;
        }
      }
    }
    burst(x, y, c, r, dur, hot) { this.fx.push({ k: 'burst', x, y, c, r, dur, hot: hot || 1, t0: this.t || 0 }); }
    ring(x, y, c, r, dur) { this.fx.push({ k: 'ring', x, y, c, r, dur, t0: this.t || 0 }); }
    text(x, y, s, color) { this.texts.push({ x, y, s, color, t0: this.t || 0 }); }

    // ── frame ───────────────────────────────────────────────────
    frame(view, alpha, t, dt, ui) {
      this.t = t;
      E.LOWQ = this.quality === 'low';
      const ctx = this.ctx, s = view.s, cam = this.cam, W = this.W, H = this.H, z = cam.z;
      const local = this.local, lp = local >= 0 ? s.players[local] : null;
      this.fogActive = this.fogOn(view);
      this.visT -= dt;
      if (this.visT <= 0) { this.updateVision(view); this.visT = 0.1; }
      const pals = s.players.map(p => E.playerPalette(view, p));
      const pal = lp ? pals[local] : E.palette(E.CULTURE_LIST[0], 0.3, 0, 100, false);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // background (screen space)
      const rMax = Math.hypot(W, H), g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, rMax * 0.8);
      g.addColorStop(0, E.rgba(pal.bgCenter, 1)); g.addColorStop(0.5, E.rgba(pal.bg, 1)); g.addColorStop(1, 'rgb(0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sf = ctx.createLinearGradient(0, 0, 0, H * 0.35);
      sf.addColorStop(0, E.rgba(E.mix(pal.primary, { r: 130, g: 255, b: 240 }, 0.3), 0.03 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.7))));
      sf.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sf; ctx.fillRect(0, 0, W, H * 0.35);
      // parallax dust
      for (const d of this.dust) {
        const par = 0.15 + d.d * 0.45;
        const x = ((d.x * W * 2 - cam.x * z * par + Math.sin(t * 0.1 + d.ph) * 20) % W + W) % W;
        const y = ((d.y * H * 2 - cam.y * z * par + Math.sin(t * 0.08 + d.ph) * 16) % H + H) % H;
        ctx.fillStyle = E.rgba(pal.primary, 0.12 + 0.25 * (1 - d.d)); ctx.beginPath(); ctx.arc(x, y, d.sz, 0, TAU); ctx.fill();
      }
      // world space
      ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (W / 2 - cam.x * z), this.dpr * (H / 2 - cam.y * z));
      const view0 = this.s2w(-80, -80), view1 = this.s2w(W + 80, H + 80);
      const inView = (x, y, m) => x > view0.x - (m || 0) && x < view1.x + (m || 0) && y > view0.y - (m || 0) && y < view1.y + (m || 0);
      this.inView = inView;
      // map edge
      ctx.strokeStyle = E.rgba(pal.primary, 0.08); ctx.lineWidth = 2 / z; ctx.setLineDash([12 / z, 18 / z]);
      ctx.strokeRect(0, 0, s.map.w, s.map.h); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-4000, -4000, s.map.w + 8000, 4000); ctx.fillRect(-4000, s.map.h, s.map.w + 8000, 4000);
      ctx.fillRect(-4000, 0, 4000, s.map.h); ctx.fillRect(s.map.w, 0, 4000, s.map.h);
      this.drawCurrents(ctx, view, dt, inView, pal);
      this.drawPools(ctx, view, t, inView);
      this.drawVents(ctx, view, t, inView);
      this.drawClouds(ctx, view, t, inView);
      for (const b of s.structs) if (inView(b.x, b.y, 120) && (b.o === local || !this.fogActive || this.explore(b.x, b.y))) this.drawStruct(ctx, view, b, pals[b.o], t, ui);
      this.drawUnits(ctx, view, alpha, t, dt, pals, inView, ui);
      this.drawShots(ctx, view, alpha, t, pals);
      this.drawFx(ctx, t);
      // fog
      if (this.fogActive) this.drawFog(ctx, view);
      else ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (W / 2 - cam.x * z), this.dpr * (H / 2 - cam.y * z));
      this.drawOverlays(ctx, view, t, ui, pals);
      // screen-space tints
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (pal.blighted) { ctx.fillStyle = E.rgba({ r: 255, g: 70, b: 70 }, 0.03 + 0.05 * (0.5 + 0.5 * Math.sin(t * 3))); ctx.fillRect(0, 0, W, H); }
      if (ui && ui.box) {
        const b = ui.box; ctx.fillStyle = 'rgba(96,240,255,.07)'; ctx.strokeStyle = 'rgba(96,240,255,.7)'; ctx.lineWidth = 1;
        ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
      }
    }

    drawCurrents(ctx, view, dt, inView, pal) {
      const cur = view.s.map.currents; if (!cur.length) return;
      const v0 = this.s2w(0, 0), v1 = this.s2w(this.W, this.H);
      const want = this.quality === 'low' ? 80 : 220;
      while (this.streaks.length < want) this.streaks.push({ x: 0, y: 0, life: 0 });
      ctx.lineCap = 'round';
      for (const p of this.streaks) {
        p.life -= dt;
        if (p.life <= 0 || !inView(p.x, p.y, 40)) { p.x = v0.x + Math.random() * (v1.x - v0.x); p.y = v0.y + Math.random() * (v1.y - v0.y); p.life = 1 + Math.random() * 2; p.max = p.life; }
        const f = E.currentAt(cur, p.x, p.y), m = Math.hypot(f.x, f.y);
        if (m < 3) { p.life = 0; continue; }
        p.x += f.x * dt * 2.2; p.y += f.y * dt * 2.2;
        const a = Math.sin(Math.PI * (1 - p.life / p.max)) * Math.min(1, m / 30) * 0.22;
        ctx.strokeStyle = E.rgba(E.mix(pal.primary, E.WHITE, 0.4), a); ctx.lineWidth = 1.2 / this.cam.z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - f.x * 0.5, p.y - f.y * 0.5); ctx.stroke();
      }
    }
    drawPools(ctx, view, t, inView) {
      const lumen = { r: 0x9f, g: 0xf8, b: 0xff }, spore = { r: 0xff, g: 0xe0, b: 0x66 };
      for (const r of view.s.pools) {
        if (!inView(r.x, r.y, r.r * 2)) continue;
        if (this.fogActive && !this.explore(r.x, r.y)) continue;
        const fr = r.amt / r.max, rad = r.r * (0.5 + 0.5 * fr) * (1 + 0.08 * Math.sin(t * 0.4 + r.ph));
        const c = r.kind === 'spore' ? spore : lumen;
        E.drawGlow(ctx, r.x, r.y, rad * 1.9, c, 0.55 * (0.3 + 0.7 * fr), true);
        const motes = Math.round((r.kind === 'spore' ? 5 : 4) + 14 * fr);
        for (let i = 0; i < motes; i++) {
          const a = i / motes * TAU + t * (r.kind === 'spore' ? 0.6 : 0.25) * (i % 2 ? 1 : -1) + r.ph, rr = rad * (0.45 + 0.35 * Math.sin(t * 0.7 + i * 1.7));
          const x = r.x + Math.cos(a) * rr, y = r.y + Math.sin(a) * rr;
          ctx.fillStyle = E.rgba(r.kind === 'spore' ? spore : E.WHITE, 0.35 + 0.3 * Math.sin(t * 2 + i));
          ctx.beginPath(); ctx.arc(x, y, r.kind === 'spore' ? 1.6 : 1.1, 0, TAU); ctx.fill();
          if (r.kind === 'spore') { ctx.strokeStyle = E.rgba(spore, 0.15); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a + 1.57) * 6, y - Math.sin(a + 1.57) * 6); ctx.stroke(); }
        }
        ctx.strokeStyle = E.rgba(c, 0.08 + 0.06 * fr); ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawVents(ctx, view, t, inView) {
      for (const v of view.s.vents) {
        if (!inView(v.x, v.y, 60) || (this.fogActive && !this.explore(v.x, v.y))) continue;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(v.x, v.y, 18, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,190,120,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(v.x, v.y, 18, 0, TAU); ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const q = ((t * 0.4 + i / 5) % 1), bx = v.x + Math.sin(i * 2.3 + t) * 8, by = v.y - q * 40;
          ctx.fillStyle = `rgba(255,220,180,${0.35 * (1 - q)})`; ctx.beginPath(); ctx.arc(bx, by, 1.5 + q * 2, 0, TAU); ctx.fill();
        }
      }
      for (const k of view.s.pickups) {
        if (!inView(k.x, k.y, 60) || !this.seen(k.x, k.y)) continue;
        const pu = E.POWERUPS[k.k], c = E.hex(pu.color), bob = Math.sin(t * 2 + k.id) * 4;
        E.drawGlow(ctx, k.x, k.y + bob, 30, c, 0.7 + 0.2 * Math.sin(t * 3), true);
        ctx.strokeStyle = E.rgba(c, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(k.x, k.y + bob, 12, 0, TAU); ctx.stroke();
        ctx.fillStyle = E.rgba(E.mix(c, E.WHITE, 0.5), 0.95); ctx.font = '600 14px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(pu.glyph, k.x, k.y + bob + 1);
      }
    }
    drawClouds(ctx, view, t, inView) {
      for (const c of view.s.clouds) {
        if (!inView(c.x, c.y, c.r)) continue;
        const life = Math.min(1, c.t / 0.6, (c.dur - c.t + 0.3) / 0.5);
        if (c.kind === 'ink') {
          for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + t * 0.2, rr = c.r * 0.45; E.drawGlow(ctx, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, c.r * 0.8, { r: 20, g: 8, b: 40 }, 0.9 * life, true); }
          E.drawGlow(ctx, c.x, c.y, c.r, { r: 10, g: 4, b: 24 }, life, true);
        } else if (c.kind === 'venom') {
          E.drawGlow(ctx, c.x, c.y, c.r * 1.2, { r: 150, g: 255, b: 90 }, 0.35 * life, true);
          for (let i = 0; i < 10; i++) { const q = (t * 0.5 + i / 10) % 1, a = i * 2.39; ctx.fillStyle = `rgba(170,255,110,${0.4 * (1 - q) * life})`; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * c.r * 0.7 * q, c.y + Math.sin(a) * c.r * 0.7 * q, 2, 0, TAU); ctx.fill(); }
        } else if (c.kind === 'tide') {
          ctx.lineWidth = 2;
          for (let k = 0; k < 4; k++) { ctx.strokeStyle = `rgba(80,200,255,${0.22 * life})`; ctx.beginPath(); const a0 = t * 2 + k * 1.57; ctx.arc(c.x, c.y, c.r * (0.3 + k * 0.18), a0, a0 + 2.2); ctx.stroke(); }
          E.drawGlow(ctx, c.x, c.y, c.r, { r: 48, g: 184, b: 255 }, 0.2 * life, true);
        } else if (c.kind === 'bloom') {
          E.drawGlow(ctx, c.x, c.y, c.r, { r: 160, g: 255, b: 190 }, 0.25 * life, true);
          for (let i = 0; i < 16; i++) { const q = (t * 0.6 + i / 16) % 1, a = i * 2.39; ctx.fillStyle = `rgba(255,240,150,${0.6 * (1 - q) * life})`; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * c.r * 0.8 * (i / 16), c.y + Math.sin(a) * c.r * 0.8 * (i / 16) - q * 30, 1.6, 0, TAU); ctx.fill(); }
        } else if (c.kind === 'flare') {
          E.drawGlow(ctx, c.x, c.y, c.r * 0.5, { r: 255, g: 243, b: 160 }, 0.25 * life, true);
          ctx.strokeStyle = `rgba(255,243,160,${0.15 * life})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
        }
      }
    }
    drawStruct(ctx, view, b, pal, t, ui) {
      const p = view.s.players[b.o], cult = E.CULTURES[p.culture], [c0, c1] = cult.colors, sd = E.STRUCTS[b.kind];
      const vis = b.o === this.local || this.seen(b.x, b.y);
      const R = sd.r, beat = 0.5 + 0.5 * Math.sin(t * (1.4 + p.energy * 3 + p.fever * 4) + b.id);
      const ga = ctx.globalAlpha; ctx.globalAlpha = ga * (b.build < 1 ? 0.35 + b.build * 0.5 : 1) * (vis ? 1 : 0.55);
      E.drawGlow(ctx, b.x, b.y, R * 3.4, pal.accent, 0.35 + 0.15 * beat, true);
      if (b.kind === 'spire') {
        for (let k = 0; k < 3; k++) { ctx.strokeStyle = E.rgba(c1, 0.25 + k * 0.15); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(b.x, b.y, R * (1.4 - k * 0.35), 0, TAU); ctx.stroke(); }
        const n = 6 + cult.idx;
        for (let k = 0; k < n; k++) {
          const a = k / n * TAU + t * 0.4; ctx.strokeStyle = E.rgba(E.mix(c1, E.WHITE, 0.3), 0.7); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * R * 0.6, b.y + Math.sin(a) * R * 0.6); ctx.lineTo(b.x + Math.cos(a + 0.2) * R * 1.8, b.y + Math.sin(a + 0.2) * R * 1.8); ctx.stroke();
        }
        E.drawGlow(ctx, b.x, b.y, R * 1.2, pal.accent, 0.9);
      } else {
        const petals = (b.kind === 'bud' ? 3 : 5) + cult.idx;
        for (let k = 0; k < petals; k++) {
          const a = k / petals * TAU + t * 0.12 * (b.id % 2 ? 1 : -1), L = R * (1.25 + 0.1 * Math.sin(t * 1.8 + k)) * (0.96 + 0.08 * beat), w = 0.42;
          ctx.beginPath(); ctx.moveTo(b.x, b.y);
          ctx.quadraticCurveTo(b.x + Math.cos(a - w) * L * 0.8, b.y + Math.sin(a - w) * L * 0.8, b.x + Math.cos(a) * L, b.y + Math.sin(a) * L);
          ctx.quadraticCurveTo(b.x + Math.cos(a + w) * L * 0.8, b.y + Math.sin(a + w) * L * 0.8, b.x, b.y);
          ctx.fillStyle = E.rgba(E.mix(c0, pal.primary, 0.5), 0.14); ctx.fill();
          ctx.strokeStyle = E.rgba(E.mix(c1, pal.accent, 0.5), 0.5); ctx.lineWidth = 1; ctx.stroke();
        }
        E.drawGlow(ctx, b.x, b.y, R * 0.9 * (0.9 + 0.15 * beat), pal.accent, 0.95);
      }
      // lance
      if (b.lance && sd.lance && vis) {
        const tg = view.byId.get(b.lance);
        if (tg) { ctx.strokeStyle = E.rgba(pal.accent, 0.4 + 0.25 * Math.sin(t * 30)); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.quadraticCurveTo((b.x + tg.x) / 2 + Math.sin(t * 17) * 8, (b.y + tg.y) / 2 + Math.cos(t * 13) * 8, tg.x, tg.y); ctx.stroke(); }
      }
      ctx.globalAlpha = ga;
      const hpF = b.hp / sd.hp, sel = ui && ui.selection && ui.selection.has(b.id);
      if (b.build < 1) {
        ctx.strokeStyle = E.rgba(c1, 0.8); ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.6, -Math.PI / 2, -Math.PI / 2 + TAU * b.build); ctx.stroke(); ctx.setLineDash([]);
      } else if (hpF < 0.999 || sel) {
        ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.6, 0, TAU); ctx.stroke();
        ctx.strokeStyle = E.rgba(hpF < 0.35 ? E.RED : pal.accent, 0.85); ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.6, -Math.PI / 2, -Math.PI / 2 + TAU * hpF); ctx.stroke();
      }
      const q = b.queue[0];
      if (q && b.o === this.local) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.95, -Math.PI / 2, -Math.PI / 2 + TAU * E.clamp(q.t / q.dur, 0, 1)); ctx.stroke(); }
      if (sel) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.rally.x, b.rally.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = E.rgba(c1, 0.9); ctx.beginPath(); ctx.arc(b.rally.x, b.rally.y, 6, 0, TAU); ctx.stroke();
      }
    }
    drawUnits(ctx, view, alpha, t, dt, pals, inView, ui) {
      const s = view.s, z = this.cam.z, local = this.local;
      let lod = z >= 0.62 ? 0 : z >= 0.3 ? 1 : 2;
      if (this.quality === 'low') lod = Math.min(2, lod + 1);
      const sel = ui && ui.selection;
      const drawn = [];
      for (const u of s.units) {
        const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
        const own = local >= 0 && !view.isEnemy(local, u.o);
        let v = this.vis.get(u.id);
        const st = view.stats(u), design = view.designOf(u.o, u.d);
        if (!inView(x, y, 400)) { if (v) v.stale = true; continue; }
        if (!v) { v = E.makeVis(x, y, u.a, (E.CHASSIS[design.chassis] || E.CHASSIS.serpent).bodyLen * st.size, u.id); this.vis.set(u.id, v); }
        if (v.stale) { for (const q of v.trail) { q.x = x - Math.cos(u.a) * 2; q.y = y - Math.sin(u.a) * 2; } v.stale = false; }
        E.advanceVis(v, x, y, dt);
        if (!inView(x, y, 120)) continue;
        if (!own && !this.seen(x, y)) continue;
        const stealth = view.isStealthed(u);
        if (!own && stealth) continue;
        const p = s.players[u.o], cpal = pals[u.o], cult = E.CULTURES[p.culture];
        const pts = E.buildPts(v, x, y, t, st.size);
        const hc = E.creatureColor(cult, cpal, v.indiv, v.phase, t);
        const hpF = E.clamp(u.hp / st.hp, 0, 1);
        const o = { design, tier: p.tier, hc, pal: cpal, t, lod, size: st.size, elite: u.elite,
          alpha: u.fade * E.lerp(0.35, 0.95, hpF) * (1 - cpal.starve * 0.3) * (stealth ? 0.35 : 1),
          activity: u.engaged ? 1.3 : 1, flicker: cpal.panic > 0 ? 0.7 + 0.3 * Math.sin(t * 12 + v.phase * 3) : 1 };
        v.last = { pts, o };
        E.drawCreature(ctx, v, pts, o);
        if (u.cargo > 0 && lod < 2) E.drawGlow(ctx, pts[4].x, pts[4].y, 4 + 7 * u.cargo / Math.max(1, st.cargo), u.ct === 's' ? { r: 255, g: 224, b: 102 } : { r: 200, g: 255, b: 255 }, 0.9);
        if (u.buffs && u.buffs.length && lod < 2) this.drawBuffs(ctx, u, x, y, t, st.size);
        drawn.push({ u, x, y, st, own, hpF, cpal });
      }
      // overlays per unit: selection, hp, rank
      for (const d of drawn) {
        const { u, x, y, st, hpF, cpal } = d, r = 10 + st.size * 4;
        const isSel = sel && sel.has(u.id);
        if (isSel) {
          ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1 / Math.min(1, z); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          ctx.strokeStyle = E.rgba(hpF > 0.35 ? cpal.accent : E.RED, 0.95); ctx.lineWidth = 2 / Math.min(1, z);
          ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * hpF); ctx.stroke();
        } else if (hpF < 0.98 && z > 0.45 && ui && ui.showHp) {
          const w = 16 * st.size; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - w / 2, y - r - 5, w, 2.5);
          ctx.fillStyle = E.rgba(hpF > 0.35 ? cpal.accent : E.RED, 0.9); ctx.fillRect(x - w / 2, y - r - 5, w * hpF, 2.5);
        }
        if (u.rank && z > 0.5) { ctx.fillStyle = '#ffe066'; for (let k = 0; k < u.rank; k++) { ctx.beginPath(); ctx.arc(x - (u.rank - 1) * 2.5 + k * 5, y + r + 3, 1.4, 0, TAU); ctx.fill(); } }
      }
    }
    drawBuffs(ctx, u, x, y, t, size) {
      for (const b of u.buffs) {
        const k = b.k;
        if (k === 'stun') for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; E.drawGlow(ctx, x + Math.cos(a) * 10, y + Math.sin(a) * 10 - 6, 4, { r: 255, g: 243, b: 160 }, 0.9); }
        else if (k === 'harden') { ctx.strokeStyle = 'rgba(255,210,138,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = i / 6 * TAU; const px = x + Math.cos(a) * 14 * size, py = y + Math.sin(a) * 14 * size; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
        else if (k === 'song') { ctx.fillStyle = 'rgba(255,224,102,.7)'; ctx.font = '10px serif'; ctx.fillText('♪', x + Math.sin(t * 3 + u.id) * 8, y - 12 - (t * 20 + u.id) % 10); }
        else if (k === 'poison' || k === 'coat') E.drawGlow(ctx, x, y, 12 * size, { r: 150, g: 255, b: 90 }, 0.25);
        else if (k === 'haste') E.drawGlow(ctx, x, y, 10 * size, { r: 128, g: 208, b: 255 }, 0.25);
        else if (k === 'drain') { const src = null; E.drawGlow(ctx, x, y, 12, { r: 208, g: 144, b: 255 }, 0.35 + 0.2 * Math.sin(t * 8)); }
        else if (k === 'hot') E.drawGlow(ctx, x, y, 12 * size, { r: 160, g: 255, b: 190 }, 0.3);
      }
    }
    drawShots(ctx, view, alpha, t, pals) {
      for (const sh of view.s.shots) {
        if (!this.inView(sh.x, sh.y, 20) || !this.seen(sh.x, sh.y)) continue;
        const c = pals[sh.o] ? pals[sh.o].accent : E.WHITE;
        E.drawGlow(ctx, sh.x, sh.y, 7, c, 0.95);
        const m = Math.hypot(sh.vx, sh.vy) || 1;
        ctx.strokeStyle = E.rgba(c, 0.5); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - sh.vx / m * 12, sh.y - sh.vy / m * 12); ctx.stroke();
      }
    }
    drawFx(ctx, t) {
      this.corpses = this.corpses.filter(c => t - c.t0 < 1.6);
      for (const c of this.corpses) {
        if (!this.inView(c.pts[0].x, c.pts[0].y, 60)) continue;
        const o = Object.assign({}, c.o, { alpha: c.o.alpha * 0.6 * (1 - (t - c.t0) / 1.6), t });
        E.drawCreature(ctx, c.v, c.pts, o);
      }
      this.fx = this.fx.filter(f => t - f.t0 < f.dur);
      for (const f of this.fx) {
        if (!this.inView(f.x, f.y, f.r)) continue;
        const a = (t - f.t0) / f.dur;
        if (f.k === 'burst') E.drawGlow(ctx, f.x, f.y, E.lerp(f.r * 0.2, f.r, a), f.c, (1 - a) * 0.9 * f.hot, true);
        else { ctx.strokeStyle = E.rgba(f.c, (1 - a) * 0.7); ctx.lineWidth = 2 * (1 - a) + 0.5; ctx.beginPath(); ctx.arc(f.x, f.y, E.lerp(f.r * 0.3, f.r, Math.sqrt(a)), 0, TAU); ctx.stroke(); }
      }
      this.texts = this.texts.filter(x => t - x.t0 < 1.8);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const x of this.texts) {
        const a = (t - x.t0) / 1.8;
        ctx.globalAlpha = 1 - a; ctx.fillStyle = x.color; ctx.font = `600 ${Math.round(13 / Math.max(0.6, this.cam.z))}px Figtree, system-ui, sans-serif`;
        ctx.fillText(x.s, x.x, x.y - a * 26); ctx.globalAlpha = 1;
      }
    }
    drawFog(ctx, view) {
      const fc = this.fogCtx, fw = this.fogCv.width, fh = this.fogCv.height, z = this.cam.z, k = 0.25;
      fc.globalCompositeOperation = 'source-over';
      fc.clearRect(0, 0, fw, fh);
      fc.fillStyle = 'rgba(0,3,5,0.93)'; fc.fillRect(0, 0, fw, fh);
      const v0 = this.s2w(0, 0), v1 = this.s2w(this.W, this.H);
      fc.globalCompositeOperation = 'destination-out';
      // explored memory: dimmed, soft-edged
      const o = this.w2s(0, 0), mw = view.s.map.w * z * k, mh = view.s.map.h * z * k;
      fc.globalAlpha = 0.42; fc.drawImage(this.expCv, o.x * k, o.y * k, mw, mh); fc.globalAlpha = 1;
      for (const s of this.sources || []) {
        if (s.x + s.r < v0.x || s.x - s.r > v1.x || s.y + s.r < v0.y || s.y - s.r > v1.y) continue;
        const sp = this.w2s(s.x, s.y), r = s.r * z * k * 1.08;
        fc.drawImage(this.hole, sp.x * k - r, sp.y * k - r, r * 2, r * 2);
      }
      const ctx2 = ctx;
      ctx2.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx2.imageSmoothingEnabled = true;
      ctx2.drawImage(this.fogCv, 0, 0, fw / k, fh / k);
      ctx2.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.W / 2 - this.cam.x * z), this.dpr * (this.H / 2 - this.cam.y * z));
    }
    drawOverlays(ctx, view, t, ui, pals) {
      if (!ui) return;
      const z = this.cam.z;
      // order lines for selected own units
      if (ui.selection && ui.selection.size && ui.selection.size < 60) {
        ctx.setLineDash([4 / z, 6 / z]); ctx.lineWidth = 1 / z;
        for (const id of ui.selection) {
          const u = view.byId.get(id); if (!u || u.kind !== undefined || u.o !== this.local) continue;
          const o = u.order; let tx, ty;
          if (o.t === 'move' || o.t === 'amove' || o.t === 'build') { tx = o.x; ty = o.y; }
          else if (o.t === 'attack') { const tg = view.byId.get(o.id); if (tg) { tx = tg.x; ty = tg.y; } }
          if (tx === undefined) continue;
          ctx.strokeStyle = o.t === 'attack' || o.t === 'amove' ? 'rgba(255,120,120,.35)' : 'rgba(160,255,240,.3)';
          ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tx, ty); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (ui.ghost) {
        const g = ui.ghost, sd = E.STRUCTS[g.kind];
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = g.ok ? 'rgba(160,255,220,.9)' : 'rgba(255,100,100,.9)'; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.arc(g.x, g.y, sd.r * 1.4, 0, TAU); ctx.stroke();
        E.drawGlow(ctx, g.x, g.y, sd.r * 2.5, g.ok ? { r: 160, g: 255, b: 220 } : { r: 255, g: 100, b: 100 }, 0.5, true);
        if (sd.shot || sd.lance) { ctx.setLineDash([6 / z, 8 / z]); ctx.beginPath(); ctx.arc(g.x, g.y, (sd.shot || sd.lance).range, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
        ctx.globalAlpha = 1;
      }
      if (ui.target) {
        const g = ui.target;
        ctx.strokeStyle = E.rgba(E.hex(g.color || '#60f0ff'), 0.8); ctx.lineWidth = 1.5 / z;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r || 20, 0, TAU); ctx.stroke();
        if (g.fromX !== undefined && g.range) { ctx.setLineDash([5 / z, 7 / z]); ctx.beginPath(); ctx.arc(g.fromX, g.fromY, g.range, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      }
      for (const p of ui.pings || []) {
        const a = (t - p.t0) / 0.7; if (a > 1) continue;
        ctx.strokeStyle = E.rgba(p.c, 0.85 * (1 - a)); ctx.lineWidth = 1.8 / z;
        ctx.beginPath(); ctx.arc(p.x, p.y, (6 + a * 24) / Math.max(0.5, z), 0, TAU); ctx.stroke();
      }
    }
  }
  E.Renderer = Renderer;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
