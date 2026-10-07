// SPDX-License-Identifier: AGPL-3.0-only
// The title screen: a living word and the abyss behind it.
//
// LivingLogo: "OZYMANDOSIS" drawn as creatures. Every letter stroke is a spine
// with the creatures' three-layer glowing body, a chassis texture along it, and
// real organs from the organ library grown on it: mandibles and antennae for
// serifs at the heads, flagella trailing from the tails, legs, pili and
// photophores along the strokes. All 30 organs appear somewhere in the word.
// It breathes, a heartbeat ripples through it letter by letter, the strokes
// undulate a little, and its colour drifts through the six cultures' palettes.
// The letter skeletons stay fixed so the word always reads.
//
// MenuScene: the abyss with a fixed school of creatures (every chassis, every
// organ, every culture). They wander, turn back from well outside the screen,
// and never appear or vanish in view.
(function (E) {
  'use strict';
  const TAU = E.TAU;
  const WHITE = { r: 255, g: 255, b: 255 };

  // ── letter skeletons (cap height 60, y down) ─────────────────────
  // Stroke: { d: path commands, head: organ at the start, tail: organ at the end,
  // body: organs along it, skin: chassis texture }. Heads sit where serifs would.
  const ell = (cx, cy, rx, ry, a0, span) => { const p = []; for (let i = 0; i <= 64; i++) { const a = a0 + span * i / 64; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return p; };
  const GLYPHS = {
    O: { w: 58, strokes: [{ pts: ell(29, 30, 27, 29, -2.2, TAU - 0.42) }] },
    Z: { w: 46, strokes: [{ d: [['M', 3, 3], ['L', 43, 3], ['L', 3, 57], ['L', 43, 57]] }] },
    Y: { w: 52, strokes: [{ d: [['M', 3, 3], ['L', 26, 31], ['L', 26, 58]] }, { d: [['M', 49, 3], ['L', 26, 31]] }] },
    M: { w: 64, strokes: [{ d: [['M', 4, 58], ['L', 7, 3], ['L', 32, 44], ['L', 57, 3], ['L', 60, 58]] }] },
    A: { w: 56, strokes: [{ d: [['M', 3, 58], ['L', 28, 3], ['L', 53, 58]] }, { d: [['M', 14, 38], ['L', 42, 38]] }] },
    N: { w: 52, strokes: [{ d: [['M', 5, 58], ['L', 5, 3], ['L', 47, 57], ['L', 47, 2]] }] },
    D: { w: 52, strokes: [{ d: [['M', 5, 3], ['L', 5, 57]] }, { d: [['M', 5, 57], ['C', 62, 57, 62, 3, 5, 3]] }] }, // bowl's head at the foot: two heads at the top corner read as a T
    S: { w: 46, strokes: [{ d: [['M', 41, 11], ['C', 36, 1, 8, -1, 6, 15], ['C', 4, 28, 41, 29, 41, 44], ['C', 41, 61, 8, 62, 3, 50]] }] },
    I: { w: 18, strokes: [{ d: [['M', 9, 3], ['L', 9, 57]] }] },
  };
  // Organs per stroke, in word order: compact ones where a stroke faces a neighbouring
// letter, the showier ones on outer strokes. (Long struts and threads live in the school.)
  const WORD = 'OZYMANDOSIS';
  const DRESS = [
    [{ head: 'feelers', body: ['cilia'], skin: 'beads' }],                                        // O
    [{ head: 'nippers', tail: 'whiptail', body: ['thorn'], skin: 'plates' }],                    // Z
    [{ head: 'eyestalks', tail: 'corkscrew', body: ['fuzz'], skin: 'serpent' }, { head: 'plumes', body: ['combs'], skin: 'comb' }], // Y
    [{ head: 'pincers', tail: 'finveil', body: ['cilia', 'photophores'], skin: 'plates' }],     // M
    [{ head: 'sawjaw', tail: 'jetsiphon', body: ['grapnel'], skin: 'serpent' }, { head: 'whiskers', body: ['sporesacs'], skin: 'beads' }], // A
    [{ head: 'proboscis', tail: 'twinwhip', body: ['tubefeet'], skin: 'comb' }],                  // N
    [{ body: ['thorn'], skin: 'plates' }, { body: ['photophores'], skin: 'beads' }], // D: the most confusable letter stays clean
    [{ head: 'lures', body: ['photophores'], skin: 'comb' }],                                     // O
    [{ head: 'nematocyst', tail: 'stinger', body: ['fronds'], skin: 'serpent' }],                // S
    [{ head: 'nippers', body: ['cilia'], skin: 'plates' }],                                       // I
    [{ head: 'eyestalks', tail: 'whiptail', body: ['combs'], skin: 'beads' }],                    // S
  ];
  E.LOGO_ORGANS = [...new Set(DRESS.flat().flatMap(s => [s.head, s.tail, ...s.body].filter(Boolean)))];

  function flatten(st) {
    if (st.pts) return st.pts;
    const out = []; let x = 0, y = 0;
    for (const c of st.d) {
      if (c[0] === 'M') { x = c[1]; y = c[2]; out.push([x, y]); }
      else if (c[0] === 'L') { const n = 16; for (let i = 1; i <= n; i++) out.push([x + (c[1] - x) * i / n, y + (c[2] - y) * i / n]); x = c[1]; y = c[2]; }
      else if (c[0] === 'C') {
        const [, x1, y1, x2, y2, x3, y3] = c, n = 32;
        for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); }
        x = x3; y = y3;
      }
    }
    return out;
  }
  // Resample a polyline to n points evenly spaced along its length.
  function resample(p, n) {
    const L = [0]; for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const tot = L[L.length - 1], out = []; let j = 1;
    for (let k = 0; k < n; k++) {
      const s = tot * k / (n - 1);
      while (j < p.length - 1 && L[j] < s) j++;
      const f = (s - L[j - 1]) / Math.max(1e-6, L[j] - L[j - 1]);
      out.push({ x: p[j - 1][0] + (p[j][0] - p[j - 1][0]) * f, y: p[j - 1][1] + (p[j][1] - p[j - 1][1]) * f, s });
    }
    return { pts: out, len: tot };
  }

  class LivingLogo {
    // opts.word: draw part of the title (the app icon is its O); opts.pad: margin in cap-height units
    constructor(cv, opts) {
      opts = opts || {};
      this.cv = cv; this.ctx = cv.getContext('2d'); this.t = 0;
      this.GAP = 10; this.PAD = opts.pad !== undefined ? opts.pad : 30; this.H = 60;
      let x = 0; this.letters = [];
      const word = (opts.word || WORD).toUpperCase().replace(/[^OZYMANDSI]/g, '') || WORD;
      [...word].forEach((ch, wi) => {
        const li = word === WORD ? wi : WORD.indexOf(ch); // a letter keeps its own body plan wherever it appears
        const g = GLYPHS[ch], strokes = g.strokes.map((st, si) => {
          const raw = flatten(st), body = resample(raw, Math.max(18, Math.round(resample(raw, 200).len / 2.2)));
          const spine = resample(raw, 20);
          const dress = DRESS[li][si];
          return { body: body.pts, len: body.len, spine: spine.pts, dress, ph: li * 0.9 + si * 2.1 };
        });
        this.letters.push({ ch, x, w: g.w, cx: x + g.w / 2, cy: 30, strokes, li });
        x += g.w + this.GAP;
      });
      this.W = x - this.GAP;
      // sides: body organs grow outward from the letter's centre
      for (const L of this.letters) for (const s of L.strokes) {
        const m = s.spine[10], a = s.spine[9], b = s.spine[11], tx = a.x - b.x, ty = a.y - b.y, nx = -ty, ny = tx;
        s.side = ((m.x - (L.w / 2)) * nx + (m.y - 30) * ny) >= 0 ? 1 : -1;
        if (opts.flip) s.side = -s.side; // the app icon grows its cilia outward
      }
      this.cultures = E.CULTURE_LIST.map(c => c.colors);
    }
    size() {
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      return { w: r.width, h: r.height, dpr };
    }
    // colour at a position along the word: a slow drift through the cultures' palettes
    colors(u) {
      const n = this.cultures.length, f = ((this.t * 0.05 + u * 1.6) % n + n) % n, i = Math.floor(f), k = f - i, a = this.cultures[i], b = this.cultures[(i + 1) % n];
      const s = k * k * (3 - 2 * k);
      return { body: E.mix(a[0], b[0], s), acc: E.mix(a[1], b[1], s) };
    }
    frame(dt) {
      this.t += Math.min(dt, 0.1);
      const { w, h, dpr } = this.size(); if (w < 10) return;
      const ctx = this.ctx, t = this.t;
      const k = Math.min(w / (this.W + this.PAD * 2), h / (this.H + this.PAD * 2));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w - this.W * k) / 2, dpr * (h - this.H * k) / 2);
      const beatP = 2.2, bt = (t % beatP) / beatP; // the heartbeat travels left to right
      for (let li = 0; li < this.letters.length; li++) {
        const L = this.letters[li], u = this.letters.length > 1 ? li / (this.letters.length - 1) : 0;
        const wave = bt * 1.4 - u; const pulse = Math.exp(-Math.pow(wave / 0.07, 2)) + 0.5 * Math.exp(-Math.pow((wave - 0.13) / 0.07, 2));
        const breath = 1 + 0.016 * Math.sin(t * 1.15 + li * 0.55) + 0.02 * pulse;
        const { body, acc } = this.colors(u);
        const pal = { primary: body, accent: acc, bgCenter: { r: 4, g: 14, b: 18 }, bg: { r: 2, g: 6, b: 8 }, panic: 0, starve: 0, blighted: false, e: 0.5 + 0.3 * pulse };
        ctx.save(); ctx.translate(L.x + L.w / 2, 30); ctx.scale(breath, breath); ctx.translate(-(L.x + L.w / 2), -30); ctx.translate(L.x, 0);
        for (const s of L.strokes) this.drawStroke(ctx, s, t, body, acc, pal, pulse, k);
        ctx.restore();
      }
    }
    // live positions: a small travelling undulation across the stroke, never enough to break the letter
    live(pts, s, t, amp) {
      const out = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
        const q = pts[i].s !== undefined ? pts[i].s : i;
        const d = Math.sin(t * 2.3 - q * 0.11 + s.ph) * amp * Math.min(1, i / 3, (pts.length - 1 - i) / 3);
        out[i] = { x: pts[i].x - ty / l * d, y: pts[i].y + tx / l * d };
      }
      return out;
    }
    drawStroke(ctx, s, t, hc, acc, pal, pulse, k) {
      const P = this.live(s.body, s, t, 0.7), n = P.length, sz = 1.85;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // a body, not a tube: the seed's three glowing layers, tapering from head to tail
      const CH = 7, layer = (w, color) => {
        for (let c = 0; c < CH; c++) {
          const i0 = Math.floor(c * (n - 1) / CH), i1 = Math.floor((c + 1) * (n - 1) / CH), taper = 1 - 0.38 * ((c + 0.5) / CH);
          ctx.beginPath(); ctx.moveTo(P[i0].x, P[i0].y); for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(P[i].x, P[i].y);
          ctx.lineWidth = w * taper; ctx.strokeStyle = color; ctx.stroke();
        }
      };
      // a soft shadow keeps the word clear of what swims behind it
      layer(sz * 8, 'rgba(0,6,10,.28)');
      // organs sit beneath the body so the letter's line stays on top
      this.drawOrgans(ctx, s, t, hc, acc, pal);
      layer(sz * 9, E.rgba(hc, 0.1 + 0.08 * pulse));
      layer(sz * 4.4, E.rgba(hc, 0.3 + 0.15 * pulse));
      layer(Math.max(1.2 / k, sz * 2.2), E.rgba(E.mix(hc, WHITE, 0.3 + 0.25 * pulse), 0.95));
      this.skin(ctx, s, P, t, hc, acc, pulse);
      // the head: a creature's glowing crown, which reads as the letter's terminal
      const hp = P[0];
      E.drawGlow(ctx, hp.x, hp.y, sz * 5.5 * (1 + 0.3 * pulse), acc, 0.85);
      E.drawGlow(ctx, hp.x, hp.y, sz * 1.8, E.mix(acc, WHITE, 0.6), 0.9);
    }
    // chassis textures that ride along the stroke without blurring its line
    skin(ctx, s, P, t, hc, acc, pulse) {
      const n = P.length, kind = s.dress.skin;
      if (kind === 'beads') for (let i = 2; i < n - 1; i += 3) {
        const on = 0.5 + 0.5 * Math.sin(t * 3 - i * 0.5 + s.ph);
        ctx.fillStyle = E.rgba(E.mix(hc, WHITE, 0.5), 0.35 + 0.35 * on); ctx.beginPath(); ctx.arc(P[i].x, P[i].y, 1.2 + 0.6 * on, 0, TAU); ctx.fill();
      } else if (kind === 'plates') for (let i = 3; i < n - 2; i += 4) {
        const a = P[i - 1], b = P[i + 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save(); ctx.translate(P[i].x, P[i].y); ctx.rotate(ang);
        ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 4.6, 0, -Math.PI / 2, Math.PI / 2);
        ctx.strokeStyle = E.rgba(E.mix(hc, WHITE, 0.4), 0.55); ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore();
      } else if (kind === 'comb') for (let i = 1; i < n - 1; i += 2) {
        const on = Math.max(0, Math.sin(t * 6 - i * 0.7 + s.ph));
        ctx.fillStyle = `hsla(${(i * 23 + t * 90) % 360},95%,75%,${0.15 + 0.6 * on})`; ctx.fillRect(P[i].x - 0.8, P[i].y - 0.8, 1.6, 1.6);
      }
      void acc; void pulse;
    }
    drawOrgans(ctx, s, t, hc, acc, pal) {
      const spine = this.live(s.spine, s, t, 0.7), d = s.dress;
      const tier = [0, 3, 6, 9][Math.floor((t / 9 + s.ph) % 4)];
      // organs are drawn 1.4× life size: the spine is shrunk into a scaled frame so the letter stays put
      const K = 1.4, small = spine.map(p => ({ x: p.x / K, y: p.y / K }));
      const draw = (id, side, ph) => { const o = E.ORGANS[id]; if (!o) return; ctx.save(); ctx.scale(K, K); try { o.draw(ctx, small, side, { speed: 1, phase: ph }, t, tier, pal, hc); } catch (e) { /* a drawer failing must not blank the title */ } ctx.restore(); };
      ctx.save(); ctx.globalAlpha *= 0.78; // organs stay subordinate to the letter's line
      for (const id of d.body) draw(id, s.side, s.ph);
      if (d.tail) draw(d.tail, 1, s.ph + 0.7);
      if (d.head) { draw(d.head, 1, s.ph + 1.1); if (E.ORGANS[d.head] && E.ORGANS[d.head].cls !== 'pili') draw(d.head, -1, s.ph + 2.3); }
      ctx.restore();
      void acc;
    }
  }
  E.LivingLogo = LivingLogo;

  // ── the abyss and its school ─────────────────────────────────────
  class MenuScene {
    constructor(cv) {
      this.cv = cv; this.ctx = cv.getContext('2d'); this.t = 0; this.fish = []; this.dust = [];
      const r = E.RNG(1818), n = () => r.next();
      for (let i = 0; i < 70; i++) this.dust.push({ x: n(), y: n(), d: n(), ph: n() * TAU, sz: 0.6 + n() * 1.3 });
      this.caustics = Array.from({ length: 9 }, () => ({ x: n(), y: n(), r: 0.15 + n() * 0.25, ph: n() * TAU, sp: 0.2 + n() * 0.4 }));
      // a school that shows every chassis, every organ and every culture
      const chassis = E.CHASSIS_LIST.map(c => c.id), organs = E.ORGAN_LIST.map(o => o.id).sort(() => n() - 0.5), cultures = E.CULTURE_LIST.map(c => c.id);
      let oi = 0;
      const count = matchMedia('(max-width: 700px)').matches ? 10 : 15;
      for (let i = 0; i < count; i++) {
        const ch = E.CHASSIS[chassis[i % chassis.length]], take = Math.min(ch.slots, 2 + Math.floor(n() * 3)), org = [];
        for (let k = 0; k < take; k++) org.push(organs[oi++ % organs.length]);
        const design = { id: 'menu' + i, name: '', chassis: ch.id, organs: org };
        const cult = E.CULTURES[cultures[i % cultures.length]], tier = {};
        for (const c of E.CLASS_IDS) tier[c] = Math.floor(n() * 4);
        const st = E.computeStats(design, { tier, culture: cult.id });
        this.fish.push({ design, cult, tier, size: st.size, role: E.roleClass(st), x: n(), y: n(), a: n() * TAU, sp: 0.6 + n() * 0.6, wph: n() * TAU, depth: 0.55 + n() * 0.45, vis: null });
      }
    }
    frame(dt) {
      dt = Math.min(dt, 0.05); this.t += dt;
      const r = this.cv.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const W = Math.max(1, r.width), H = Math.max(1, r.height);
      if (this.cv.width !== Math.round(W * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
      const ctx = this.ctx, t = this.t;
      // the palette drifts through the cultures, slower than the title
      const cl = E.CULTURE_LIST, f = (t * 0.02) % cl.length, i0 = Math.floor(f), mixK = f - i0;
      const c0 = E.mix(cl[i0].colors[0], cl[(i0 + 1) % cl.length].colors[0], mixK);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.hypot(W, H) * 0.75);
      g.addColorStop(0, E.rgba(E.mix({ r: 6, g: 18, b: 24 }, c0, 0.1), 1)); g.addColorStop(0.55, E.rgba(E.mix({ r: 3, g: 8, b: 11 }, c0, 0.04), 1)); g.addColorStop(1, 'rgb(0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const c of this.caustics) {
        const x = (c.x + Math.sin(t * c.sp * 0.1 + c.ph) * 0.1) * W, y = (c.y + Math.cos(t * c.sp * 0.08 + c.ph) * 0.08) * H, rr = Math.hypot(W, H) * c.r;
        E.drawGlow(ctx, x, y, rr, E.mix(c0, WHITE, 0.4), 0.06, true);
      }
      for (const d of this.dust) {
        const x = ((d.x * W + Math.sin(t * 0.1 + d.ph) * 30 + t * (4 + d.d * 6)) % W + W) % W, y = ((d.y * H + Math.sin(t * 0.07 + d.ph) * 20) % H + H) % H;
        ctx.fillStyle = E.rgba(E.mix(c0, WHITE, 0.3), 0.12 + 0.25 * (1 - d.d)); ctx.beginPath(); ctx.arc(x, y, d.sz, 0, TAU); ctx.fill();
      }
      // world units: creatures drawn larger on big screens so their organs read
      const z = E.clamp(Math.min(W, H) / 420, 1.1, 2.2);
      const Wz = W / z, Hz = H / z, M = 90; // the school roams a margin beyond the screen
      ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
      const logo = { x: Wz / 2, y: Hz * 0.2, rx: Wz * 0.42, ry: Hz * 0.1 };
      for (const fsh of this.fish) {
        if (!fsh.init) {
          fsh.px = -M + fsh.x * (Wz + 2 * M); fsh.py = -M + fsh.y * (Hz + 2 * M); fsh.init = true;
          fsh.vis = E.makeVis(fsh.px, fsh.py, fsh.a, (E.CHASSIS[fsh.design.chassis].bodyLen) * fsh.size, 1 + fsh.x * 1000);
        }
        // wander, turn back from beyond the edges, and ease away from the title
        let want = fsh.a + Math.sin(t * 0.3 + fsh.wph) * 0.6;
        const out = fsh.px < -M * 0.6 ? 0 : fsh.px > Wz + M * 0.6 ? Math.PI : fsh.py < -M * 0.6 ? Math.PI / 2 : fsh.py > Hz + M * 0.6 ? -Math.PI / 2 : null;
        if (out !== null) want = out;
        const dx = (fsh.px - logo.x) / logo.rx, dy = (fsh.py - logo.y) / logo.ry;
        if (dx * dx + dy * dy < 1.4) want = Math.atan2(dy, dx);
        fsh.a += E.clamp(E.angWrap(want - fsh.a), -0.9 * dt, 0.9 * dt);
        const v = 22 * fsh.sp;
        fsh.px += Math.cos(fsh.a) * v * dt; fsh.py += Math.sin(fsh.a) * v * dt;
        E.advanceVis(fsh.vis, fsh.px, fsh.py, dt);
        const pts = E.buildPts(fsh.vis, fsh.px, fsh.py, t, fsh.size);
        const pal = E.palette(fsh.cult, 0.45 + 0.2 * Math.sin(t * 0.4 + fsh.wph), 0, 100, false);
        E.drawCreature(ctx, fsh.vis, pts, { design: fsh.design, tier: fsh.tier, hc: E.creatureColor(fsh.cult, pal, fsh.vis.indiv, fsh.vis.phase, t), pal, t, alpha: 0.55 + 0.35 * fsh.depth, lod: 0, size: fsh.size, role: fsh.role });
      }
    }
  }
  E.MenuScene = MenuScene;
})(window.E);
