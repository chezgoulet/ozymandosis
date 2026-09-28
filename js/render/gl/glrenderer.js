// three.js backend: batched, instanced 2D pipeline. One render() per frame,
// ~6 draw calls regardless of creature count. See docs/RENDERING.md.
(function (E) {
  'use strict';
  const TAU = E.TAU;
  const GL = () => E.GL;
  const WHITE = { r: 255, g: 255, b: 255 };
  const GOLD = { r: 255, g: 224, b: 102 };

  // Quality tiers. The frame-budget controller (js/ui/perf.js) moves between them.
  E.GL_TIERS = {
    ultra: { dpr: 2, caustics: 1, pools: 48, detail: 400, segs: 20, wake: 1, motes: 1, atlas: 1 },
    high: { dpr: 1.5, caustics: 1, pools: 32, detail: 260, segs: 20, wake: 1, motes: 1, atlas: 1 },
    medium: { dpr: 1, caustics: 1, pools: 20, detail: 140, segs: 20, wake: 0, motes: 1, atlas: 0.75 },
    low: { dpr: 0.75, caustics: 0, pools: 0, detail: 60, segs: 10, wake: 0, motes: 0, atlas: 0.6 },
  };
  E.GL_TIER_ORDER = ['ultra', 'high', 'medium', 'low'];

  // Renderer-owned body state with a ring-buffer trail (no per-frame allocation).
  function makeVis(x, y, a, bodyLen, seed) {
    const rng = E.RNG(seed || 1), sp = 2, n = Math.max(12, Math.round(bodyLen / sp));
    const v = { n, sp, tx: new Float32Array(n), ty: new Float32Array(n), h: 0, phase: rng.next() * TAU, drift: rng.next() * TAU, freq: 3 + rng.next() * 3, undul: 0.3 + rng.next() * 0.15, indiv: rng.next(), org: [] };
    for (let j = 0; j < n; j++) { v.tx[j] = x - Math.cos(a) * j * sp; v.ty[j] = y - Math.sin(a) * j * sp; }
    for (let k = 0; k < 8; k++) v.org.push({ speed: 0.8 + rng.next() * 0.4, phase: rng.next() * TAU });
    return v;
  }
  function advance(v, x, y, dt) {
    let hx = v.tx[v.h], hy = v.ty[v.h], dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy);
    if (d > 240) { v.tx.fill(x); v.ty.fill(y); return; }
    while (d >= v.sp) {
      const f = v.sp / d; hx += dx * f; hy += dy * f;
      v.h = (v.h - 1 + v.n) % v.n; v.tx[v.h] = hx; v.ty[v.h] = hy;
      dx = x - hx; dy = y - hy; d = Math.hypot(dx, dy);
    }
    v.drift += dt * 0.3;
  }
  const PX = new Float32Array(20), PY = new Float32Array(20);
  function buildPts(v, x, y, t, size) {
    const n = v.n, step = (n - 1) / 19;
    for (let si = 0; si < 20; si++) {
      const idx = Math.min(n - 1, Math.round(si * step));
      const j = (v.h + idx) % n, jp = (v.h + Math.max(0, idx - 1)) % n, jn = (v.h + Math.min(n - 1, idx + 1)) % n;
      const px = si === 0 ? x : v.tx[j], py = si === 0 ? y : v.ty[j];
      const dx = v.tx[jn] - v.tx[jp], dy = v.ty[jn] - v.ty[jp], dl = Math.hypot(dx, dy) || 0.001;
      const w = Math.sin(t * v.freq * 3 - si * 0.7 + v.phase + v.drift * 2) * size * 5 * v.undul * (si / 19);
      PX[si] = px + (-dy / dl) * w; PY[si] = py + (dx / dl) * w;
    }
  }
  const dirAt = i => { const a = Math.max(0, i - 1), b = Math.min(19, i + 1); return Math.atan2(PY[a] - PY[b], PX[a] - PX[b]); };

  class GLRenderer extends E.RenderCore {
    constructor(canvas, opts) {
      super(canvas);
      opts = opts || {};
      const B = this.B = opts.backend || E.GL_BACKEND();
      const THREE = this.ns = B.ns;
      this.kind = B.kind;
      this.tierName = opts.quality && E.GL_TIERS[opts.quality] ? opts.quality : 'high';
      this.r = this.makeRenderer(canvas, opts);
      this.r.autoClear = true; this.r.setClearColor(0x000000, 1);
      this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const U = this.U = B.uniforms ? B.uniforms() : { uCam: { value: new THREE.Vector4(0, 0, 1, 0) }, uRes: { value: new THREE.Vector2(1, 1) } };
      this.buildAtlas(E.GL_TIERS[this.tierName].atlas);
      const G = GL();
      this.bg = G.fullscreen(B, 'bg', Object.assign({
        uMap: { value: new THREE.Vector2(1, 1) }, uBgC: { value: new THREE.Vector3() }, uBg: { value: new THREE.Vector3() }, uPrim: { value: new THREE.Vector3() }, uQ: { value: 1 },
        uPools: { value: Array.from({ length: G.MAX_POOLS }, () => new THREE.Vector4()) }, uPoolN: { value: 0 },
        uCur: { value: Array.from({ length: G.MAX_CUR }, () => new THREE.Vector4()) }, uCurK: { value: Array.from({ length: G.MAX_CUR }, () => new THREE.Vector2()) }, uCurN: { value: 0 },
      }, U), 0, false);
      this.glowU = new G.GlowBatch(B, U, 1);
      this.ribbon = new G.RibbonBatch(B, U, 2);
      this.sprite = new G.SpriteBatch(B, U, this.tex, 3);
      this.glowT = new G.GlowBatch(B, U, 4);
      this.fogTex = new THREE.DataTexture(new Uint8Array(8), 2, 2, THREE.RGFormat); this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
      this.fog = G.fullscreen(B, 'fog', Object.assign({ uGrid: { value: new THREE.Vector2(1, 1) }, uCell: { value: E.FOG_CELL }, uFog: { value: this.fogTex } }, U), 5, true);
      this.glowUI = new G.GlowBatch(B, U, 6);
      this.ribbonUI = new G.RibbonBatch(B, U, 7);
      for (const m of [this.bg, this.glowU.mesh, this.ribbon.mesh, this.sprite.mesh, this.glowT.mesh, this.fog, this.glowUI.mesh, this.ribbonUI.mesh]) this.scene.add(m);
      // text/box overlay (cheap 2D: only text and the selection box)
      this.ov = document.createElement('canvas'); this.ov.className = 'view-overlay';
      Object.assign(this.ov.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      canvas.parentNode.insertBefore(this.ov, canvas.nextSibling);
      this.octx = this.ov.getContext('2d');
      this.lost = false;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.buildAtlas(this.atlasScale); this.sprite.mesh.material.uniforms.uTex.value = this.tex; });
    }
    makeRenderer(canvas, opts) {
      return new this.ns.WebGLRenderer({ canvas, antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    }
    get quality() { return this.tierName === 'low' ? 'low' : 'high'; }
    set quality(q) { if (!this.r) return; if (E.GL_TIERS[q]) this.setTier(q); else if (q === 'low' || q === 'high') this.setTier(q); }
    setTier(name) {
      if (!E.GL_TIERS[name] || name === this.tierName) return;
      this.tierName = name; const T = E.GL_TIERS[name];
      if (T.atlas !== this.atlasScale && this.sprite) { this.buildAtlas(T.atlas); this.sprite.mesh.material.uniforms.uTex.value = this.tex; }
      this.resize();
    }
    get tier() { return E.GL_TIERS[this.tierName]; }
    buildAtlas(scale) {
      const THREE = this.ns;
      const maxTex = (this.r.capabilities && this.r.capabilities.maxTextureSize) || 4096;
      this.atlas = new E.Atlas({ scale, maxSize: Math.min(4096, maxTex) }).build();
      this.atlasScale = scale;
      if (this.tex) this.tex.dispose();
      this.tex = new THREE.CanvasTexture(this.atlas.canvas);
      this.tex.flipY = false; this.tex.premultiplyAlpha = false; this.tex.generateMipmaps = false;
      this.tex.minFilter = THREE.LinearFilter; this.tex.magFilter = THREE.LinearFilter;
      this.tex.colorSpace = THREE.NoColorSpace;
      // local extents per organ (world units at scale 1, anchor at origin)
      const s = scale;
      for (const id in this.atlas.organs) { const O = this.atlas.organs[id], b = O.b; O.ext = [b.l - 1 / s, b.l - 1 / s + O.w / s, b.t - 1 / s, b.t - 1 / s + O.h / s]; }
      for (const k in this.atlas.decor) { const D = this.atlas.decor[k]; D.ext = [-D.w / 2 / s, D.w / 2 / s, -D.h / 2 / s, D.h / 2 / s]; }
      this.shapeExt = [-12, 12, -12, 12]; this.glyphExt = [-14, 14, -14, 14];
    }
    gpuName() {
      const gl = this.r.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.dpr = Math.min(this.tier.dpr, window.devicePixelRatio || 1) * (this.tier.dpr < 1 ? 1 : 1);
      const scale = this.tier.dpr < 1 ? this.tier.dpr : this.dpr;
      this.r.setPixelRatio(scale); this.r.setSize(this.W, this.H, false);
      const od = Math.min(2, window.devicePixelRatio || 1);
      this.ov.width = Math.round(this.W * od); this.ov.height = Math.round(this.H * od); this.odpr = od;
      this.U.uRes.value.set(this.W, this.H);
    }
    reset(view, local) {
      super.reset(view, local);
      const THREE = this.ns;
      this.fogData = new Uint8Array(this.cols * this.rows * 2);
      if (this.fogTex) this.fogTex.dispose();
      this.fogTex = new THREE.DataTexture(this.fogData, this.cols, this.rows, THREE.RGFormat);
      this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
      this.fog.material.uniforms.uFog.value = this.fogTex;
      this.fog.material.uniforms.uGrid.value.set(this.cols, this.rows);
      this.bg.material.uniforms.uMap.value.set(view.s.map.w, view.s.map.h);
      this.fogVer = -1;
    }
    dispose() {
      for (const m of this.scene.children) { m.geometry.dispose(); m.material.dispose(); }
      this.tex.dispose(); this.fogTex.dispose(); this.r.dispose();
      if (this.ov.parentNode) this.ov.parentNode.removeChild(this.ov);
    }
    flush() { const gl = this.r.getContext(); gl.finish && gl.finish(); }

    // ── frame ───────────────────────────────────────────────────
    frame(view, alpha, t, dt, ui) {
      if (this.lost) return;
      this.t = t;
      const s = view.s, cam = this.cam, z = cam.z, W = this.W, H = this.H, T = this.tier;
      this.fogActive = this.fogOn(view);
      this.visT -= dt; if (this.visT <= 0) { this.updateVision(view); this.visT = 0.1; }
      const lp = this.local >= 0 ? s.players[this.local] : null;
      this.pals = s.players.map(p => E.playerPalette(view, p));
      const pal = lp ? this.pals[this.local] : E.palette(E.CULTURE_LIST[0], 0.3, 0, 100, false);
      this.U.uCam.value.set(cam.x, cam.y, z, t);
      const hw = W / 2 / z, hh = H / 2 / z;
      this.vx0 = cam.x - hw; this.vx1 = cam.x + hw; this.vy0 = cam.y - hh; this.vy1 = cam.y + hh;
      const inView = (x, y, m) => x > this.vx0 - m && x < this.vx1 + m && y > this.vy0 - m && y < this.vy1 + m;
      this.inView = inView;
      // background uniforms
      const bu = this.bg.material.uniforms;
      bu.uBgC.value.set(pal.bgCenter.r / 255, pal.bgCenter.g / 255, pal.bgCenter.b / 255);
      bu.uBg.value.set(pal.bg.r / 255, pal.bg.g / 255, pal.bg.b / 255);
      bu.uPrim.value.set(pal.primary.r / 255, pal.primary.g / 255, pal.primary.b / 255);
      bu.uQ.value = T.caustics;
      let pn = 0;
      for (const r of s.pools) {
        if (pn >= Math.min(T.pools, GL().MAX_POOLS)) break;
        if (!inView(r.x, r.y, r.r * 3.2) || r.kind !== 'lumen' || (this.fogActive && !this.explore(r.x, r.y))) continue;
        bu.uPools.value[pn++].set(r.x, r.y, r.r, r.amt / r.max);
      }
      bu.uPoolN.value = pn;
      const cur = s.map.currents; let cn = 0;
      for (const c of cur) { if (cn >= GL().MAX_CUR) break; bu.uCur.value[cn].set(c.x, c.y, c.r, c.s); bu.uCurK.value[cn].set(c.kind === 'vortex' ? 0 : 1, c.a); cn++; }
      for (const c of s.clouds) if (c.kind === 'tide' && cn < GL().MAX_CUR) { bu.uCur.value[cn].set(c.x, c.y, c.r, 60); bu.uCurK.value[cn].set(0, 0); cn++; }
      bu.uCurN.value = cn;
      // fog texture
      this.fog.visible = this.fogActive;
      if (this.fogActive && this.fogVer !== this.visVer) {
        const d = this.fogData, g = this.visSoft, ex = this.expSoft;
        for (let i = 0, n = g.length; i < n; i++) { d[i * 2] = g[i]; d[i * 2 + 1] = ex[i]; }
        this.fogTex.needsUpdate = true; this.fogVer = this.visVer;
      }
      this.glowU.begin(); this.ribbon.begin(); this.sprite.begin(); this.glowT.begin(); this.glowUI.begin(); this.ribbonUI.begin();
      this.drawPools(view, t, inView);
      this.drawVents(view, t, inView);
      this.drawClouds(view, t, inView);
      for (const b of s.structs) if (inView(b.x, b.y, 120) && (b.o === this.local || !this.fogActive || this.explore(b.x, b.y))) this.drawStruct(view, b, this.pals[b.o], t, ui);
      this.drawUnits(view, alpha, t, dt, inView, ui);
      this.drawShots(view);
      this.gore.step(dt); { const D = this.structAdapter(); D.z = this.cam.z; this.gore.draw(D, t, inView); }
      this.drawFx(t);
      this.drawOverlays(view, t, ui);
      this.trackDamage(view, dt);
      this.glowU.end(); this.ribbon.end(); this.sprite.end(); this.glowT.end(); this.glowUI.end(); this.ribbonUI.end();
      this.r.render(this.scene, this.camera);
      this.drawText(ui, pal);
    }
    drawPools(view, t, inView) {
      const lumen = { r: 0x9f, g: 0xf8, b: 0xff }, spore = GOLD, g = this.glowU, T = this.tier;
      for (const r of view.s.pools) {
        if (!inView(r.x, r.y, r.r * 2) || (this.fogActive && !this.explore(r.x, r.y))) continue;
        const fr = r.amt / r.max, rad = r.r * (0.5 + 0.5 * fr) * (1 + 0.08 * Math.sin(t * 0.4 + r.ph));
        const c = r.kind === 'spore' ? spore : lumen;
        g.add(r.x, r.y, rad * 1.9, 0, c, 0.55 * (0.3 + 0.7 * fr));
        if (T.motes) {
          const motes = Math.round((r.kind === 'spore' ? 5 : 4) + 14 * fr);
          for (let i = 0; i < motes; i++) {
            const a = i / motes * TAU + t * (r.kind === 'spore' ? 0.6 : 0.25) * (i % 2 ? 1 : -1) + r.ph, rr = rad * (0.45 + 0.35 * Math.sin(t * 0.7 + i * 1.7));
            g.add(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr, r.kind === 'spore' ? 1.8 : 1.3, 4, r.kind === 'spore' ? spore : WHITE, 0.35 + 0.3 * Math.sin(t * 2 + i));
          }
        }
        this.glowUI.add(r.x, r.y, rad, 7, c, 0.1 + 0.06 * fr, 1, 40);
      }
    }
    drawVents(view, t, inView) {
      const s = view.s;
      for (const v of s.vents) {
        if (!inView(v.x, v.y, 60) || (this.fogActive && !this.explore(v.x, v.y))) continue;
        this.glowU.add(v.x, v.y, 20, 8, { r: 0, g: 0, b: 0 }, 0.5);
        this.glowU.add(v.x, v.y, 19, 2, { r: 255, g: 190, b: 120 }, 0.28, 1.5);
        for (let i = 0; i < 5; i++) { const q = (t * 0.4 + i / 5) % 1; this.glowU.add(v.x + Math.sin(i * 2.3 + t) * 8, v.y - q * 40, 1.5 + q * 2, 4, { r: 255, g: 220, b: 180 }, 0.35 * (1 - q)); }
      }
      for (const k of s.pickups) {
        if (!inView(k.x, k.y, 60) || !this.seen(k.x, k.y)) continue;
        const pu = E.POWERUPS[k.k], c = E.hex(pu.color), bob = Math.sin(t * 2 + k.id) * 4;
        this.glowT.add(k.x, k.y + bob, 30, 0, c, 0.8 + 0.2 * Math.sin(t * 3));
        this.glowT.add(k.x, k.y + bob, 12.5, 2, c, 0.7, 1.4);
        const u = this.atlas.glyphs[k.k];
        this.sprite.add(k.x, k.y + bob, 0, 0.62, this.glyphExt, u, u, 0, E.mix(c, WHITE, 0.4), c, 0.95, false);
      }
    }
    drawClouds(view, t, inView) {
      for (const c of view.s.clouds) {
        if (!inView(c.x, c.y, c.r)) continue;
        const life = Math.min(1, c.t / 0.6, (c.dur - c.t + 0.3) / 0.5);
        if (c.kind === 'ink') { for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + t * 0.2, rr = c.r * 0.45; this.glowT.add(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, c.r * 0.8, 8, { r: 12, g: 4, b: 28 }, 0.85 * life); } this.glowT.add(c.x, c.y, c.r, 8, { r: 6, g: 2, b: 16 }, life); }
        else if (c.kind === 'venom') { this.glowU.add(c.x, c.y, c.r * 1.2, 0, { r: 150, g: 255, b: 90 }, 0.45 * life); for (let i = 0; i < 10; i++) { const q = (t * 0.5 + i / 10) % 1, a = i * 2.39; this.glowT.add(c.x + Math.cos(a) * c.r * 0.7 * q, c.y + Math.sin(a) * c.r * 0.7 * q, 2, 4, { r: 170, g: 255, b: 110 }, 0.45 * (1 - q) * life); } }
        else if (c.kind === 'tide') { for (let k = 0; k < 4; k++) this.glowU.add(c.x, c.y, c.r * (0.3 + k * 0.18), 7, { r: 80, g: 200, b: 255 }, 0.3 * life, 2, 3 + k); this.glowU.add(c.x, c.y, c.r, 0, { r: 48, g: 184, b: 255 }, 0.25 * life); }
        else if (c.kind === 'bloom') { this.glowU.add(c.x, c.y, c.r, 0, { r: 160, g: 255, b: 190 }, 0.3 * life); for (let i = 0; i < 16; i++) { const q = (t * 0.6 + i / 16) % 1, a = i * 2.39; this.glowT.add(c.x + Math.cos(a) * c.r * 0.8 * (i / 16), c.y + Math.sin(a) * c.r * 0.8 * (i / 16) - q * 30, 1.8, 4, GOLD, 0.6 * (1 - q) * life); } }
        else if (c.kind === 'flare') { this.glowU.add(c.x, c.y, c.r * 0.5, 0, { r: 255, g: 243, b: 160 }, 0.3 * life); this.glowUI.add(c.x, c.y, c.r, 2, { r: 255, g: 243, b: 160 }, 0.18 * life, 1.5); }
      }
    }
    drawStruct(view, b, pal, t, ui) {
      const p = view.s.players[b.o], cult = E.CULTURES[p.culture], c0 = cult.colors[0], c1 = cult.colors[1], sd = E.STRUCTS[b.kind];
      const vis = b.o === this.local || this.seen(b.x, b.y);
      const R = sd.r, beat = 0.5 + 0.5 * Math.sin(t * (1.4 + p.energy * 3 + p.fever * 4) + b.id);
      const A = (b.build < 1 ? 0.35 + b.build * 0.5 : 1) * (vis ? 1 : 0.55);
      this.glowU.add(b.x, b.y, R * 3.4, 0, pal.accent, (0.3 + 0.12 * beat) * A);
      const z = this.cam.z, D = this.structAdapter();
      D.z = z; D.lod = z < 0.2 ? 2 : (z < 0.4 || this.tierName === 'low') ? 1 : 0;
      E.drawStructure(D, this, view, b, pal, t, { alpha: A });
      // culture marker (shape, not colour alone)
      this.marker(b.x, b.y - R * 1.95, cult, 0.85);
      if (b.lance && sd.lance && vis) {
        const tg = view.byId.get(b.lance);
        if (tg) this.curve(b.x, b.y, tg.x, tg.y, Math.sin(t * 17) * 8, Math.cos(t * 13) * 8, 1.1, pal.accent, 0.5 + 0.25 * Math.sin(t * 30));
      }
      const hpF = b.hp / sd.hp, sel = ui && ui.selection && ui.selection.has(b.id);
      if (b.build < 1) this.glowUI.add(b.x, b.y, R * 1.6 + 1, 3, c1, 0.85, 2.2, b.build);
      else if (hpF < 0.999 || sel) { this.glowUI.add(b.x, b.y, R * 1.6 + 1.5, 2, WHITE, 0.08, 3); this.glowUI.add(b.x, b.y, R * 1.6 + 1.5, 3, hpF < 0.35 ? E.RED : pal.accent, 0.9, 3, hpF); }
      const q = b.queue[0];
      if (q && b.o === this.local) this.glowUI.add(b.x, b.y, R * 0.95, 3, WHITE, 0.6, 1.6, E.clamp(q.t / q.dur, 0, 1));
      if (sel) { this.ribbonUI.add(b.x, b.y, b.rally.x, b.rally.y, 0.6 / this.cam.z, 2, 2, WHITE, 0.4); this.glowUI.add(b.rally.x, b.rally.y, 6, 2, c1, 0.9, 1.5); }
    }
    // Adapter from the living-structure drawer to the GPU batches.
    structAdapter() {
      if (this._sa) return this._sa;
      const r = this;
      const seg = (x0, y0, x1, y1, s, prof, c, a, wk) => r.ribbon.add(x0, y0, x1, y1, s, prof === 0 ? 5 * s * (wk || 1) + 1 : s + 2, prof, c, a, wk);
      this._sa = {
        z: 1, lod: 0, seen: (x, y) => r.seen(x, y),
        glow: (x, y, rad, k, c, a, p0, p1) => r.glowU.add(x, y, rad, k, c, a, p0, p1),
        glowTop: (x, y, rad, k, c, a, p0, p1) => r.glowT.add(x, y, rad, k, c, a, p0, p1),
        seg,
        poly(P, n, closed, s0, s1, prof, c, a, wk) {
          const m = closed ? n : n - 1;
          for (let i = 0; i < m; i++) { const j = (i + 1) % n, s = m > 1 ? s0 + (s1 - s0) * (i / (m - 1)) : s0; seg(P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1], s, prof, c, a, wk); }
        },
        organ(id, x, y, rot, sc, ti, side, ph, speed, t, body, acc, a) {
          const O = r.atlas.organs[id]; if (!O) return;
          const F = E.GL_FRAMES, fr = (t / E.GL_CYCLE) * F, ff = ((fr * speed + ph * 1.27) % F + F) % F, fa = Math.floor(ff), fb = (fa + 1) % F, cells = O.cells[ti] || O.cells[0];
          r.sprite.add(x, y, rot, sc, O.ext, cells[fa], cells[fb], ff - fa, body, acc, a, side < 0);
        },
      };
      return this._sa;
    }
    marker(x, y, cult, a) {
      const z = this.cam.z, mode = E.Settings.markers || 'auto';
      if (mode === 'off' || (mode === 'auto' && z < 0.45)) return;
      const k = E.SHAPES[cult.idx], u = this.atlas.shapes[k];
      this.sprite.add(x, y, 0, Math.max(0.28, 0.42 / Math.max(0.6, z)), this.shapeExt, u, u, 0, cult.colors[1], cult.colors[0], a, false);
    }
    curve(x0, y0, x1, y1, ox, oy, w, c, a) {
      const mx = (x0 + x1) / 2 + ox, my = (y0 + y1) / 2 + oy; let px = x0, py = y0;
      for (let i = 1; i <= 6; i++) { const q = i / 6, ix = (1 - q) * (1 - q) * x0 + 2 * (1 - q) * q * mx + q * q * x1, iy = (1 - q) * (1 - q) * y0 + 2 * (1 - q) * q * my + q * q * y1; this.ribbon.add(px, py, ix, iy, w, w + 2, 1, c, a); px = ix; py = iy; }
    }
    drawUnits(view, alpha, t, dt, inView, ui) {
      const s = view.s, z = this.cam.z, T = this.tier, local = this.local, sel = ui && ui.selection;
      const lod = z >= 0.3 ? 0 : 1;
      let detailed = 0;
      const cx = this.cam.x, cy = this.cam.y;
      const list = this._list || (this._list = []); list.length = 0;
      for (const u of s.units) {
        const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
        let v = this.vis.get(u.id);
        if (!inView(x, y, 400)) { if (v) v.stale = true; continue; }
        const st = view.stats(u);
        const design = view.designOf(u.o, u.d), ch = E.CHASSIS[design.chassis] || E.CHASSIS.serpent;
        if (!v) { v = makeVis(x, y, u.a, ch.bodyLen * st.size, u.id); this.vis.set(u.id, v); }
        if (v.stale) { v.tx.fill(x); v.ty.fill(y); v.stale = false; }
        advance(v, x, y, dt);
        if (!inView(x, y, 120)) continue;
        const own = local >= 0 && !view.isEnemy(local, u.o);
        if (!own && !this.seen(x, y)) continue;
        const stealth = view.isStealthed(u);
        if (!own && stealth) continue;
        list.push(u); u._x = x; u._y = y; u._st = st; u._des = design; u._v = v; u._stealth = stealth; u._d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      }
      // detail budget: the nearest creatures to the camera get organs and decor
      if (list.length > T.detail) list.sort((a, b) => a._d2 - b._d2);
      for (const u of list) {
        const detail = lod === 0 && detailed < T.detail; if (detail) detailed++;
        this.drawUnit(view, u, t, detail, sel);
      }
    }
    drawUnit(view, u, t, detail, sel) {
      const s = view.s, p = s.players[u.o], cpal = this.pals[u.o], cult = E.CULTURES[p.culture];
      const x = u._x, y = u._y, st = u._st, v = u._v, design = u._des, ch = E.CHASSIS[design.chassis] || E.CHASSIS.serpent, size = st.size;
      buildPts(v, x, y, t, size);
      let hc = E.creatureColor(cult, cpal, v.indiv, v.phase, t);
      const hpF = E.clamp(u.hp / st.hp, 0, 1);
      const flicker = cpal.panic > 0 ? 0.7 + 0.3 * Math.sin(t * 12 + v.phase * 3) : 1;
      const ba = u.fade * E.lerp(0.35, 0.95, hpF) * (1 - cpal.starve * 0.3) * (u._stealth ? 0.35 : 1) * flicker;
      const act = u.engaged ? 1.3 : 1;
      // wounds: organs torn away, tail worn down, all regrowing with health
      const organsAll = design.organs, nOrgAll = Math.min(organsAll.length, ch.slots), cols = v.cols || (v.cols = E.residueColors(cult));
      const anchorOf = i => { const org = E.ORGANS[organsAll[i]], O = org && this.atlas.organs[org.id]; if (!O) return null; const ai = E.GL_ANCHOR_I[O.anchor]; return { x: PX[ai], y: PY[ai], rot: O.anchor === 'head' ? Math.atan2(PY[0] - PY[1], PX[0] - PX[1]) : O.anchor === 'tail' ? Math.atan2(PY[16] - PY[19], PX[16] - PX[19]) : Math.atan2(PY[1] - PY[9], PX[1] - PX[9]), side: E.organSides(organsAll)[i] }; };
      const wound = this.gore.update(v, u.id, hpF, design, nOrgAll, p.tier[(E.ORGANS[organsAll[0]] || {}).cls] || 0, cols, t, { X: PX, Y: PY }, anchorOf, size);
      E.contractSpine(PX, PY, wound.tail);
      // gatherers soft and pale, fighters dark-plated and spiked
      const role = E.roleClass(st);
      if (role === 'gatherer') hc = E.mix(hc, WHITE, 0.22);
      const rb = this.ribbon, segs = detail ? this.tier.segs : 10, stepI = 20 / segs;
      const body = (from, to, sz, a, prof, wk) => {
        let pi = from;
        for (let i = from + stepI; i <= to; i += stepI) { const j = Math.min(to, Math.round(i)); rb.add(PX[pi], PY[pi], PX[j], PY[j], sz, prof === 0 ? 5 * sz * act * (wk || 1) + 1 : sz + 2, prof, hc, a, wk); pi = j; }
      };
      const cid = ch.id;
      if (this.tier.wake && detail) for (let i = 1; i < v.n; i += Math.max(2, v.n >> 3)) { const j = (v.h + i) % v.n, f = i / v.n; this.glowU.add(v.tx[j], v.ty[j], size * (1 + f * 2) * 1.6, 0, hc, ba * 0.08); }
      const bw = role === 'gatherer' ? 0.85 : 1.08;
      if (cid === 'serpent' || cid === 'leviathan') body(0, 19, size * act * bw, ba, 0);
      else if (cid === 'carapace') body(0, 19, size * 0.8 * act, ba * 0.7, 0);
      else if (cid === 'ctenophore') body(6, 19, size * 0.5, ba * 0.3, 0);
      else if (cid === 'nautiloid') body(2, 13, size * 0.7 * act, ba * 0.6, 0);
      else if (cid === 'siphonophore') body(0, 19, 0.7 * size, ba * 0.3, 1);
      else if (cid === 'medusa') {
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * 5 * size; let lx = PX[1], ly = PY[1];
          for (let i = 3; i <= 19; i += 2) {
            const a = dirAt(i) + Math.PI / 2, q = i / 19, w = Math.sin(t * 2.4 - i * 0.5 + k * 1.3) * 2.5 * q, o = off * (1 - q * 0.6) + w;
            const nx = PX[i] + Math.cos(a) * o, ny = PY[i] + Math.sin(a) * o;
            rb.add(lx, ly, nx, ny, 0.45, 2.5, 1, hc, ba * 0.5); lx = nx; ly = ny;
          }
        }
      }
      if (detail) {
        const sp = this.sprite, A = this.atlas;
        const fr = (t / E.GL_CYCLE) * E.GL_FRAMES;
        // chassis decor
        if (cid === 'carapace') { const D = A.decor.plate; for (let i = 9; i >= 0; i--) { const k = Math.min(19, i * 2); sp.add(PX[k], PY[k], dirAt(k), size * act * (7.5 - i * 0.45) / 7.5 * 1.05, D.ext, D.cells[0], D.cells[0], 0, hc, cpal.accent, ba, false); } }
        else if (cid === 'ctenophore') this.decor('comb', PX[3], PY[3], dirAt(3), size * act, fr + v.phase, hc, cpal.accent, ba);
        else if (cid === 'medusa') this.decor('bell', PX[0], PY[0], dirAt(1), size * act, fr * 0.7 + v.phase, hc, cpal.accent, ba);
        else if (cid === 'nautiloid') this.decor('shell', PX[1] - Math.cos(dirAt(1)) * 9 * size * act * 0.6, PY[1] - Math.sin(dirAt(1)) * 9 * size * act * 0.6, dirAt(1), size * act, fr + v.phase, hc, cpal.accent, ba);
        else if (cid === 'siphonophore') for (let i = 1; i < 20; i += 2) { const pulse = 0.5 + 0.5 * Math.sin(t * 3 - i * 0.6 + size), r = size * (i % 4 === 1 ? 3.2 : 2.2) * act * (0.85 + pulse * 0.3); this.glowU.add(PX[i], PY[i], r * 1.9, 0, hc, ba * 0.4); this.glowT.add(PX[i], PY[i], r * 0.8, 4, E.mix(hc, WHITE, 0.3), ba * (0.35 + pulse * 0.3)); if (i % 4 === 1) this.glowT.add(PX[i], PY[i], r * 1.3, 2, cpal.accent, ba * 0.5, 0.8); }
        else if (cid === 'leviathan') for (let i = 2; i < 18; i += 2) { const a = dirAt(i), l = size * (6 - i * 0.2); for (const sd of [-1, 1]) rb.add(PX[i], PY[i], PX[i] + Math.cos(a + sd * 2.2) * l, PY[i] + Math.sin(a + sd * 2.2) * l, 0.6, 2, 1, E.mix(hc, WHITE, 0.3), ba * 0.6); this.glowT.add(PX[i], PY[i], size * 1.6, 1, cpal.accent, ba * (0.4 + 0.4 * Math.sin(t * 3 - i))); }
        // role silhouettes: gatherers carry a pale harvest sac; fighters wear dark plates, spikes and a crown
        if (role === 'gatherer') {
          const sx = (PX[4] + PX[6]) / 2, sy = (PY[4] + PY[6]) / 2, r = size * 5.6, cf = st.cargo ? E.clamp(u.cargo / st.cargo, 0, 1) : 0;
          this.glowU.add(sx, sy, r * 2, 0, E.mix(hc, WHITE, 0.35), ba * 0.5);
          this.glowT.add(sx, sy, r, 4, E.mix(hc, WHITE, 0.45), ba * (0.16 + 0.3 * cf));
          this.glowT.add(sx, sy, r * 1.04, 2, E.mix(hc, WHITE, 0.6), ba * 0.75, 1.4);
        } else {
          const Dp = A.decor.plate, dark = E.mix(hc, { r: 0, g: 0, b: 0 }, 0.5), edge = E.mix(cpal.accent, WHITE, 0.35);
          for (const k of [8, 6, 4, 2]) sp.add(PX[k], PY[k], dirAt(k), size * act * (1.35 - k * 0.05), Dp.ext, Dp.cells[0], Dp.cells[0], 0, dark, edge, Math.min(1, ba * 1.2), false);
          // armour bands: forward-pointing chevrons across the back
          for (const k of [2, 4, 6, 8]) { const d = dirAt(k), w = size * (5.4 - k * 0.3), tip = size * 2.2, hx = PX[k] + Math.cos(d) * tip, hy = PY[k] + Math.sin(d) * tip, sz = Math.max(0.35, size * 0.4);
            for (const s of [-1, 1]) rb.add(PX[k] + Math.cos(d + s * Math.PI / 2) * w, PY[k] + Math.sin(d + s * Math.PI / 2) * w, hx, hy, sz, sz + 2, 1, edge, ba * 0.85); }
          for (let k = 3, s = 1; k <= 11; k += 2, s = -s) { const a = dirAt(k) + s * (Math.PI / 2 + 0.6), l = size * (7 - k * 0.3), sz = size * 0.42; rb.add(PX[k], PY[k], PX[k] + Math.cos(a) * l, PY[k] + Math.sin(a) * l, sz, 5 * sz + 1, 0, edge, ba * 0.9); }
          const a0 = dirAt(1); for (const s of [-0.4, 0.4]) { const sz = size * 0.48; rb.add(PX[0], PY[0], PX[0] + Math.cos(a0 + s) * size * 6.5, PY[0] + Math.sin(a0 + s) * size * 6.5, sz, 5 * sz + 1, 0, edge, ba); }
        }
        // organs
        const sides = E.organSides(design.organs), oa = Math.min(1, ba * 1.15);
        const organs = design.organs, nOrg = Math.min(organs.length, ch.slots);
        for (let i = 0; i < nOrg; i++) {
          const org = E.ORGANS[organs[i]]; if (!org) continue;
          if (wound.mask & (1 << i)) continue; // torn away; it regrows as the creature heals
          const O = A.organs[org.id]; if (!O) continue;
          const par = v.org[i & 7], ti = p.tier[org.cls] || 0;
          const ai = E.GL_ANCHOR_I[O.anchor];
          const rot = O.anchor === 'head' ? Math.atan2(PY[0] - PY[1], PX[0] - PX[1]) : O.anchor === 'tail' ? Math.atan2(PY[16] - PY[19], PX[16] - PX[19]) : Math.atan2(PY[1] - PY[9], PX[1] - PX[9]);
          const ff = ((fr * par.speed + par.phase * 1.27) % E.GL_FRAMES + E.GL_FRAMES) % E.GL_FRAMES, fa = Math.floor(ff), fb = (fa + 1) % E.GL_FRAMES;
          const cells = O.cells[ti];
          sp.add(PX[ai], PY[ai], rot, this.gore.growScale(v, i, t), O.ext, cells[fa], cells[fb], ff - fa, hc, cpal.accent, oa, sides[i] < 0);
        }
      }
      // head glow
      const hs = 3.5 * size * act * (cid === 'medusa' || cid === 'nautiloid' ? 0.7 : 1);
      this.glowT.add(PX[0], PY[0], hs * 4, 1, cpal.accent, ba * 0.9);
      if (u.elite) this.glowT.add(PX[0], PY[0], hs * 3.2, 2, GOLD, 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3)), 1);
      if (u.cargo > 0) this.glowT.add((PX[4] + PX[6]) / 2, (PY[4] + PY[6]) / 2, 4 + 7 * u.cargo / Math.max(1, st.cargo), 1, u.ct === 's' ? GOLD : { r: 200, g: 255, b: 255 }, 0.9);
      if (u.buffs && u.buffs.length) this.drawBuffs(u, x, y, t, size);
      // overlays
      const r = 10 + size * 4, z = this.cam.z;
      if (sel && sel.has(u.id)) {
        this.glowUI.add(x, y, r, 2, WHITE, 0.22, 1);
        this.glowUI.add(x, y, r, 3, hpF > 0.35 ? cpal.accent : E.RED, 0.95, 2, hpF);
      } else if (hpF < 0.98 && z > 0.45 && E.Settings.showHp) {
        const w = 8 * size; this.glowUI.add(x, y - r - 4, w, 5, hpF > 0.35 ? cpal.accent : E.RED, 0.9, 0.16, hpF);
      }
      if (u.rank && z > 0.5) for (let k = 0; k < u.rank; k++) this.glowUI.add(x - (u.rank - 1) * 2.5 + k * 5, y + r + 3, 1.5, 4, GOLD, 1);
      if (detail) this.marker(x - Math.cos(u.a) * r * 0.2, y + r + (u.rank ? 9 : 4), cult, 0.75 * u.fade);
      v.last = { hc, pal: cpal, size, design, tier: p.tier, cid, a: ba };
    }
    decor(k, x, y, rot, sc, fr, body, acc, a) {
      const D = this.atlas.decor[k], n = D.cells.length;
      const ff = ((fr % n) + n) % n, fa = Math.floor(ff), fb = (fa + 1) % n;
      this.sprite.add(x, y, rot, sc, D.ext, D.cells[fa], D.cells[fb], ff - fa, body, acc, a, false);
    }
    drawBuffs(u, x, y, t, size) {
      for (const b of u.buffs) {
        const k = b.k;
        if (k === 'stun') for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; this.glowT.add(x + Math.cos(a) * 10, y + Math.sin(a) * 10 - 6, 4, 1, { r: 255, g: 243, b: 160 }, 0.9); }
        else if (k === 'harden') this.glowUI.add(x, y, 15 * size, 6, { r: 255, g: 210, b: 138 }, 0.7);
        else if (k === 'song') this.glowT.add(x + Math.sin(t * 3 + u.id) * 8, y - 12 - (t * 20 + u.id) % 10, 2.4, 1, GOLD, 0.8);
        else if (k === 'poison' || k === 'coat') this.glowU.add(x, y, 12 * size, 0, { r: 150, g: 255, b: 90 }, 0.35);
        else if (k === 'haste') this.glowU.add(x, y, 10 * size, 0, { r: 128, g: 208, b: 255 }, 0.35);
        else if (k === 'drain') this.glowU.add(x, y, 12, 0, { r: 208, g: 144, b: 255 }, 0.45 + 0.2 * Math.sin(t * 8));
        else if (k === 'hot') this.glowU.add(x, y, 12 * size, 0, { r: 160, g: 255, b: 190 }, 0.4);
      }
    }
    drawShots(view) {
      for (const sh of view.s.shots) {
        if (!this.inView(sh.x, sh.y, 20) || !this.seen(sh.x, sh.y)) continue;
        const c = this.pals[sh.o] ? this.pals[sh.o].accent : WHITE;
        this.glowT.add(sh.x, sh.y, 7, 1, c, 0.95);
        const m = Math.hypot(sh.vx, sh.vy) || 1;
        this.ribbon.add(sh.x, sh.y, sh.x - sh.vx / m * 12, sh.y - sh.vy / m * 12, 0.7, 2, 1, c, 0.6);
      }
    }
    drawFx(t) {
      this.corpses = this.corpses.filter(c => t - c.t0 < 1.6);
      for (const c of this.corpses) {
        const a = c.o.alpha * 0.6 * (1 - (t - c.t0) / 1.6);
        const P = c.pts; for (let i = 1; i < 20; i++) this.ribbon.add(P[(i - 1) * 2], P[(i - 1) * 2 + 1], P[i * 2], P[i * 2 + 1], c.o.size, 5 * c.o.size + 1, 0, c.o.hc, a);
      }
      this.fx = this.fx.filter(f => t - f.t0 < f.dur);
      for (const f of this.fx) {
        if (!this.inView(f.x, f.y, f.r)) continue;
        const a = (t - f.t0) / f.dur;
        if (f.k === 'burst') this.glowT.add(f.x, f.y, E.lerp(f.r * 0.2, f.r, a), 0, f.c, (1 - a) * 0.95 * f.hot);
        else this.glowUI.add(f.x, f.y, E.lerp(f.r * 0.3, f.r, Math.sqrt(a)), 2, f.c, (1 - a) * 0.75, 2 * (1 - a) + 0.8);
      }
    }
    // Corpses keep a frozen copy of the last spine (the base consume() calls this shape).
    consume(view, events) {
      for (const ev of events) if (ev.e === 'die') {
        const v = this.vis.get(ev.id);
        if (v && v.last && (ev.x === undefined || this.seen(ev.x, ev.y))) {
          // rebuild from its own trail, then break the body apart and loose every remaining organ
          buildPts(v, v.tx[v.h], v.ty[v.h], this.t || 0, v.last.size);
          const d = v.last.design, org = d.organs.slice(0, (E.CHASSIS[d.chassis] || E.CHASSIS.serpent).slots), sides = E.organSides(org), all = [];
          org.forEach((id, i) => { if (v.wmask & (1 << i)) return; const O = this.atlas.organs[id]; if (!O) return; const ai = E.GL_ANCHOR_I[O.anchor]; all.push({ id, x: PX[ai], y: PY[ai], rot: Math.atan2(PY[Math.max(0, ai - 1)] - PY[Math.min(19, ai + 1)], PX[Math.max(0, ai - 1)] - PX[Math.min(19, ai + 1)]), side: sides[i] }); });
          if (!ev.withered) this.gore.dismember(PX, PY, d, 0, v.cols || E.residueColors(E.CULTURE_LIST[0]), v.last.size, all);
          else { const pts = new Float32Array(40); for (let i = 0; i < 20; i++) { pts[i * 2] = PX[i]; pts[i * 2 + 1] = PY[i]; } if (this.corpses.length >= 60) this.corpses.shift(); this.corpses.push({ pts, o: { hc: v.last.hc, size: v.last.size, alpha: v.last.a }, t0: this.t || 0 }); }
          v.last = null;
        }
      }
      super.consume(view, events);
    }
    drawOverlays(view, t, ui) {
      if (!ui) return;
      const z = this.cam.z;
      if (ui.selection && ui.selection.size && ui.selection.size < 60) {
        for (const id of ui.selection) {
          const u = view.byId.get(id); if (!u || u.kind !== undefined || u.o !== this.local) continue;
          const o = u.order; let tx, ty;
          if (o.t === 'move' || o.t === 'amove' || o.t === 'build' || o.t === 'patrol' || o.t === 'mend') { tx = o.x; ty = o.y; }
          else if (o.t === 'attack') { const tg = view.byId.get(o.id); if (tg) { tx = tg.x; ty = tg.y; } }
          if (tx === undefined) continue;
          const c = o.t === 'attack' || o.t === 'amove' ? { r: 255, g: 120, b: 120 } : o.t === 'patrol' ? GOLD : o.t === 'mend' ? { r: 170, g: 255, b: 190 } : { r: 160, g: 255, b: 240 };
          this.ribbonUI.add(u.x, u.y, tx, ty, 0.6 / z, 2 / z + 1, 2, c, 0.4);
          let px = tx, py = ty;
          for (const q of u.q || []) { if (q.x === undefined) continue; this.ribbonUI.add(px, py, q.x, q.y, 0.6 / z, 2 / z + 1, 2, c, 0.3); this.glowUI.add(q.x, q.y, 3 / z + 1, 4, c, 0.6); px = q.x; py = q.y; }
          if (o.t === 'patrol' && o.ax !== undefined) this.ribbonUI.add(o.x, o.y, o.ax, o.ay, 0.6 / z, 2 / z + 1, 2, GOLD, 0.25);
        }
      }
      if (ui.ghost) {
        const g = ui.ghost, sd = E.STRUCTS[g.kind], c = g.ok ? { r: 160, g: 255, b: 220 } : { r: 255, g: 100, b: 100 };
        this.glowUI.add(g.x, g.y, sd.r * 1.4, 2, c, 0.6, 2);
        this.glowUI.add(g.x, g.y, sd.r * 2.5, 0, c, 0.5);
        if (sd.shot || sd.lance) this.glowUI.add(g.x, g.y, (sd.shot || sd.lance).range, 7, c, 0.5, 1.5, 48);
      }
      if (ui.target) {
        const g = ui.target, c = E.hex(g.color || '#60f0ff');
        this.glowUI.add(g.x, g.y, g.r || 20, 2, c, 0.8, 1.5);
        if (g.fromX !== undefined && g.range) this.glowUI.add(g.fromX, g.fromY, g.range, 7, c, 0.6, 1.5, 48);
      }
      for (const p of ui.pings || []) {
        const a = (t - p.t0) / 0.7; if (a > 1) continue;
        this.glowUI.add(p.x, p.y, (6 + a * 24) / Math.max(0.5, z), 2, p.c, 0.85 * (1 - a), 1.8);
      }
      if (ui.threats) for (const th of ui.threats) this.glowUI.add(th.x, th.y, 26, 2, E.RED, 0.5 + 0.3 * Math.sin(t * 8), 2);
    }
    drawText(ui, pal) {
      const ctx = this.octx, od = this.odpr, z = this.cam.z, t = this.t;
      ctx.setTransform(od, 0, 0, od, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.texts = this.texts.filter(x => t - x.t0 < (x.dmg ? 1.1 : 1.8));
      if (this.texts.length) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const x of this.texts) {
          const dur = x.dmg ? 1.1 : 1.8, a = (t - x.t0) / dur;
          const sx = (x.x - this.cam.x) * z + this.W / 2, sy = (x.y - this.cam.y) * z + this.H / 2 - a * (x.dmg ? 22 : 26);
          if (sx < -40 || sy < -40 || sx > this.W + 40 || sy > this.H + 40) continue;
          ctx.globalAlpha = 1 - a * a;
          ctx.font = `${x.dmg ? 700 : 600} ${Math.round((x.dmg ? 12 : 13) * (x.size || 1) * Math.min(1.3, Math.max(0.85, z)))}px "Atkinson Hyperlegible Next", system-ui, sans-serif`;
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,6,10,.75)'; ctx.strokeText(x.s, sx, sy);
          ctx.fillStyle = x.color; ctx.fillText(x.s, sx, sy);
        }
        ctx.globalAlpha = 1;
      }
      if (ui && ui.box) {
        // the selection membrane takes the colony's live palette, like the rest of the HUD
        const b = ui.box, bc = pal.accent; ctx.fillStyle = E.rgba(bc, 0.08); ctx.strokeStyle = E.rgba(E.mix(bc, E.WHITE, 0.2), 0.8); ctx.lineWidth = 1.25;
        ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
      }
      if (pal.blighted) { ctx.fillStyle = E.rgba({ r: 255, g: 70, b: 70 }, 0.03 + 0.05 * (0.5 + 0.5 * Math.sin(t * 3))); ctx.fillRect(0, 0, this.W, this.H); }
    }
  }
  E.GLRenderer = GLRenderer;
})(window.E);
