// Repeatable render benchmark. Builds a deterministic scene with N creatures
// (every chassis, mixed organs, max tiers) moving inside the viewport, then
// measures frames. Driven by bench/bench.cjs; also usable by hand:
//   index.html?bench=1&backend=webgl2&units=400
(function (E) {
  'use strict';
  E.Bench = {
    world(n, seed) {
      const cults = E.CULTURE_LIST.map(c => c.id);
      const w = new E.World({ cfg: { map: { size: 'l', seed: seed || 7, powerups: 1, currents: true, fog: false }, players: cults.map(c => ({ culture: c, kind: 'bot' })) } });
      w.s.units = [];
      const rng = E.RNG(1234), cx = w.s.map.w / 2, cy = w.s.map.h / 2;
      w.s.players.forEach((p, pi) => {
        p.tier = { leg: 3, flagella: 3, pili: 3, mandible: 3, antenna: 3 }; p.kind = 'human'; p.techVer++;
        p.forms = E.ORGAN_LIST.map(o => o.id); p.chassis = E.CHASSIS_LIST.map(c => c.id);
        E.CHASSIS_LIST.forEach((ch, k) => {
          const organs = []; for (let i = 0; i < ch.slots; i++) organs.push(E.ORGAN_LIST[(pi * 7 + k * 5 + i * 11) % 30].id);
          p.designs.push({ id: 'b' + k, name: 'B' + k, chassis: ch.id, organs });
        });
      });
      for (let i = 0; i < n; i++) {
        const o = i % 6, u = w.spawnUnit(o, 'b' + (i % 6 + Math.floor(i / 6)) % 6, cx + (rng.next() - 0.5) * 1300, cy + (rng.next() - 0.5) * 800, { fade: 1, noOrder: true });
        u.order = { t: 'move', x: cx + (rng.next() - 0.5) * 1300, y: cy + (rng.next() - 0.5) * 800 };
      }
      w.index();
      return w;
    },
    // Visual check: render a static-camera scene and leave it on screen.
    async show(opts) {
      const w = this.world(opts.units || 60, opts.seed);
      const host = document.getElementById('game'); host.hidden = false; E.Screens.hideAll(); document.getElementById('bg').hidden = true;
      const cv = document.createElement('canvas'); Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: 50 }); host.appendChild(cv);
      const r = E.createRenderer(cv, opts.backend, { quality: opts.quality || 'high', preserve: true });
      if (r.initP) await r.initP;
      r.resize(); r.reset(w, opts.local === undefined ? -1 : opts.local);
      r.cam.x = w.s.map.w / 2; r.cam.y = w.s.map.h / 2; r.cam.z = opts.zoom || 1.4;
      for (let i = 0; i < (opts.frames || 90); i++) { w.step(); r.frame(w, 1, w.s.t, 1 / 30, { selection: new Set(w.s.units.slice(0, 3).map(u => u.id)), pings: [] }); }
      return r.kind;
    },
    // Runs inside the page. Returns timing stats.
    async run(opts) {
      const n = opts.units || 200, frames = opts.frames || 240, warm = opts.warm || 60;
      const w = this.world(n, opts.seed);
      const host = document.getElementById('game');
      host.hidden = false; E.Screens.hideAll(); document.getElementById('bg').hidden = true;
      const cv = document.createElement('canvas'); Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: 50 });
      host.appendChild(cv);
      const r = E.createRenderer(cv, opts.backend || 'auto', { quality: opts.quality || 'high' });
      if (r.initP) await r.initP;
      if (r.failed) return { backend: r.kind, units: n, error: String(r.failed) };
      r.resize(); r.reset(w, -1);
      r.cam.x = w.s.map.w / 2; r.cam.y = w.s.map.h / 2; r.cam.z = opts.zoom || 1;
      const ui = { selection: new Set(), pings: [] };
      const cpu = [], gaps = [];
      let last = performance.now(), i = 0, t = 0;
      await new Promise(done => {
        const tick = now => {
          const gap = now - last; last = now;
          // keep the scene moving: 2 sim steps/frame worth of motion at 60 fps
          w.step(); w.step(); w.drainEvents(); t += 1 / 60;
          for (const u of w.s.units) if (u.order.t === 'idle') u.order = { t: 'move', x: w.s.map.w / 2 + Math.sin(u.id + t) * 600, y: w.s.map.h / 2 + Math.cos(u.id * 1.3 + t) * 380 };
          const c0 = performance.now();
          r.frame(w, 1, w.s.t, 1 / 60, ui);
          if (r.flush) r.flush();
          const c1 = performance.now();
          if (i >= warm) { cpu.push(c1 - c0); gaps.push(gap); }
          if (++i < warm + frames) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
      });
      const stat = a => { const s = a.slice().sort((x, y) => x - y), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2) }; };
      const res = { backend: r.kind, units: n, cpu: stat(cpu), frame: stat(gaps), fps: +(1000 / stat(gaps).avg).toFixed(1), gpu: r.gpuName ? r.gpuName() : '' };
      if (r.dispose) r.dispose();
      cv.remove();
      return res;
    },
  };
})(window.E);
