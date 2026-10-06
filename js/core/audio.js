// Procedural audio: the generative score (js/core/music.js) plus synthesized
// effects. No assets.
(function (E) {
  'use strict';
  const A = { ctx: null, on: false, last: {} };
  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = A.ctx = new AC({ latencyHint: 'playback' });
    A.master = c.createGain(); A.master.connect(c.destination);
    A.music = c.createGain(); A.music.connect(A.master);
    A.fx = c.createGain(); A.fx.connect(A.master);
    const rev = c.createConvolver(); rev.buffer = impulse(c, 3.2); A.rev = c.createGain(); A.rev.gain.value = 0.35; A.rev.connect(rev); rev.connect(A.master);
    A.apply();
    A.on = true;
    const lite = E.Settings.quality === 'low' || (E.Perf && E.Perf.defaultTier && E.Perf.defaultTier() === 'low');
    if (E.Music) E.Music.start(c, A.music, { lite });
  };
  // Resume a suspended score and report whether audio is running. Used when the
  // app returns from the background and by the title-screen gesture handlers.
  A.wake = function () {
    A.init();
    const c = A.ctx; if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    return c.resume().then(() => c.state === 'running').catch(() => false);
  };
  function impulse(c, sec) {
    const len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return b;
  }
  A.apply = function () {
    if (!A.ctx) return;
    const m = E.Settings.muted ? 0 : 1;
    A.music.gain.value = E.Settings.music * 0.6 * m; A.fx.gain.value = E.Settings.sfx * 0.7 * m;
  };
  // mood: 0..1 energy, 0..1 fever, 0..1 starvation; intensity: 0..1 how hard the fighting is
  A.mood = function (e, fever, starve) { if (A.on && E.Music) E.Music.mood(e, fever, starve); };
  A.intensity = function (v) { if (E.Music) E.Music.intensity(v); };
  A.theme = function (name) { if (!E.Music) return; if (E.Music.on) { if (E.Music.theme !== name) E.Music.setTheme(name); } else E.Music.theme = name; };
  A.cadence = function (won) { if (E.Music) E.Music.cadence(won); };
  function tone(freq, dur, type, vol, glide, when, wet) {
    const c = A.ctx, t = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.fx); if (wet) g.connect(A.rev);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function thr(k, ms) { const n = performance.now(); if (A.last[k] && n - A.last[k] < ms) return false; A.last[k] = n; return true; }
  const SFX = {
    tap: () => tone(880, 0.06, 'sine', 0.05),
    select: () => tone(660, 0.08, 'triangle', 0.05, 1.3),
    order: () => { tone(520, 0.09, 'sine', 0.06, 1.2); tone(780, 0.07, 'sine', 0.04, 1.1, 0.04); },
    deny: () => tone(180, 0.18, 'square', 0.03, 0.8),
    hatch: () => { tone(1046, 0.5, 'sine', 0.06, 1, 0, true); tone(1568, 0.4, 'sine', 0.03, 1, 0.05, true); },
    bite: () => tone(220 + Math.random() * 80, 0.05, 'triangle', 0.02, 0.6),
    die: () => tone(400, 0.5, 'sine', 0.05, 0.3, 0, true),
    research: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.6, 'sine', 0.05, 1, i * 0.08, true)),
    power: () => { tone(160, 0.9, 'sawtooth', 0.04, 3, 0, true); tone(640, 0.6, 'sine', 0.05, 1.5, 0.1, true); },
    ability: () => tone(700, 0.25, 'triangle', 0.05, 1.8, 0, true),
    alert: () => { tone(330, 0.2, 'square', 0.04); tone(247, 0.25, 'square', 0.04, 1, 0.22); },
    pickup: () => [880, 1320, 1760].forEach((f, i) => tone(f, 0.3, 'sine', 0.05, 1, i * 0.05, true)),
    build: () => { tone(98, 0.8, 'sine', 0.08, 1.5, 0, true); tone(196, 0.8, 'triangle', 0.04, 1.5, 0.1, true); },
    destroy: () => { tone(90, 1.4, 'sawtooth', 0.07, 0.3, 0, true); tone(60, 1.6, 'sine', 0.09, 0.5, 0, true); },
    victory: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 1.4, 'sine', 0.06, 1, i * 0.18, true)),
    defeat: () => [392, 311, 262, 196].forEach((f, i) => tone(f, 1.4, 'sine', 0.06, 1, i * 0.25, true)),
    chat: () => tone(1200, 0.08, 'sine', 0.04),
  };
  // Each culture sings in its own mode; hatch and research chimes use it.
  const SCALES = [[0, 2, 4, 7, 9], [0, 2, 4, 5, 7, 9, 11], [0, 3, 5, 7, 10], [0, 1, 5, 7, 8], [0, 2, 3, 7, 8], [0, 4, 6, 7, 11]];
  A.setCulture = function (idx) { A.scale = SCALES[idx % 6]; A.root = [523.25, 587.33, 493.88, 440, 466.16, 554.37][idx % 6]; };
  A.note = function (step) { const sc = A.scale || SCALES[0], n = sc[((step % sc.length) + sc.length) % sc.length] + 12 * Math.floor(step / sc.length); return (A.root || 523.25) * Math.pow(2, n / 12); };
  SFX.hatch = () => { const s = Math.floor(Math.random() * 5); tone(A.note(s), 0.5, 'sine', 0.06, 1, 0, true); tone(A.note(s + 2), 0.4, 'sine', 0.03, 1, 0.05, true); };
  SFX.research = () => [0, 1, 2, 4].forEach((s, i) => tone(A.note(s), 0.6, 'sine', 0.05, 1, i * 0.08, true));
  A.play = function (k, ms) { if (!A.on || !SFX[k]) return; if (!thr(k, ms || 60)) return; try { SFX[k](); } catch (e) { /* ignore */ } };
  E.Audio = A;
})(window.E);
