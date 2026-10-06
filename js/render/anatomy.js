// SPDX-License-Identifier: AGPL-3.0-only
// Living structures. Every Nucleus, Bud and Spire is an organism: an
// asymmetric membrane of fused lobes that breathes, a heart that beats with
// the colony's energy and fever, veins that carry the pulse to organs grown
// from the same organ library as the creatures (at the colony's research
// tier), and a signature anatomy drawn from the culture's prime attribute:
//   Verdant    economy     roots that seek the nearest pools and drink
//   Luminant   evolution   a golden nautilus shell, tracking eye-stalks, lanterns
//   Current    mobility    a vortex of trailing flagella, comb-rows, jet pulses
//   Choir      sensing     long sweeping antennae, song rings, chasing photophores
//   Seethe     parasitism  a toothed maw, clustered eyes, hooked tethers that reach
//   Bloom      aggression  carapace plates, spikes, egg sacs that swell and burst
//
// The drawing is backend independent: it talks to an adapter D with
//   D.glow(x, y, r, kind, c, a, p0, p1)       under the bodies (kinds as GlowBatch)
//   D.glowTop(x, y, r, kind, c, a, p0, p1)    over the bodies
//   D.seg(x0, y0, x1, y1, s, prof, c, a, wk)  capsule (prof 0 = creature body glow, 1 = line)
//   D.poly(P, n, closed, s0, s1, prof, c, a, wk)  polyline of n points in flat array P
//   D.organ(id, x, y, rot, sc, ti, side, ph, speed, t, body, acc, a)
//   D.z (zoom), D.lod (0 full, 1 reduced, 2 minimal), D.seen(x, y)
(function (E) {
  'use strict';
  const TAU = E.TAU, PI = Math.PI;
  const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 }, GOLD = { r: 255, g: 214, b: 110 }, BLOOD = { r: 150, g: 20, b: 60 };

  // Organs grown on each structure (rim order is shuffled per individual), the
  // head organ of the Spire's striking neck, and the signature feature.
  const SPEC = {
    verdant: { feature: 'roots', turret: 'lures',
      organs: { nucleus: ['fronds', 'fuzz', 'fronds', 'sporesacs', 'fuzz', 'combs', 'fronds'], bud: ['fronds', 'fuzz', 'sporesacs'], spire: ['thorn', 'fuzz'] } },
    luminant: { feature: 'shell', turret: 'eyestalks',
      organs: { nucleus: ['plumes', 'lures', 'horns', 'plumes', 'sporesacs'], bud: ['plumes', 'lures'], spire: ['plumes'] } },
    current: { feature: 'vortex', turret: 'sawjaw',
      organs: { nucleus: ['jetsiphon', 'finveil', 'combs', 'twinwhip', 'finveil', 'corkscrew'], bud: ['finveil', 'jetsiphon'], spire: ['finveil'] } },
    choir: { feature: 'song', turret: 'whiskers',
      organs: { nucleus: ['photophores', 'whiskers', 'horns', 'plumes', 'photophores'], bud: ['photophores', 'whiskers'], spire: ['photophores'] } },
    umbral: { feature: 'maw', turret: 'proboscis',
      organs: { nucleus: ['tether', 'grapnel', 'venom', 'thorn', 'tether', 'grapnel'], bud: ['tether', 'grapnel'], spire: ['grapnel'] } },
    bloom: { feature: 'carapace', turret: 'pincers',
      organs: { nucleus: ['pincers', 'thorn', 'sawjaw', 'pincers', 'stinger', 'sporesacs'], bud: ['pincers', 'thorn'], spire: ['thorn'] } },
  };
  E.STRUCT_SPEC = SPEC;
  const KIND_I = { nucleus: 0, bud: 1, spire: 2 };
  const LOBES = { nucleus: [2, 3], bud: [1, 2], spire: [0, 1] };

  // ── genome: the fixed, per-individual body plan ─────────────────────
  const genomes = new Map();
  function anchorOf(id) {
    const o = E.ORGANS[id]; if (!o) return 'body';
    if (o.cls === 'flagella') return 'tail';
    if (id === 'photophores') return 'body';
    if (id === 'lures') return 'head';
    return o.cls === 'mandible' || o.cls === 'antenna' ? 'head' : 'body';
  }
  E.organAnchor = anchorOf;
  function genome(b, cult, view) {
    const key = b.id * 8 + KIND_I[b.kind] + cult.idx * 1e7;
    let g = genomes.get(key);
    if (g) return g;
    if (genomes.size > 600) genomes.clear();
    const r = E.RNG(b.id * 9973 + cult.idx * 131 + KIND_I[b.kind] * 17 + 5), n = () => r.next(), sg = () => (n() < 0.5 ? -1 : 1);
    const spec = SPEC[cult.id] || SPEC.verdant;
    g = { ph: n() * TAU, turn: sg(), harm: [], lobes: [], organs: [], motes: [], wounds: [], eyes: [], roots: [], extra: [] };
    // silhouette: three low harmonics, one of them lopsided
    for (let i = 0; i < 3; i++) g.harm.push({ k: [2, 3, 5][i] + (i === 2 && n() < 0.5 ? 1 : 0), a: [0.07, 0.05, 0.025][i] * (0.6 + n() * 0.8), ph: n() * TAU, w: (0.12 + n() * 0.2) * sg() });
    const [l0, l1] = LOBES[b.kind], nl = l0 + Math.floor(n() * (l1 - l0 + 1));
    const lobeBase = n() * TAU;
    for (let i = 0; i < nl; i++) g.lobes.push({ a: lobeBase + (i * 2.1 + (n() - 0.5) * 0.9), d: 0.72 + n() * 0.2, r: 0.36 + n() * 0.2, ph: n() * TAU, k: 2 + Math.floor(n() * 2) });
    // heart sits off-centre, toward the biggest lobe
    const bl = g.lobes[0];
    g.heart = bl ? { a: bl.a, d: 0.18 + n() * 0.12 } : { a: n() * TAU, d: n() * 0.12 };
    // organs: uneven spacing, varied sizes, the odd one grown larger
    const list = spec.organs[b.kind].slice();
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(n() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const oa0 = n() * TAU;
    list.forEach((id, i) => g.organs.push({ id, a: oa0 + (i + (n() - 0.5) * 0.55) / list.length * TAU, sc: 0.8 + n() * 0.35 + (i === 0 ? 0.25 : 0), ph: n() * TAU, sp: 0.7 + n() * 0.6, anchor: anchorOf(id) }));
    for (let i = 0; i < 9; i++) g.motes.push({ a: n() * TAU, d: 0.15 + n() * 0.6, w: (0.15 + n() * 0.35) * sg(), ph: n() * TAU, s: 0.8 + n() * 1.2 });
    for (let i = 0; i < 4; i++) g.wounds.push({ a: n() * TAU, d: 0.3 + n() * 0.5, s: 0.25 + n() * 0.2 });
    // culture signature parameters
    const f = spec.feature, big = b.kind === 'nucleus' ? 1 : b.kind === 'bud' ? 0.7 : 0.45;
    if (f === 'roots') {
      // aim at the nearest pools; the rest wander
      const pools = view ? view.s.pools.map(p => ({ p, d: Math.hypot(p.x - b.x, p.y - b.y) })).filter(o => o.d < 700 && o.d > 20).sort((a, c) => a.d - c.d).slice(0, 3) : [];
      const nr = Math.max(pools.length, Math.round(2 + big * 3));
      for (let i = 0; i < nr; i++) {
        const pl = pools[i];
        g.roots.push({ a: pl ? Math.atan2(pl.p.y - b.y, pl.p.x - b.x) + (n() - 0.5) * 0.2 : n() * TAU, len: pl ? Math.min(pl.d * 0.55, 3.2) : 1.4 + n() * 1.2, reach: !!pl, ph: n() * TAU, br: 0.35 + n() * 0.3, pd: pl ? pl.d : 0 });
      }
    } else if (f === 'shell') {
      g.shell = { a: n() * TAU, d: 0.18 + n() * 0.12, turns: 1.55 + n() * 0.35, sc: 0.8 + n() * 0.15 };
      for (let i = 0; i < 2 + Math.round(big * 2); i++) g.eyes.push({ a: g.shell.a + PI + (n() - 0.5) * 2.2, len: 0.55 + n() * 0.6, r: 0.13 + n() * 0.08, ph: n() * TAU });
      for (let i = 0; i < 3; i++) g.extra.push({ rx: 1.25 + n() * 0.5, ry: 0.7 + n() * 0.4, rot: n() * TAU, w: (0.3 + n() * 0.3) * sg(), ph: n() * TAU });
    } else if (f === 'vortex') {
      const nt = 3 + Math.round(big * 3);
      for (let i = 0; i < nt; i++) g.extra.push({ a: (i + n() * 0.6) / nt * TAU, len: 1.3 + n() * 1.4, curl: (0.5 + n() * 0.5), ph: n() * TAU, w: 0.5 + n() * 0.4 });
      g.combs = 3 + Math.round(big * 3);
    } else if (f === 'song') {
      const na = 2 + Math.round(big * 2);
      for (let i = 0; i < na; i++) g.extra.push({ a: n() * TAU, len: 2.2 + n() * 1.6, sw: 0.25 + n() * 0.35, ph: n() * TAU, w: 0.25 + n() * 0.3 });
      g.phot = 8 + Math.round(big * 8);
    } else if (f === 'maw') {
      g.teeth = 9 + Math.round(big * 6); g.maw = { x: (n() - 0.5) * 0.25, y: (n() - 0.5) * 0.25 };
      const side = n() * TAU, ne = 2 + Math.round(big * 3);
      for (let i = 0; i < ne; i++) g.eyes.push({ a: side + (n() - 0.5) * 1.3, d: 0.6 + n() * 0.25, r: 0.09 + n() * 0.1 * (i === 0 ? 2 : 1), ph: n() * TAU });
      for (let i = 0; i < 1 + Math.round(big * 3); i++) g.extra.push({ a: n() * TAU, len: 1.5 + n() * 1.3, ph: n() * TAU, hook: sg() });
    } else if (f === 'carapace') {
      const np = 4 + Math.round(big * 4), a0 = n() * TAU;
      for (let i = 0; i < np; i++) g.extra.push({ a: a0 + (i + (n() - 0.5) * 0.4) / np * TAU, span: (0.55 + n() * 0.35) / np * TAU, d: 0.78 + n() * 0.12 });
      g.spikes = []; const ns = 6 + Math.round(big * 8);
      for (let i = 0; i < ns; i++) g.spikes.push({ a: n() * TAU, len: 0.25 + n() * 0.45, ph: n() * TAU });
      g.eggs = []; const ea = n() * TAU, ne = 2 + Math.round(big * 4);
      for (let i = 0; i < ne; i++) g.eggs.push({ a: ea + (n() - 0.5) * 1.2, d: 0.35 + n() * 0.35, r: 0.1 + n() * 0.08, ph: n() * TAU, per: 5 + n() * 7 });
    }
    genomes.set(key, g);
    return g;
  }

  // ── per-frame helpers ──────────────────────────────────────────────
  const P = new Float32Array(160);
  function radAt(g, th, t, st) {
    let r = 1;
    for (const h of g.harm) r += h.a * Math.sin(h.k * th + h.ph + t * h.w);
    r += 0.03 * Math.sin(th * 2 - t * 0.9 + g.ph) * st.breath;   // peristalsis
    r += 0.05 * st.pulse * (0.6 + 0.4 * Math.cos(th - g.heart.a)); // the heartbeat pushes the near wall hardest
    r -= 0.1 * st.hurt;
    if (st.tremor) r += st.tremor * 0.035 * Math.sin(th * 7 + t * 23);
    return r;
  }
  // closed membrane loop
  function membrane(D, cx, cy, R, fn, n, s, c, a, wk) {
    for (let i = 0; i < n; i++) { const th = i / n * TAU, r = R * fn(th); P[i * 2] = cx + Math.cos(th) * r; P[i * 2 + 1] = cy + Math.sin(th) * r; }
    D.poly(P, n, true, s, s, 0, c, a, wk);
  }
  // a swaying, tapering tendril; returns its tip
  function tendril(D, x, y, ang, len, n, s0, s1, c, a, amp, k, ph, bend) {
    let px = x, py = y, pa = ang;
    P[0] = x; P[1] = y;
    const step = len / n;
    for (let i = 1; i <= n; i++) {
      const q = i / n;
      pa = ang + (bend || 0) * q + Math.sin(ph + q * k) * amp * q;
      px += Math.cos(pa) * step; py += Math.sin(pa) * step;
      P[i * 2] = px; P[i * 2 + 1] = py;
    }
    D.poly(P, n + 1, false, s0, s1, 0, c, a, 1);
    return { x: px, y: py, a: pa };
  }
  const beatAt = f => Math.exp(-Math.pow(f / 0.07, 2)) + 0.55 * Math.exp(-Math.pow((f - 0.2) / 0.07, 2)) + Math.exp(-Math.pow((f - 1) / 0.07, 2));

  // Renderer-side state that the simulation never sees (hurt flinch, aim easing, recoil).
  function stateOf(R, b, t) {
    const m = R.structVis || (R.structVis = new Map());
    let s = m.get(b.id);
    if (!s) { s = { hp: b.hp, hurtT: -9, fireT: -9, aim: 0, look: 0, near: null, nearT: 0, born: t }; m.set(b.id, s); if (m.size > 400) for (const [k, v] of m) if (t - v.seenT > 30) m.delete(k); }
    s.seenT = t;
    if (b.hp < s.hp - 0.5) s.hurtT = t;
    s.hp = b.hp;
    return s;
  }
  // nearest visible creature (foe first) for eyes and tethers, refreshed a few times a second
  function nearest(R, view, b, range, t, st) {
    if (t - st.nearT < 0.35 && t >= st.nearT) return st.near;
    st.nearT = t; st.near = null;
    const lance = b.lance && view.byId.get(b.lance);
    if (lance && lance.hp > 0) { st.near = lance; st.foe = true; return lance; }
    let best = null, bd = range * range;
    for (const u of view.s.units) {
      const dx = u.x - b.x, dy = u.y - b.y, d = dx * dx + dy * dy;
      if (d < bd && (u.o === R.local || R.seen(u.x, u.y))) { bd = d; best = u; }
    }
    st.near = best; st.foe = false;
    return best;
  }
  const easeAng = (cur, want, k) => cur + E.angWrap(want - cur) * k;

  // ── the organism ───────────────────────────────────────────────────
  E.drawStructure = function (D, R, view, b, pal, t, opts) {
    const p = view.s.players[b.o], cult = E.CULTURES[p.culture], sd = E.STRUCTS[b.kind];
    const g = genome(b, cult, view), st = stateOf(R, b, t), spec = SPEC[cult.id] || SPEC.verdant;
    const A = opts.alpha, lod = D.lod, z = D.z;
    const grow = b.build < 1 ? 0.35 + 0.65 * Math.sqrt(Math.max(0, b.build)) : 1;
    const Rr = sd.r * grow, x = b.x, y = b.y;
    const hpF = E.clamp(b.hp / sd.hp, 0, 1);
    // life signals
    const rate = (1.4 + p.energy * 3 + p.fever * 4) / TAU;
    const bf = ((t * rate + g.ph / TAU) % 1 + 1) % 1, pulse = beatAt(bf);
    const hurt = Math.max(0, 1 - (t - st.hurtT) / 0.35);
    const vars = { breath: 1, pulse: pulse * (b.build < 1 ? 0.4 : 1), hurt, tremor: hpF < 0.5 ? (0.5 - hpF) * 2 : 0 };
    const hc = E.creatureColor(cult, pal, (b.id % 7) / 7, g.ph, t);
    const acc = pal.accent, dark = E.mix(hc, BLACK, 0.55);
    const sk = Math.sqrt(sd.r / 38), s = 1.05 * sk;
    const rad = th => radAt(g, th, t, vars);
    const at = (th, k) => { const r = Rr * rad(th) * (k || 1); return { x: x + Math.cos(th) * r, y: y + Math.sin(th) * r }; };
    const heart = { x: x + Math.cos(g.heart.a) * g.heart.d * Rr, y: y + Math.sin(g.heart.a) * g.heart.d * Rr };

    // cytoplasm
    D.glow(x, y, Rr * 1.35, 8, E.mix(hc, BLACK, 0.25), 0.5 * A);
    D.glow(x, y, Rr * 1.05, 0, hc, 0.3 * A);
    D.glow(heart.x, heart.y, Rr * 1.05, 0, acc, (0.28 + 0.18 * pulse) * A);
    if (lod >= 2) {
      membrane(D, x, y, Rr, rad, 10, s * 1.3, hc, 0.9 * A, 1.3);
      D.glowTop(heart.x, heart.y, Rr * 0.5 * (0.85 + 0.3 * pulse), 1, acc, 0.95 * A);
      return;
    }
    const seg = lod ? 18 : 30;
    // signature anatomy that lies beneath the membrane (roots, flagella, antennae, tethers)
    const F = FEATURES[spec.feature];
    const fctx = { D, R, view, b, g, st, t, x, y, Rr, rad, at, hc, acc, dark, pal, A, lod, z, pulse, bf, s, sk, heart, cult, p, hpF, grow };
    if (F.under && b.build >= 0.3) F.under(fctx);
    // lobes fused to the main body
    for (const L of g.lobes) {
      const la = L.a + Math.sin(t * 0.21 + L.ph) * 0.06, lr = Rr * L.r * (1 + 0.06 * Math.sin(t * 0.8 + L.ph) + 0.05 * pulse);
      const lc = at(la, L.d);
      D.glow(lc.x, lc.y, lr * 1.3, 8, E.mix(hc, BLACK, 0.3), 0.35 * A);
      membrane(D, lc.x, lc.y, lr, th => 1 + 0.08 * Math.sin(L.k * th + L.ph + t * 0.5) - 0.12 * hurt, lod ? 12 : 18, s * 0.8, E.mix(hc, acc, 0.15), 0.8 * A, 1);
      D.glowTop(lc.x, lc.y, lr * 0.32, 4, E.mix(acc, WHITE, 0.2), (0.3 + 0.25 * Math.sin(t * 1.3 + L.ph)) * A);
    }
    // the main membrane, doubled for a living cell wall
    membrane(D, x, y, Rr, rad, seg, s, hc, 0.95 * A, 1.2);
    if (!lod) membrane(D, x, y, Rr * 0.9, th => rad(th) * (1 - 0.02 * Math.sin(th * 4 + t * 1.7)), seg, s * 0.35, E.mix(hc, acc, 0.4), 0.35 * A, 0.6);
    // veins: heart → organ anchors, a pulse racing out after each beat
    const vt = bf * 1.6;
    for (let i = 0; i < g.organs.length; i++) {
      const o = g.organs[i], q = at(o.a, 0.86);
      const mx = (heart.x + q.x) / 2 + Math.sin(o.ph + t * 0.4) * Rr * 0.12, my = (heart.y + q.y) / 2 + Math.cos(o.ph + t * 0.4) * Rr * 0.12;
      P[0] = heart.x; P[1] = heart.y; P[2] = mx; P[3] = my; P[4] = q.x; P[5] = q.y;
      D.poly(P, 3, false, 0.45 * sk, 0.3 * sk, 1, E.mix(acc, hc, 0.4), 0.3 * A);
      if (vt < 1 && !lod) { const f = vt, ix = (1 - f) * (1 - f) * heart.x + 2 * (1 - f) * f * mx + f * f * q.x, iy = (1 - f) * (1 - f) * heart.y + 2 * (1 - f) * f * my + f * f * q.y; D.glowTop(ix, iy, 2.4 * sk, 1, acc, (1 - f) * 0.9 * A); }
    }
    // organelles adrift
    if (!lod) for (const m of g.motes) {
      const a = m.a + t * m.w, d = Rr * m.d * (0.9 + 0.1 * Math.sin(t * 0.7 + m.ph));
      D.glowTop(x + Math.cos(a) * d, y + Math.sin(a) * d, m.s * sk, 4, E.mix(hc, WHITE, 0.45), (0.35 + 0.25 * Math.sin(t * 2 + m.ph)) * A);
    }
    // organs on the rim, at the colony's tier
    if (lod === 0 || z > 0.22) {
      const n = g.organs.length, shown = b.build < 1 ? Math.floor(n * b.build) : n;
      const osc = sk * (b.kind === 'spire' ? 0.95 : b.kind === 'bud' ? 1.2 : 1.4) * (hpF < 0.35 ? 0.9 : 1);
      for (let i = 0; i < shown; i++) {
        const o = g.organs[i], org = E.ORGANS[o.id]; if (!org) continue;
        const ti = p.tier[org.cls] || 0, th = o.a + Math.sin(t * 0.35 + o.ph) * 0.05, q = at(th, 0.97), sc = osc * o.sc;
        const oa = A * (hpF < 0.35 ? 0.75 : 1);
        if (o.anchor === 'head') { D.organ(o.id, q.x, q.y, th, sc, ti, 1, o.ph, o.sp, t, hc, acc, oa); D.organ(o.id, q.x, q.y, th, sc, ti, -1, o.ph + 1.3, o.sp, t, hc, acc, oa); }
        else if (o.anchor === 'tail') D.organ(o.id, q.x, q.y, th + PI, sc, ti, 1, o.ph, o.sp, t, hc, acc, oa);
        else D.organ(o.id, q.x, q.y, th - PI / 2, sc, ti, 1, o.ph, o.sp, t, hc, acc, oa);
      }
    }
    if (F.over) F.over(fctx);
    // spire: a striking neck that tracks its target and recoils when it fires
    if (b.kind === 'spire') turret(fctx, spec.turret);
    // nuclear envelope around the heart
    if (!lod && b.kind !== 'spire') membrane(D, heart.x, heart.y, Rr * 0.3 * (0.92 + 0.12 * pulse), th => 1 + 0.08 * Math.sin(3 * th + t * 0.8 + g.ph), 14, 0.4 * sk, E.mix(acc, WHITE, 0.35), 0.55 * A, 0.8);
    // heart and nucleolus
    const hr = Rr * (b.kind === 'spire' ? 0.42 : 0.34) * (0.85 + 0.3 * pulse);
    D.glowTop(heart.x, heart.y, hr * 1.9, 1, acc, (0.75 + 0.2 * pulse) * A);
    if (!lod) D.glowTop(heart.x, heart.y, hr * 1.25, 2, E.mix(acc, WHITE, 0.3), 0.5 * A, 1.2);
    // wounds open as health falls
    if (hpF < 0.8) for (let i = 0; i < Math.min(4, Math.ceil((0.8 - hpF) * 5)); i++) {
      const w = g.wounds[i], q = at(w.a, w.d);
      D.glowTop(q.x, q.y, Rr * w.s, 8, E.mix(BLOOD, BLACK, 0.4), 0.55 * A);
      D.glowTop(q.x, q.y, Rr * w.s * 0.5, 1, { r: 255, g: 90, b: 90 }, (0.25 + 0.2 * Math.sin(t * 6 + i)) * A);
    }
    if (hurt > 0) D.glowTop(x, y, Rr * 1.5, 0, { r: 255, g: 120, b: 120 }, hurt * 0.35 * A);
  };

  function turret(c, head) {
    const { D, R, view, b, st, t, x, y, Rr, hc, acc, A, sk, p, lod } = c;
    const tg = b.lance && view.byId.get(b.lance);
    const idle = Math.sin(t * 0.4 + b.id) * 1.4 + t * 0.15;
    const want = tg ? Math.atan2(tg.y - y, tg.x - x) : idle;
    st.aim = easeAng(st.aim, want, tg ? 0.25 : 0.03);
    const since = t - st.fireT, recoil = since >= 0 && since < 0.45 ? Math.sin(Math.min(1, since / 0.45) * PI) * (since < 0.08 ? since / 0.08 : 1) : 0;
    const len = Rr * (1.35 - 0.55 * recoil + 0.06 * Math.sin(t * 2.2 + b.id));
    const bend = Math.sin(t * 1.1 + b.id) * 0.25 * (tg ? 0.3 : 1);
    const tip = tendril(D, x, y, st.aim - bend * 0.5, len, lod ? 5 : 8, 1.25 * sk, 0.8 * sk, hc, 0.95 * A, 0.12, 3, t * 2, bend);
    const org = E.ORGANS[head], ti = org ? p.tier[org.cls] || 0 : 0;
    D.organ(head, tip.x, tip.y, tip.a, 1.05 * sk, ti, 1, 0.3, 1.4, t, hc, acc, A);
    D.organ(head, tip.x, tip.y, tip.a, 1.05 * sk, ti, -1, 1.6, 1.4, t, hc, acc, A);
    D.glowTop(tip.x, tip.y, (4 + 5 * recoil) * sk, 1, acc, (0.7 + 0.3 * recoil) * A);
    // cnidocyte ring: stinging cells light up in a chase when a target is near
    if (!lod) for (let i = 0; i < 10; i++) {
      const th = i / 10 * TAU, q = c.at(th, 1.12), on = tg ? 0.5 + 0.5 * Math.sin(t * 9 - i * 1.2) : 0.25 + 0.15 * Math.sin(t * 1.5 + i);
      D.glowTop(q.x, q.y, 1.4 * sk, 4, E.mix(acc, WHITE, 0.3), on * A);
    }
  }

  // ── signatures ─────────────────────────────────────────────────────
  const FEATURES = {
    // Verdant: roots that reach toward the nearest pools; nutrients pulse home along them.
    roots: {
      under(c) {
        const { D, g, t, Rr, at, hc, acc, A, sk, lod, b } = c;
        for (const r of g.roots) {
          const base = at(r.a, 0.92), len = Rr * r.len * (b.build < 1 ? b.build : 1);
          const tip = tendril(D, base.x, base.y, r.a, len, lod ? 5 : 9, 1.1 * sk, 0.25 * sk, E.mix(hc, { r: 120, g: 90, b: 40 }, 0.25), 0.85 * c.A, 0.35, 5, r.ph + t * 0.25, 0);
          if (!lod) {
            // a side branch and a root cap
            const bx = base.x + (tip.x - base.x) * r.br, by = base.y + (tip.y - base.y) * r.br;
            tendril(D, bx, by, r.a + (r.ph > PI ? 0.9 : -0.9), len * 0.35, 4, 0.55 * sk, 0.15 * sk, hc, 0.6 * A, 0.4, 4, r.ph * 2 + t * 0.3, 0);
            D.glowTop(tip.x, tip.y, 3.2 * sk, 1, r.reach ? { r: 180, g: 255, b: 255 } : acc, 0.55 * A);
            // nutrients drawn home
            for (let k = 0; k < 3; k++) { const f = 1 - ((t * 0.35 + k / 3 + r.ph) % 1); D.glowTop(base.x + (tip.x - base.x) * f, base.y + (tip.y - base.y) * f, 1.8 * sk, 1, r.reach ? { r: 200, g: 255, b: 255 } : acc, 0.7 * Math.sin(f * PI) * A); }
          }
        }
      },
      over(c) {
        const { D, g, t, at, acc, A, sk, lod } = c;
        if (lod) return;
        // seed pods ripening on the lobes
        g.lobes.forEach((L, i) => { const q = at(L.a + 0.35, L.d + L.r * 0.6), sw = 0.5 + 0.5 * Math.sin(t * 0.6 + L.ph); D.glowTop(q.x, q.y, (3 + 2.5 * sw) * sk, 1, E.mix(acc, GOLD, 0.4), (0.5 + 0.4 * sw) * A); D.glowTop(q.x, q.y, (5 + 3 * sw) * sk, 2, acc, 0.5 * A, 1); });
      },
    },
    // Luminant: a golden nautilus shell grown over one flank, eye-stalks that watch, lanterns in orbit.
    shell: {
      under(c) {
        const { D, g, t, x, y, Rr, acc, A, sk, lod } = c;
        const sh = g.shell, cx = x + Math.cos(sh.a) * sh.d * Rr, cy = y + Math.sin(sh.a) * sh.d * Rr;
        const gold = E.mix(GOLD, acc, 0.35), n = lod ? 22 : 44, k = 0.2, r0 = Rr * 0.06, rot = sh.a + t * 0.02;
        let m = 0;
        for (let i = 0; i <= n; i++) { const th = i / n * sh.turns * TAU, r = r0 * Math.exp(k * th) * sh.sc; if (r > Rr * 0.95) break; P[m * 2] = cx + Math.cos(th + rot) * r; P[m * 2 + 1] = cy + Math.sin(th + rot) * r; m++; }
        D.poly(P, m, false, 0.7 * sk, 1.3 * sk, 0, gold, 0.9 * A, 1);
        if (!lod) for (let i = 1; i < 9; i++) { const th = i / 9 * sh.turns * TAU, r = r0 * Math.exp(k * th) * sh.sc; if (r > Rr * 0.95) break; D.seg(cx, cy, cx + Math.cos(th + rot) * r, cy + Math.sin(th + rot) * r, 0.35 * sk, 1, gold, 0.35 * A); }
        D.glow(cx, cy, Rr * 0.7, 0, GOLD, 0.25 * A);
      },
      over(c) {
        const { D, R, view, b, g, st, t, x, y, Rr, at, hc, acc, A, sk, lod } = c;
        const tg = nearest(R, view, b, Rr * 9, t, st);
        const want = tg ? Math.atan2(tg.y - y, tg.x - x) : Math.sin(t * 0.3 + b.id) * 2;
        st.look = easeAng(st.look, want, 0.06);
        for (const e of g.eyes) {
          const base = at(e.a, 0.95), bend = E.angWrap(st.look - e.a) * 0.35;
          const tip = tendril(D, base.x, base.y, e.a, Rr * e.len, 5, 0.8 * sk, 0.55 * sk, hc, 0.9 * A, 0.15, 3, t * 0.8 + e.ph, bend);
          eye(D, tip.x, tip.y, Rr * e.r, st.look, t, e.ph, acc, A, !!(tg && st.foe));
        }
        if (!lod) for (const L of g.extra) {
          const a = t * L.w + L.ph, ex = Math.cos(a) * Rr * L.rx, ey = Math.sin(a) * Rr * L.ry, cr = Math.cos(L.rot), sr = Math.sin(L.rot);
          const lx = x + ex * cr - ey * sr, ly = y + ex * sr + ey * cr;
          D.glowTop(lx, ly, 3 * sk, 1, GOLD, 0.9 * A); D.glow(lx, ly, 9 * sk, 0, GOLD, 0.35 * A);
        }
      },
    },
    // Slither: a vortex of trailing flagella, comb rows rippling colour, jet pulses.
    vortex: {
      under(c) {
        const { D, g, t, Rr, at, hc, acc, A, sk, lod } = c;
        for (const f of g.extra) {
          const th = f.a + t * 0.05 * g.turn, base = at(th, 0.95);
          tendril(D, base.x, base.y, th + g.turn * 0.9, Rr * f.len, lod ? 6 : 12, 0.9 * sk, 0.15 * sk, E.mix(hc, acc, 0.2), 0.8 * A, 0.5, 7, -t * 4 * f.w + f.ph, g.turn * f.curl * 1.6);
        }
      },
      over(c) {
        const { D, g, t, x, y, Rr, at, acc, A, sk, lod, bf } = c;
        if (!lod) for (let k = 0; k < g.combs; k++) {
          const a0 = k / g.combs * TAU + g.ph;
          for (let i = 0; i < 6; i++) {
            const th = a0 + i * 0.09, q = at(th, 0.8), on = Math.max(0, Math.sin(t * 7 - i * 0.9 - k));
            D.glowTop(q.x, q.y, 2.3 * sk, 4, E.mix(acc, i % 2 ? { r: 255, g: 130, b: 230 } : { r: 120, g: 255, b: 240 }, 0.5), (0.2 + 0.7 * on) * A);
          }
        }
        // jet pulse from the siphon side every few beats
        const jp = ((t * 0.33 + g.ph) % 1);
        if (jp < 0.3) { const th = g.ph + PI, q = at(th, 1.05), f = jp / 0.3; D.glow(q.x + Math.cos(th) * Rr * f, q.y + Math.sin(th) * Rr * f, Rr * (0.3 + 0.5 * f), 0, acc, (1 - f) * 0.5 * A); D.glowTop(q.x, q.y, Rr * 0.3 * (1 + f), 2, acc, (1 - f) * 0.6 * A, 1.5); }
        void x; void y; void bf;
      },
    },
    // Choir: long antennae sweep the dark; song rings spread; photophores chase round the bell.
    song: {
      under(c) {
        const { D, g, t, Rr, at, hc, acc, A, sk, lod } = c;
        for (const f of g.extra) {
          const sweep = Math.sin(t * f.w + f.ph) * f.sw, th = f.a + sweep, base = at(th, 0.97);
          const tip = tendril(D, base.x, base.y, th, Rr * f.len, lod ? 6 : 14, 0.55 * sk, 0.12 * sk, E.mix(hc, WHITE, 0.2), 0.75 * A, 0.3, 4, t * 0.9 + f.ph, sweep * 0.8);
          D.glowTop(tip.x, tip.y, 2.2 * sk, 1, acc, (0.5 + 0.5 * Math.sin(t * 3 + f.ph)) * A);
        }
      },
      over(c) {
        const { D, g, t, x, y, Rr, at, acc, A, sk, lod, b } = c;
        for (let k = 0; k < 2; k++) { const f = ((t * 0.4 + k * 0.5 + g.ph) % 1); D.glow(x, y, Rr * (1 + 1.8 * f), 7, acc, (1 - f) * 0.45 * A, 1.2, 24); }
        // radial canals and four gonads, as in a medusa's bell
        const nc = 8;
        for (let i = 0; i < nc; i++) { const th = i / nc * TAU + g.ph, q0 = at(th, 0.22), q1 = at(th, 0.88); D.seg(q0.x, q0.y, q1.x, q1.y, 0.55 * sk, 1, E.mix(acc, WHITE, 0.25), 0.45 * A); }
        for (let i = 0; i < 4; i++) { const th = i / 4 * TAU + g.ph + PI / 4, q = at(th, 0.38); D.glowTop(q.x, q.y, Rr * 0.16, 2, E.mix(acc, { r: 255, g: 160, b: 230 }, 0.4), 0.7 * A, 2.2); D.glow(q.x, q.y, Rr * 0.22, 0, acc, 0.35 * A); }
        if (!lod) {
          const inner = c.rad; // inner bell rim contracting with the pulse
          membrane(D, x, y, Rr * (0.62 - 0.06 * c.pulse), th => inner(th), 18, 0.45 * sk, E.mix(acc, WHITE, 0.2), 0.45 * A, 0.8);
          for (let i = 0; i < g.phot; i++) {
            const th = i / g.phot * TAU, q = at(th, 0.76), on = Math.pow(Math.max(0, Math.sin(t * 2.4 * (b.lance ? 2.5 : 1) - i * 0.55)), 3);
            D.glowTop(q.x, q.y, 3.4 * sk, 1, E.mix(acc, WHITE, 0.3), (0.35 + 0.65 * on) * A);
          }
        }
      },
    },
    // Seethe: a toothed maw, a cluster of eyes on one side, hooked tethers that reach for prey.
    maw: {
      under(c) {
        const { D, R, view, b, g, st, t, x, y, Rr, at, hc, acc, A, sk, lod } = c;
        const tg = nearest(R, view, b, Rr * 5, t, st);
        g.extra.forEach((f, i) => {
          const base = at(f.a, 0.95);
          let tip;
          if (tg && i < 2) {
            // reach: a sagging line to the prey, hooks at the end
            const dx = tg.x - base.x, dy = tg.y - base.y, d = Math.hypot(dx, dy), reach = Math.min(d, Rr * (f.len + 1.8));
            const ang = Math.atan2(dy, dx), n = 8;
            for (let k = 0; k <= n; k++) { const q = k / n, sag = Math.sin(q * PI) * Rr * 0.25 * Math.sin(t * 1.5 + f.ph); P[k * 2] = base.x + Math.cos(ang) * reach * q - Math.sin(ang) * sag; P[k * 2 + 1] = base.y + Math.sin(ang) * reach * q + Math.cos(ang) * sag; }
            D.poly(P, n + 1, false, 0.8 * sk, 0.35 * sk, 0, E.mix(hc, BLOOD, 0.35), 0.85 * A, 1);
            tip = { x: P[n * 2], y: P[n * 2 + 1], a: ang };
          } else tip = tendril(D, base.x, base.y, f.a, Rr * f.len * (0.8 + 0.2 * Math.sin(t * 0.7 + f.ph)), lod ? 5 : 9, 0.8 * sk, 0.3 * sk, E.mix(hc, BLOOD, 0.35), 0.8 * A, 0.6, 5, t * 1.2 + f.ph, f.hook * 1.4);
          if (!lod) for (const s of [-1, 1]) D.seg(tip.x, tip.y, tip.x + Math.cos(tip.a + s * 2.4) * 5 * sk, tip.y + Math.sin(tip.a + s * 2.4) * 5 * sk, 0.5 * sk, 1, E.mix(acc, WHITE, 0.3), 0.8 * A);
        });
        void x; void y;
      },
      over(c) {
        const { D, R, view, b, g, st, t, x, y, Rr, acc, A, sk, lod } = c;
        const mx = x + g.maw.x * Rr, my = y + g.maw.y * Rr, open = 0.5 + 0.5 * Math.sin(t * 1.3 + g.ph) * (st.near && st.foe ? 1.4 : 0.7);
        const ro = Rr * 0.42, ri = Rr * (0.14 + 0.16 * E.clamp(open, 0, 1));
        D.glowTop(mx, my, ro * 1.05, 4, { r: 8, g: 0, b: 6 }, 0.85 * A);
        D.glowTop(mx, my, ro * 0.7, 1, BLOOD, (0.35 + 0.2 * open) * A);
        for (let i = 0; i < g.teeth; i++) {
          const th = i / g.teeth * TAU + g.ph, j = 1 + 0.25 * Math.sin(i * 2.7);
          D.seg(mx + Math.cos(th) * ro, my + Math.sin(th) * ro, mx + Math.cos(th + 0.08) * Math.max(ri, ro - (ro - ri) * j), my + Math.sin(th + 0.08) * Math.max(ri, ro - (ro - ri) * j), 0.7 * sk, 1, E.mix(WHITE, acc, 0.3), 0.85 * A);
        }
        if (!lod) {
          const tg = nearest(R, view, b, Rr * 5, t, st), want = tg ? Math.atan2(tg.y - y, tg.x - x) : st.look + Math.sin(t * 0.5) * 0.02;
          st.look = easeAng(st.look, want, 0.08);
          for (const e of g.eyes) { const q = c.at(e.a, e.d); eye(D, q.x, q.y, Rr * e.r, st.look, t, e.ph, { r: 255, g: 70, b: 110 }, A, !!(tg && st.foe)); }
        }
      },
    },
    // Bloom: carapace plates, spikes that twitch, egg sacs that swell and burst.
    carapace: {
      under(c) {
        const { D, g, t, at, hc, A, sk, lod } = c;
        for (const s of g.spikes) {
          const q = at(s.a, 0.98), len = c.Rr * s.len * (1 + 0.08 * Math.sin(t * 5 + s.ph));
          D.seg(q.x, q.y, q.x + Math.cos(s.a) * len, q.y + Math.sin(s.a) * len, (lod ? 1.2 : 1) * sk, 0, E.mix(hc, WHITE, 0.15), 0.9 * A, 0.6);
        }
      },
      over(c) {
        const { D, g, t, Rr, at, hc, acc, A, sk, lod } = c;
        for (const pl of g.extra) {
          const n = 7; let m = 0;
          for (let i = 0; i <= n; i++) { const th = pl.a - pl.span / 2 + pl.span * i / n, q = at(th, pl.d); P[m * 2] = q.x; P[m * 2 + 1] = q.y; m++; }
          D.poly(P, m, false, 1.35 * sk, 1.35 * sk, 0, E.mix(hc, acc, 0.25), 0.8 * A, 0.7);
          if (!lod) { const q0 = at(pl.a, pl.d - 0.12); D.glowTop(q0.x, q0.y, 1.6 * sk, 4, E.mix(acc, WHITE, 0.5), 0.5 * A); }
        }
        if (!lod) for (const e of g.eggs) {
          const q = at(e.a, e.d), cyc = ((t + e.ph * 3) % e.per) / e.per, swell = cyc < 0.92 ? cyc / 0.92 : 0, burst = cyc >= 0.92 ? (cyc - 0.92) / 0.08 : 0;
          const r = Rr * e.r * (0.7 + 0.6 * swell);
          D.glowTop(q.x, q.y, r, 4, E.mix(hc, GOLD, 0.3), (0.35 + 0.3 * swell) * A * (1 - burst));
          D.glowTop(q.x, q.y, r * 0.55, 1, E.mix(acc, GOLD, 0.4), (0.5 + 0.4 * swell) * A * (1 - burst));
          if (burst) D.glowTop(q.x, q.y, r * (1 + 3 * burst), 2, acc, (1 - burst) * 0.8 * A, 1.5);
        }
      },
    },
  };

  // An eye: sclera glow, iris ring, and a pupil that follows its gaze; it blinks now and then.
  function eye(D, x, y, r, look, t, ph, iris, A, alarmed) {
    const blink = ((t * 0.23 + ph) % 1) > 0.97 ? 0.15 : 1;
    D.glowTop(x, y, r * 1.7, 0, iris, 0.45 * A);
    D.glowTop(x, y, r, 4, E.mix(iris, WHITE, 0.65), 0.85 * A * blink);
    const px = x + Math.cos(look) * r * 0.35, py = y + Math.sin(look) * r * 0.35;
    D.glowTop(px, py, r * (alarmed ? 0.62 : 0.5), 4, E.mix(iris, BLACK, 0.2), 0.95 * A * blink);
    D.glowTop(px, py, r * (alarmed ? 0.22 : 0.32), 4, BLACK, 0.95 * A * blink);
    D.glowTop(px - r * 0.18, py - r * 0.2, r * 0.14, 4, WHITE, 0.9 * A * blink);
  }

  // A plain canvas adapter, used by the Canvas2D backend and UI previews.
  E.canvasStructAdapter = function (ctx, z, lod, seen, pal) {
    const stroke3 = (draw, s, c, a, wk) => {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = E.rgba(c, 0.1 * a); ctx.lineWidth = 10 * s * (wk || 1); draw(); ctx.stroke();
      ctx.strokeStyle = E.rgba(c, 0.3 * a); ctx.lineWidth = 5.2 * s; draw(); ctx.stroke();
      ctx.strokeStyle = E.rgba(E.mix(c, E.WHITE, 0.25), 0.85 * a); ctx.lineWidth = Math.max(0.65 / z, 2.5 * s); draw(); ctx.stroke();
    };
    const line = (draw, s, c, a) => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = E.rgba(c, a); ctx.lineWidth = Math.max(0.5 / z, s * 2); draw(); ctx.stroke(); };
    const glow = (x, y, r, kind, c, a, p0, p1) => {
      if (a <= 0.003 || r <= 0) return;
      if (kind === 0 || kind === 1 || kind === 8) E.drawGlow(ctx, x, y, kind === 8 ? r * 0.8 : r, c, kind === 8 ? a * 0.9 : a, kind !== 1);
      else if (kind === 4) { ctx.fillStyle = E.rgba(c, Math.min(1, a)); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      else { ctx.strokeStyle = E.rgba(c, Math.min(1, a)); ctx.lineWidth = Math.max(1, p0 || 1) / z; if (kind === 7) ctx.setLineDash([r * TAU / (p1 || 12) / 2, r * TAU / (p1 || 12) / 2]); ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r - (p0 || 1) / z / 2), kind === 3 ? -PI / 2 : 0, kind === 3 ? -PI / 2 + TAU * (p1 || 0) : TAU); ctx.stroke(); if (kind === 7) ctx.setLineDash([]); }
    };
    const SPINE = 2.7, STRAIGHT = []; for (let i = 0; i < 20; i++) STRAIGHT.push({ x: -i * SPINE, y: 0 });
    const AI = { head: 0, body: 5, tail: 19 };
    return {
      z, lod, seen,
      glow, glowTop: glow,
      seg(x0, y0, x1, y1, s, prof, c, a, wk) { const d = () => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }; if (prof === 0) stroke3(d, s, c, a, wk); else line(d, s, c, a); },
      poly(Pp, n, closed, s0, s1, prof, c, a, wk) {
        if (n < 2) return;
        const path = (i0, i1) => () => { ctx.beginPath(); ctx.moveTo(Pp[i0 * 2], Pp[i0 * 2 + 1]); for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(Pp[i * 2], Pp[i * 2 + 1]); if (closed && i0 === 0 && i1 === n - 1) ctx.closePath(); };
        if (Math.abs(s0 - s1) < 0.05 || closed) { prof === 0 ? stroke3(path(0, n - 1), (s0 + s1) / 2, c, a, wk) : line(path(0, n - 1), (s0 + s1) / 2, c, a); return; }
        // taper in three runs
        const k = Math.max(1, Math.floor((n - 1) / 3));
        for (let i = 0; i < n - 1; i += k) { const j = Math.min(n - 1, i + k), s = s0 + (s1 - s0) * ((i + j) / 2 / (n - 1)); prof === 0 ? stroke3(path(i, j), s, c, a, wk) : line(path(i, j), s, c, a); }
      },
      organ(id, x, y, rot, sc, ti, side, ph, speed, t, body, acc, a) {
        const o = E.ORGANS[id]; if (!o || a <= 0.01) return;
        const ai = AI[anchorOf(id)], ga = ctx.globalAlpha;
        ctx.save(); ctx.globalAlpha = ga * Math.min(1, a);
        ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(ai * SPINE, 0);
        try { o.draw(ctx, STRAIGHT, side, { speed, phase: ph }, t, E.TIER_V[ti] || 0, Object.assign({}, pal, { accent: acc }), body); } catch (e) { /* organ drawers are best-effort in previews */ }
        ctx.restore();
      },
    };
  };
})(window.E);
