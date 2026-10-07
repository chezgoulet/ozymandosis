// SPDX-License-Identifier: AGPL-3.0-only
// The frame-rate instrument (work order §5; docs/PERFORMANCE.md "Measuring on a device").
// Every match is measured: the real interval between frames (rAF gaps, which
// include GPU time), bucketed into a histogram so a long match costs a fixed
// 2 KB, plus the governor's tier changes and what the device is. At the end of a
// match of 30 s or more, the run is kept on the device (Settings → Performance,
// the last 20 runs, readable and copyable) and, for single-player and online
// matches with diagnostics on, sent to the service (/api/perf; admin console →
// Performance), where it can be found afterwards. A LAN match is never sent:
// local play does not contact the service.
// Nothing identifying is collected: no account, no address, no device model
// string, only the class the game already derives (desktop / mobile / low).
(function (E) {
  'use strict';
  const BIN = 0.5, BINS = 500, KEEP = 20, KEY = 'efl.perf.runs'; // 0.5 ms bins to 250 ms; slower frames land in the last bin
  let run = null;

  const pct = (h, n, q) => { const want = Math.ceil(n * q); let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= want) return Math.round((i + 0.5) * BIN * 10) / 10; } return BINS * BIN; };

  const F = E.FrameStats = {
    MIN_SECONDS: 30,
    active: () => !!run,
    // start measuring a match: what is being measured, and on what
    begin(meta) {
      const r = (meta && meta.renderer) || {};
      run = {
        at: Date.now(), hist: new Uint32Array(BINS), n: 0, total: 0, worst: 0, slow: 0, janky: 0, cpu: 0, unitsPeak: 0,
        tiers: [], tierStart: F.tierOf(r),
        meta: { mode: meta.mode || 'local', renderer: r.kind || '?', deviceClass: E.Perf.deviceClass(), popCap: meta.popCap || null, players: meta.players || null,
          quality: E.Settings.quality, platform: (E.Native && E.Native.is) ? E.Native.platform : (E.isDesktop && E.isDesktop() ? 'desktop' : 'web'),
          cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
          screen: `${Math.round(screen.width * (devicePixelRatio || 1))}x${Math.round(screen.height * (devicePixelRatio || 1))}@${Math.round((devicePixelRatio || 1) * 100) / 100}` },
      };
    },
    tierOf(r) { return r ? (r.kind === 'canvas2d' ? r.quality : r.tierName) || null : null; },
    // one frame: the real gap since the last one (ms), the JS cost of it (ms), creatures alive
    frame(gapMs, cpuMs, units) {
      if (!run || !(gapMs > 0) || gapMs > 5000) return; // a paused or backgrounded page is not a frame
      run.hist[Math.min(BINS - 1, Math.floor(gapMs / BIN))]++;
      run.n++; run.total += gapMs; run.cpu += cpuMs || 0;
      if (gapMs > run.worst) run.worst = gapMs;
      if (gapMs > 1000 / 30) run.slow++;   // below 30 fps
      if (gapMs > 50) run.janky++;          // a visible hitch
      if (units > run.unitsPeak) run.unitsPeak = units;
    },
    // the governor moved: from → to, and why
    tier(from, to, why) { if (run) run.tiers.push({ s: Math.round((Date.now() - run.at) / 100) / 10, from, to, why }); },
    // finish: returns the record (or null for a run too short to mean anything)
    end(tierNow) {
      const r = run; run = null;
      if (!r || !r.n) return null;
      const seconds = r.total / 1000;
      if (seconds < F.MIN_SECONDS) return null;
      const rec = Object.assign({
        v: 1, at: new Date(r.at).toISOString(), version: E.VERSION, seconds: Math.round(seconds),
        frames: r.n, fps: Math.round(r.n / seconds * 10) / 10,
        p50: pct(r.hist, r.n, 0.5), p95: pct(r.hist, r.n, 0.95), p99: pct(r.hist, r.n, 0.99), worst: Math.round(r.worst),
        below30: Math.round(r.slow / r.n * 1000) / 10, hitches: r.janky, cpuMs: Math.round(r.cpu / r.n * 10) / 10,
        tierStart: r.tierStart, tierEnd: tierNow || r.tierStart, tierChanges: r.tiers.length, tierLog: r.tiers.slice(0, 40), unitsPeak: r.unitsPeak,
      }, r.meta);
      F.keep(rec);
      if (rec.mode !== 'lan' && E.Settings.crashReports !== false && E.Online) E.Online.api('POST', '/api/perf', rec).catch(() => { /* offline: it is still on the device */ });
      return rec;
    },
    keep(rec) { const all = E.LS.get(KEY, []); all.unshift(rec); E.LS.set(KEY, all.slice(0, KEEP)); },
    runs: () => E.LS.get(KEY, []),
    clear: () => E.LS.del(KEY),
    // one line a person can read
    describe: r => `${r.fps} fps · p50 ${r.p50} ms · p95 ${r.p95} ms · p99 ${r.p99} ms · ${r.below30}% below 30 fps · ${r.tierChanges} tier change${r.tierChanges === 1 ? '' : 's'} (${r.tierStart}→${r.tierEnd}) · ${r.deviceClass}, ${r.renderer}, ${Math.round(r.seconds / 60 * 10) / 10} min, up to ${r.unitsPeak} creatures`,
  };
})(window.E);
