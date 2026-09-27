// Procedural audio: an ambient abyssal pad that follows the colony's mood,
// plus synthesized effects. No assets.
(function (E) {
  'use strict';
  const A = { ctx: null, on: false, last: {} };
  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = A.ctx = new AC();
    A.master = c.createGain(); A.master.connect(c.destination);
    A.music = c.createGain(); A.music.connect(A.master);
    A.fx = c.createGain(); A.fx.connect(A.master);
    const rev = c.createConvolver(); rev.buffer = impulse(c, 3.2); A.rev = c.createGain(); A.rev.gain.value = 0.35; A.rev.connect(rev); rev.connect(A.master);
    A.apply();
    // pad
    A.padF = c.createBiquadFilter(); A.padF.type = 'lowpass'; A.padF.frequency.value = 700; A.padF.Q.value = 0.7;
    A.padG = c.createGain(); A.padG.gain.value = 0.0; A.padF.connect(A.padG); A.padG.connect(A.music); A.padG.connect(A.rev);
    A.oscs = [];
    [55, 82.41, 110, 164.81, 220.5].forEach((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 2) * 6;
      const g = c.createGain(); g.gain.value = [0.5, 0.25, 0.3, 0.12, 0.08][i];
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03; const lg = c.createGain(); lg.gain.value = g.gain.value * 0.5; lfo.connect(lg); lg.connect(g.gain); lfo.start();
      o.connect(g); g.connect(A.padF); o.start(); A.oscs.push(o);
    });
    // ocean noise
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const n = c.createBufferSource(); n.buffer = nb; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 380;
    const ng = c.createGain(); ng.gain.value = 0.22; n.connect(nf); nf.connect(ng); ng.connect(A.music); n.start();
    A.padG.gain.setTargetAtTime(0.18, c.currentTime, 3);
    A.on = true;
  };
  function impulse(c, sec) {
    const len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return b;
  }
  A.apply = function () {
    if (!A.ctx) return;
    A.music.gain.value = E.Settings.music * 0.6; A.fx.gain.value = E.Settings.sfx * 0.7;
  };
  // mood: 0..1 energy, 0..1 fever
  A.mood = function (e, fever) {
    if (!A.on) return;
    const t = A.ctx.currentTime;
    A.padF.frequency.setTargetAtTime(500 + e * 900 + fever * 600, t, 1.5);
    A.oscs[3].detune.setTargetAtTime(fever * 80, t, 2);
    A.oscs[4].detune.setTargetAtTime(fever * -60, t, 2);
  };
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
  A.play = function (k, ms) { if (!A.on || !SFX[k]) return; if (!thr(k, ms || 60)) return; try { SFX[k](); } catch (e) { /* ignore */ } };
  E.Audio = A;
})(window.E);
