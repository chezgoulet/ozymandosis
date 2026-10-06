// The score. Generative, adaptive and synthesized in real time: no samples.
//
// Two lineages meet here. From dark synthwave: supersaw pads that pump against
// the kick, a detuned Reese bass, gated 16th-note arpeggios and a saw lead with
// glide. From generative space-ambient: FM bells through long delays, a vast
// dark reverb, shimmering grains in the scale and evolving drones.
//
// Composition
//  - Harmony: a Markov chain over the scale degrees of the culture's mode, with
//    cinematic moves (i → VI → VII, pedal points, the odd borrowed chord).
//  - Melody: every culture has a leitmotif (a fixed seed, so it is recognisable
//    match to match); each match varies it (a fresh seed) in AA'BA'' phrases,
//    re-harmonised to whatever chord is under it.
//  - Rhythm: Euclidean patterns; the low-intensity pulse is the colony's own
//    heartbeat (lub-dub), which grows into a full kit as the fighting grows.
//  - Form: the music moves between sections (drift → pulse → surge, with a
//    breakdown and riser before a surge) at phrase boundaries, steered by an
//    intensity signal from the match (combat, alerts, fever) and coloured by
//    the colony's energy (brightness) and fever (detune, drive, tempo).
(function (E) {
  'use strict';
  const MODES = {
    dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10], phrygdom: [0, 1, 4, 5, 7, 8, 10], harmminor: [0, 2, 3, 5, 7, 8, 11],
  };
  // Per culture: mode, root (MIDI), tempo, leitmotif seed and timbre leanings.
  const THEMES = {
    title: { mode: 'aeolian', root: 38, bpm: 86, motif: 1818, bell: 1, saw: 0.6 },
    verdant: { mode: 'dorian', root: 40, bpm: 92, motif: 11, bell: 1, saw: 0.4 },
    luminant: { mode: 'lydian', root: 41, bpm: 96, motif: 23, bell: 1.2, saw: 0.5 },
    current: { mode: 'phrygian', root: 43, bpm: 108, motif: 37, bell: 0.7, saw: 1 },
    choir: { mode: 'aeolian', root: 36, bpm: 84, motif: 41, bell: 1.3, saw: 0.3 },
    umbral: { mode: 'phrygdom', root: 37, bpm: 94, motif: 53, bell: 0.8, saw: 0.9 },
    bloom: { mode: 'harmminor', root: 39, bpm: 112, motif: 67, bell: 0.6, saw: 1.1 },
  };
  E.MUSIC_THEMES = THEMES;
  // Degree transitions (0 = i … 6 = VII), weighted toward moody, filmic motion.
  const CHAIN = {
    0: [[5, 4], [3, 3], [6, 3], [2, 1], [4, 1]], 1: [[4, 2], [6, 2], [0, 1]], 2: [[5, 3], [3, 2], [6, 2]],
    3: [[0, 3], [5, 2], [6, 2], [4, 1]], 4: [[0, 4], [5, 2]], 5: [[6, 4], [3, 3], [2, 2], [0, 2]], 6: [[0, 4], [5, 2], [2, 2]],
  };
  // One-bar rhythm cells for melody (step, length in 16ths).
  const CELLS = [
    [[0, 6], [6, 2], [8, 8]], [[0, 3], [3, 3], [6, 4], [12, 4]], [[0, 8], [10, 2], [12, 4]], [[2, 2], [4, 4], [8, 2], [10, 6]],
    [[0, 4], [4, 2], [6, 2], [8, 8]], [[0, 12], [12, 2], [14, 2]], [[0, 2], [3, 3], [6, 2], [8, 3], [11, 5]], [[4, 4], [8, 4], [12, 4]],
  ];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const euclid = (k, n, rot) => { const out = []; for (let i = 0; i < n; i++) out.push(((i + (rot || 0)) * k) % n < k); return out; };

  const M = { on: false, theme: 'title', I: 0.2, Iraw: 0.2, energy: 0.35, fever: 0, starve: 0 };
  let c, out, synth, pump, drums, rev, dly, noise, shaper, lite = false;

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function pick(r, arr) { let tot = 0; for (const [, w] of arr) tot += w; let x = r() * tot; for (const [v, w] of arr) { x -= w; if (x <= 0) return v; } return arr[0][0]; }

  // ── graph ────────────────────────────────────────────────────────
  M.start = function (ctx, dest, opts) {
    if (M.on) return;
    c = ctx; lite = !!(opts && opts.lite);
    out = c.createGain(); out.gain.value = 0; out.connect(dest);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    shaper = c.createWaveShaper(); setDrive(0.2); shaper.oversample = lite ? 'none' : '2x';
    const pre = c.createGain(); pre.gain.value = 0.9;
    // tone: clear the rumble, tuck the low-mids, open the air
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.7;
    const lo = c.createBiquadFilter(); lo.type = 'peaking'; lo.frequency.value = 220; lo.Q.value = 0.9; lo.gain.value = -4;
    const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 5200; air.gain.value = 4;
    pre.connect(hp); hp.connect(lo); lo.connect(shaper); shaper.connect(air); air.connect(comp); comp.connect(out);
    pump = c.createGain(); pump.connect(pre);
    synth = c.createGain(); synth.gain.value = 0.8; synth.connect(pump);
    drums = c.createGain(); drums.gain.value = 0.85; drums.connect(pre);
    // a vast dark hall
    rev = c.createConvolver(); rev.buffer = hall(lite ? 3.2 : 5.5); const revG = c.createGain(); revG.gain.value = 0.55; rev.connect(revG); revG.connect(pre);
    const revIn = c.createGain(); const revHp = c.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 180; revIn.connect(revHp); revHp.connect(rev); rev.input = revIn;
    // ping-pong delay, tempo synced
    dly = { in: c.createGain(), l: c.createDelay(2), r: c.createDelay(2), fb: c.createGain(), lp: c.createBiquadFilter() };
    const merge = c.createChannelMerger(2), dg = c.createGain(); dg.gain.value = 0.42;
    dly.lp.type = 'lowpass'; dly.lp.frequency.value = 2600; dly.fb.gain.value = 0.42;
    dly.in.connect(dly.l); dly.l.connect(dly.lp); dly.lp.connect(dly.r); dly.r.connect(dly.fb); dly.fb.connect(dly.l);
    dly.l.connect(merge, 0, 0); dly.r.connect(merge, 0, 1); merge.connect(dg); dg.connect(pre); dg.connect(revIn);
    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    M.on = true;
    M.setTheme(M.theme, true);
    out.gain.setTargetAtTime(1, c.currentTime, 1.5);
    M.nextT = c.currentTime + 0.1; M.step = 0; M.bar = 0;
    M.timer = setInterval(tick, 100);
    drone.start();
  };
  M.stop = function () { if (!M.on) return; clearInterval(M.timer); out.gain.setTargetAtTime(0, c.currentTime, 0.4); drone.stop(); M.on = false; };
  function hall(sec) {
    const len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, k = 0.08 + 0.9 * t; // darker as it decays
        lp += (Math.random() * 2 - 1 - lp) * (1 - k * 0.95);
        x[i] = lp * Math.pow(1 - t, 2.2) * (i < c.sampleRate * 0.012 ? i / (c.sampleRate * 0.012) : 1);
      }
    }
    return b;
  }
  function setDrive(k) {
    const n = 1024, cur = new Float32Array(n), a = 1 + k * 6;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cur[i] = Math.tanh(x * a) / Math.tanh(a); }
    shaper.curve = cur; M.drive = k;
  }

  // ── theme & composition state ────────────────────────────────────
  M.setTheme = function (name, hard) {
    const th = THEMES[name] || THEMES.title; M.theme = name; M.th = th;
    M.mode = MODES[th.mode]; M.root = th.root;
    M.bpm = th.bpm; M.r = rng((Math.random() * 1e9) | 0);
    M.motif = makeMotif(rng(th.motif * 7919), 2);
    M.bMotif = makeMotif(rng(th.motif * 104729 + 3), 1);
    M.deg = 0; M.chord = chordOf(0); M.chordBars = 0; M.section = 'drift'; M.sectBars = 0; M.phraseBar = 0;
    if (!hard && M.on) { M.pendingRiser = false; transitionSwell(); }
  };
  function makeMotif(r, bars) {
    const notes = []; let deg = [0, 2, 4][Math.floor(r() * 3)];
    for (let b = 0; b < bars; b++) {
      const cell = CELLS[Math.floor(r() * CELLS.length)];
      cell.forEach(([s, l], i) => {
        if (i) deg += pick(r, [[1, 3], [-1, 3], [2, 2], [-2, 2], [0, 1], [3, 1], [-3, 1]]);
        deg = Math.max(-3, Math.min(9, deg));
        notes.push({ s: b * 16 + s, l, deg, strong: s % 8 === 0 });
      });
    }
    return notes;
  }
  const noteOf = (deg, oct) => { const m = M.mode, i = ((deg % 7) + 7) % 7; return M.root + 12 * (oct + Math.floor(deg / 7)) + m[i]; };
  function chordOf(d) { return { d, tones: [0, 2, 4, 6].map(k => d + k) }; }
  // snap a melodic degree to the nearest chord tone (strong beats)
  const snap = (deg, ch) => { let best = deg, bd = 9; for (const t of ch.tones.slice(0, 3)) for (const o of [-7, 0, 7]) { const dd = Math.abs(t + o - deg); if (dd < bd) { bd = dd; best = t + o; } } return best; };

  // ── the scheduler ────────────────────────────────────────────────
  function tick() {
    if (!M.on || c.state !== 'running') return;
    const now = c.currentTime;
    if (M.nextT < now - 0.25) M.nextT = now + 0.05; // woke from a suspended context
    while (M.nextT < now + 1.0) { schedule(M.step, M.nextT); M.nextT += stepDur(); M.step = (M.step + 1) % 16; if (M.step === 0) M.bar++; }
  }
  const stepDur = () => 60 / (M.bpm * (1 + M.fever * 0.08)) / 4;

  function schedule(step, t) {
    if (step === 0) barStart(t);
    const S = M.section, I = M.I, r = M.r, sd = stepDur(), ch = M.chord;
    // percussion
    if (S === 'drift') { if (M.heart && (step === 0 || step === 3)) kick(t, step === 0 ? 0.42 : 0.28, 0.6); }
    else if (S === 'pulse') {
      if (step % 8 === 0) kick(t, 0.6);
      if (M.hatP[step]) hat(t, 0.1 + 0.06 * (step % 4 === 2), 0.045);
      if (step === 12 && M.bar % 2) rim(t, 0.25);
    } else if (S === 'surge') {
      if (M.kickP[step]) kick(t, step % 4 === 0 ? 0.95 : 0.7);
      if (step === 4 || step === 12) snare(t, 0.55);
      if (M.hatP[step]) hat(t, step % 2 ? 0.07 : 0.11, step % 4 === 2 ? 0.09 : 0.035);
      if (M.fill && step >= 12) snare(t + sd / 2, 0.25 + (step - 12) * 0.08);
    } else if (S === 'break') { if (step % 4 === 0) hat(t, 0.05, 0.12); if (step >= 8) snare(t, 0.08 + (step - 8) * 0.05); }
    // bass
    if (S !== 'drift') {
      const root = noteOf(M.pedal ? 0 : ch.d, 0);
      if (S === 'surge' && step % 2 === 0) bass(t, root + (step % 8 === 6 ? 12 : 0), sd * 1.6, 0.4);
      else if (S === 'pulse' && M.bassP[step]) bass(t, root, sd * 2.8, 0.3);
      else if (S === 'break' && step === 0) bass(t, root, sd * 14, 0.4);
    } else if (step === 0 && M.bar % 2 === 0) sub(t, noteOf(M.pedal ? 0 : ch.d, 0), sd * 30, 0.32);
    // arpeggio
    if ((S === 'pulse' || S === 'surge') && (step % (S === 'surge' ? 1 : 2) === 0)) {
      const tones = M.arpTones, k = M.arpI++ % tones.length;
      arp(t, tones[M.arpPat === 'down' ? tones.length - 1 - k : M.arpPat === 'walk' ? Math.floor(r() * tones.length) : k], sd * (S === 'surge' ? 0.9 : 1.6), S === 'surge' ? 0.14 : 0.13);
    }
    // melody
    melody(step, t, sd);
    // grains of light
    if (!lite && r() < (S === 'drift' ? 0.16 : 0.1) + M.energy * 0.06) grain(t + r() * sd, noteOf(ch.tones[Math.floor(r() * 4)] + 7 * (1 + Math.floor(r() * 2)), 1), 0.05);
    if (S === 'surge' && step === 15 && r() < 0.18) stutter(t, sd);
    void I;
  }

  function barStart(t) {
    const r = M.r;
    M.sectBars++; M.phraseBar = M.bar % 4; M.chordBars++;
    // intensity drifts toward its target; sections change on 4-bar boundaries
    if (M.bar % 4 === 0) chooseSection(t);
    const hold = M.section === 'surge' ? 1 : 2;
    if (M.chordBars >= hold || M.bar === 0) {
      M.chordBars = 0;
      M.deg = pick(r, CHAIN[M.deg]);
      if (M.fever > 0.6 && r() < 0.3) M.deg = 1; // tension: the half-step up in phrygian modes bites hardest
      M.chord = chordOf(M.deg);
      M.pedal = M.section !== 'surge' && r() < 0.35;
      pad(t, M.chord, stepDur() * 16 * hold);
    }
    const ch = M.chord;
    M.arpTones = [0, 1, 2, 3, 4].map(k => noteOf(ch.tones[k % 3] + (k >= 3 ? 7 : 0), 2));
    M.arpPat = ['up', 'up', 'down', 'walk'][Math.floor(r() * 4)]; M.arpI = 0;
    M.kickP = M.bar % 4 === 3 && r() < 0.5 ? euclid(5, 16, 0) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0].map(Boolean);
    M.hatP = euclid(M.section === 'surge' ? 11 : 7, 16, Math.floor(r() * 3));
    M.bassP = euclid(5, 16, 2);
    M.fill = M.section === 'surge' && M.phraseBar === 3 && r() < 0.6;
    if (M.pendingRiser && M.phraseBar === 3) riser(t, stepDur() * 16);
    dly.l.delayTime.setTargetAtTime(stepDur() * 3, t, 0.1); dly.r.delayTime.setTargetAtTime(stepDur() * 3, t, 0.1);
    setDrive(0.15 + M.fever * 0.5 + (M.section === 'surge' ? 0.15 : 0));
  }
  function chooseSection(t) {
    const I = M.I, cur = M.section, r = M.r;
    let next = cur;
    if (M.theme === 'title') next = M.sectBars >= 16 ? (cur === 'drift' ? 'pulse' : 'drift') : cur;
    else if (I > 0.62) next = cur === 'surge' ? 'surge' : cur === 'break' ? 'surge' : 'break';
    else if (I > 0.28) next = cur === 'surge' && I > 0.5 ? 'surge' : 'pulse';
    else next = cur === 'surge' ? 'pulse' : 'drift';
    // long surges get a breakdown now and then
    if (cur === 'surge' && M.sectBars >= 16 && r() < 0.4) next = 'break';
    if (next !== cur) { if (next === 'surge' || (next === 'pulse' && cur === 'drift')) impact(t); M.section = next; M.sectBars = 0; M.pendingRiser = next === 'break'; }
    M.heart = M.theme !== 'title';
  }

  function melody(step, t, sd) {
    const S = M.section; if (S === 'break') return;
    const pb = M.phraseBar, pos = (pb % 2) * 16 + step;
    // A A' B A'': the motif, varied, then an answer, then the motif resolved
    let src = M.motif, shift = 0;
    if (pb === 1) shift = 1;
    else if (pb === 2) src = M.bMotif;
    if (S === 'drift' && M.bar % 8 >= 4) return; // leave space in the drift
    const list = src === M.bMotif ? src.filter(n => n.s === step) : src.filter(n => n.s === pos);
    for (const n of list) {
      let deg = n.deg + shift;
      if (n.strong || pb === 3) deg = snap(deg + M.chord.d, M.chord) - M.chord.d;
      if (pb === 3 && n === src[src.length - 1]) deg = 0;
      const midi = noteOf(deg + M.chord.d, 2);
      if (S === 'surge' && M.th.saw > 0.5) lead(t, midi, sd * n.l, 0.11);
      else bell(t, midi + (S === 'drift' ? 12 : 0), sd * n.l, S === 'drift' ? 0.12 : 0.14);
    }
  }

  // ── voices ───────────────────────────────────────────────────────
  function env(g, t, a, peak, d, sus, rel, end) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * sus, t + a, d);
    g.gain.setTargetAtTime(0.0001, end, rel);
  }
  function pan(node, p) { if (!c.createStereoPanner) return node; const s = c.createStereoPanner(); s.pan.value = p; node.connect(s); return s; }
  function send(node, rv, dl) { if (rv) { const g = c.createGain(); g.gain.value = rv; node.connect(g); g.connect(rev.input); } if (dl) { const g = c.createGain(); g.gain.value = dl; node.connect(g); g.connect(dly.in); } }

  function pad(t, ch, dur) {
    const cut = 500 + M.energy * 1800 + (M.section === 'surge' ? 900 : 0) - M.starve * 300;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(cut * 0.6, t); f.frequency.linearRampToValueAtTime(cut, t + dur * 0.5); f.frequency.linearRampToValueAtTime(cut * 0.7, t + dur);
    const g = c.createGain(); env(g, t, Math.min(1.8, dur * 0.3), 0.06, 1.2, 0.85, 0.9, t + dur);
    const hpf = c.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 140;
    f.connect(hpf); hpf.connect(g); g.connect(synth); send(g, 0.6, 0);
    const voices = lite ? 2 : 3, det = 9 + M.fever * 22;
    const tones = [ch.tones[0], ch.tones[1] + 7, ch.tones[2], ch.tones[3]];
    tones.forEach((dg, i) => {
      const hz = mtof(noteOf(dg, 1));
      for (let v = 0; v < voices; v++) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = (v - (voices - 1) / 2) * det + (Math.random() - 0.5) * 4;
        const p = pan(o, ((i + v) % 2 ? 1 : -1) * (0.25 + 0.2 * v)); p.connect(f);
        o.start(t); o.stop(t + dur + 4);
      }
    });
  }
  const drone = {
    start() {
      if (this.nodes) return;
      const g = c.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.025, c.currentTime, 4);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 2;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.04; lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      const os = [0, 7, 12].map((iv, i) => { const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = mtof(M.root + iv); o.detune.value = (i - 1) * 7; o.connect(f); o.start(); return o; });
      // wind: noise through a sweeping band
      const n = c.createBufferSource(); n.buffer = noise; n.loop = true; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.value = 500;
      const wl = c.createOscillator(), wg = c.createGain(); wl.frequency.value = 0.023; wg.gain.value = 380; wl.connect(wg); wg.connect(bp.frequency); wl.start();
      const ng = c.createGain(); ng.gain.value = 0.06; n.connect(bp); bp.connect(ng); ng.connect(g); n.start();
      f.connect(g); g.connect(synth); send(g, 0.7, 0);
      this.nodes = { g, os, f, n, lfo, wl };
    },
    retune() { if (!this.nodes) return; [0, 7, 12].forEach((iv, i) => this.nodes.os[i].frequency.setTargetAtTime(mtof(M.root + iv), c.currentTime, 2)); },
    level(v) { if (this.nodes) this.nodes.g.gain.setTargetAtTime(v, c.currentTime, 2); },
    stop() { if (!this.nodes) return; const N = this.nodes, t = c.currentTime; N.g.gain.setTargetAtTime(0.0001, t, 0.5); setTimeout(() => { try { N.os.forEach(o => o.stop()); N.n.stop(); N.lfo.stop(); N.wl.stop(); } catch (e) { /* already stopped */ } }, 3000); this.nodes = null; },
  };
  function bass(t, midi, dur, vol) {
    const hz = mtof(midi), f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    const top = 400 + M.energy * 700 + M.fever * 600;
    f.frequency.setValueAtTime(top * 2.2, t); f.frequency.exponentialRampToValueAtTime(Math.max(90, top * 0.4), t + dur * 0.9);
    const g = c.createGain(); env(g, t, 0.006, vol * 0.5, dur * 0.4, 0.7, 0.05, t + dur);
    [-0.25, 0.25].forEach(d => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz * (1 + d / 100); o.connect(f); o.start(t); o.stop(t + dur + 0.4); });
    const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = hz / 2; const sg = c.createGain(); sg.gain.value = 0.55; s.connect(sg); sg.connect(g); s.start(t); s.stop(t + dur + 0.4);
    f.connect(g); g.connect(synth);
  }
  function sub(t, midi, dur, vol) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const g = c.createGain(); env(g, t, 1.5, vol * 0.25, 2, 0.8, 1.2, t + dur);
    o.connect(g); g.connect(synth); o.start(t); o.stop(t + dur + 5);
  }
  function arp(t, midi, dur, vol) {
    const o = c.createOscillator(); o.type = M.th.saw > 0.8 ? 'sawtooth' : 'square'; o.frequency.value = mtof(midi);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 7;
    const top = 2200 + M.energy * 3800 + (M.section === 'surge' ? 1500 : 0);
    f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = c.createGain(); env(g, t, 0.003, vol * 0.4, dur * 0.3, 0.3, 0.04, t + dur);
    o.connect(f); f.connect(g); const p = pan(g, Math.sin(M.arpI * 1.3) * 0.5); p.connect(synth); send(p, 0.18, 0.28);
    o.start(t); o.stop(t + dur + 0.3);
  }
  function bell(t, midi, dur, vol) {
    // two-operator FM: an inharmonic bell with a soft glassy tail
    const hz = mtof(midi), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = hz; mod.frequency.value = hz * (M.th.bell > 1 ? 3.5 : 2.01);
    mg.gain.setValueAtTime(hz * 2.2 * M.th.bell, t); mg.gain.exponentialRampToValueAtTime(hz * 0.08, t + 1.2);
    mod.connect(mg); mg.connect(car.frequency);
    const len = Math.max(1.6, dur * 1.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    car.connect(g); const p = pan(g, (Math.random() - 0.5) * 0.7); p.connect(synth); send(p, 0.55, 0.45);
    car.start(t); mod.start(t); car.stop(t + len + 0.1); mod.stop(t + len + 0.1);
  }
  function lead(t, midi, dur, vol) {
    const hz = mtof(midi), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(2600 + M.energy * 2000, t + 0.08); f.frequency.setTargetAtTime(1400, t + 0.1, dur);
    env(g, t, 0.02, vol, 0.3, 0.7, 0.12, t + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(hz * 0.008, t + dur * 0.6); vib.connect(vg);
    [-7, 7].forEach(d => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(M.lastLead || hz, t); o.frequency.exponentialRampToValueAtTime(hz, t + 0.06); o.detune.value = d; vg.connect(o.frequency); o.connect(f); o.start(t); o.stop(t + dur + 0.8); });
    vib.start(t); vib.stop(t + dur + 0.8);
    f.connect(g); g.connect(synth); send(g, 0.35, 0.35);
    M.lastLead = hz;
  }
  function grain(t, midi, vol) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const g = c.createGain(), len = 0.08 + Math.random() * 0.25;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + len * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); const p = pan(g, Math.random() * 2 - 1); send(p, 0.9, 0.6); o.start(t); o.stop(t + len + 0.05);
  }
  function noiseHit(t, len, type, freq, q, vol, dest, rv) {
    const n = c.createBufferSource(); n.buffer = noise; n.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f); f.connect(g); g.connect(dest || drums); if (rv) send(g, rv, 0);
    n.start(t, Math.random() * 1.5); n.stop(t + len + 0.05);
    return g;
  }
  function kick(t, vol, soft) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(soft ? 90 : 150, t); o.frequency.exponentialRampToValueAtTime(soft ? 38 : 44, t + (soft ? 0.18 : 0.11));
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.5 : 0.42));
    o.connect(g); g.connect(drums); o.start(t); o.stop(t + 0.6);
    if (!soft) noiseHit(t, 0.012, 'highpass', 3000, 0.7, vol * 0.25);
    // the pump: synths duck under the kick and swell back
    pump.gain.cancelScheduledValues(t); pump.gain.setValueAtTime(soft ? 0.7 : 0.35, t); pump.gain.setTargetAtTime(1, t + 0.02, soft ? 0.12 : 0.09);
  }
  function snare(t, vol) {
    noiseHit(t, 0.2, 'bandpass', 1900, 0.8, vol * 0.5, drums, 0.5);
    const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(vol * 0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(g); g.connect(drums); o.start(t); o.stop(t + 0.2);
  }
  function rim(t, vol) { for (let i = 0; i < 3; i++) noiseHit(t + i * 0.011, 0.06, 'bandpass', 2400, 2, vol * (i === 2 ? 0.6 : 0.35), drums, 0.8); }
  function hat(t, vol, len) { noiseHit(t, len, 'highpass', 7200 + M.energy * 1500, 0.6, vol); }
  function stutter(t, sd) { for (let i = 0; i < 4; i++) noiseHit(t + i * sd / 4, sd / 5, 'bandpass', 900 + i * 700, 3, 0.12); }
  function riser(t, len) {
    const n = c.createBufferSource(); n.buffer = noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + len);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + len * 0.95); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
    n.connect(f); f.connect(g); g.connect(drums); send(g, 0.4, 0); n.start(t); n.stop(t + len + 0.1);
  }
  function impact(t) {
    kick(t, 1);
    noiseHit(t, 2.5, 'lowpass', 1800, 0.5, 0.18, drums, 0.9);
    const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(30, t + 2);
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2); o.connect(g); g.connect(drums); o.start(t); o.stop(t + 2.4);
  }
  function transitionSwell() {
    if (!M.on) return;
    const t = c.currentTime + 0.05; riser(t, 1.6); drone.retune();
  }

  // ── inputs from the game ─────────────────────────────────────────
  M.mood = function (energy, fever, starve) {
    M.energy += (energy - M.energy) * 0.02; M.fever += (fever - M.fever) * 0.02; M.starve = starve || 0;
    M.I += (M.Iraw - M.I) * 0.01;
    if (M.on) drone.level(0.014 + (M.section === 'drift' ? 0.016 : 0.004) + M.starve * 0.012);
  };
  M.intensity = function (v) { M.Iraw = Math.max(0, Math.min(1, v)); };
  // Victory or defeat: resolve to the tonic and fall back to the drift.
  M.cadence = function (won) {
    if (!M.on) return;
    const t = c.currentTime + 0.05;
    M.deg = won ? 0 : 5; M.chord = chordOf(M.deg); pad(t, M.chord, 6); M.section = 'drift'; M.sectBars = 0; M.Iraw = 0.1; M.I = 0.1;
    const seq = won ? [0, 2, 4, 7] : [4, 2, 1, 0];
    seq.forEach((d, i) => bell(t + i * 0.32, noteOf(d, 2), 1.4, 0.12));
  };
  E.Music = M;
})(window.E);
