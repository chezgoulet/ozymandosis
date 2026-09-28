// Frame-budget governor: the 60 fps contract (see docs/PERFORMANCE.md).
//
// Budget: 16.7 ms per frame. Quality tiers (ultra → high → medium → low) trade
// resolution, caustics, wake glows, organ detail budget and atlas resolution.
// The governor watches real frame intervals (rAF gaps, which include GPU time)
// and JS frame cost:
//   • downgrade one tier when >10% of the last ~2 s of frames missed the
//     budget (gap > 1.25× budget), *before* the player perceives a stutter;
//   • probe one tier up after 8 s of clean frames with JS cost < 45% of budget,
//     and revert (and back off for 60 s) if the probe misses frames.
// Hard caps (enforced by the renderer and sim): fx ≤ 400, corpses ≤ 60,
// floating texts ≤ 80, detailed creatures ≤ tier.detail, population ≤ popCap/player.
(function (E) {
  'use strict';
  E.Perf = {
    deviceClass() {
      const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      const small = Math.min(screen.width, screen.height) < 900;
      const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
      if (cores <= 4 && mem <= 3) return 'low';
      return coarse && small ? 'mobile' : 'desktop';
    },
    defaultTier() { const c = this.deviceClass(); return c === 'desktop' ? 'high' : c === 'mobile' ? 'medium' : 'low'; },
    defaultPopCap() { const c = this.deviceClass(); return c === 'desktop' ? 120 : c === 'mobile' ? 90 : 60; },
  };

  class Governor {
    constructor(renderer, opts) {
      this.r = renderer; this.budget = (opts && opts.budget) || 16.7;
      this.gaps = new Float32Array(120); this.cpu = new Float32Array(120); this.i = 0; this.n = 0;
      this.clean = 0; this.cool = 0; this.probe = null; this.log = [];
    }
    get tiers() { return this.r.kind === 'canvas2d' ? ['high', 'low'] : E.GL_TIER_ORDER; }
    current() { return this.r.kind === 'canvas2d' ? this.r.quality : this.r.tierName; }
    set(t, why) { if (t === this.current()) return; if (E.FrameStats) E.FrameStats.tier(this.current(), t, why); this.log.push({ t: performance.now(), tier: t, why }); if (this.log.length > 20) this.log.shift(); if (this.r.setTier) this.r.setTier(t); else { this.r.quality = t; this.r.resize(); } }
    sample(gapMs, cpuMs, dt) {
      if (E.Settings.quality !== 'auto') return;
      this.gaps[this.i] = gapMs; this.cpu[this.i] = cpuMs; this.i = (this.i + 1) % this.gaps.length; this.n = Math.min(this.n + 1, this.gaps.length);
      if (this.n < 60) return;
      let miss = 0, cpu = 0;
      for (let k = 0; k < this.n; k++) { if (this.gaps[k] > this.budget * 1.25) miss++; cpu += this.cpu[k]; }
      const missRate = miss / this.n, cpuAvg = cpu / this.n;
      this.cool = Math.max(0, this.cool - dt);
      const tiers = this.tiers, cur = tiers.indexOf(this.current());
      if (this.probe && performance.now() - this.probe.t > 3000) this.probe = null;
      if (missRate > 0.1 && cur < tiers.length - 1) {
        if (this.probe) { this.cool = 60; this.probe = null; }
        this.set(tiers[cur + 1], `missed ${Math.round(missRate * 100)}% of frames`); this.reset(); return;
      }
      if (missRate === 0 && cpuAvg < this.budget * 0.45) this.clean += dt; else this.clean = 0;
      if (this.clean > 8 && this.cool <= 0 && cur > 0) { this.probe = { t: performance.now() }; this.set(tiers[cur - 1], 'headroom probe'); this.reset(); }
    }
    reset() { this.n = 0; this.i = 0; this.clean = 0; }
  }
  E.Governor = Governor;
})(window.E);
