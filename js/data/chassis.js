// SPDX-License-Identifier: AGPL-3.0-only
// Chassis: six body plans (plus the Leviathan apex). Each has base stats, a
// slot count, a trait, and a body renderer. Organs attach to the same 20-point
// spine on every chassis, so all 30 organs fit all 6 bodies.
(function (E) {
  'use strict';
  const TAU = E.TAU;

  function strokePath(ctx, pts, n) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < n; k++) { const p0 = pts[k - 1], p1 = pts[k]; ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2); }
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  }
  // The seed's three-layer glow body.
  function glowStroke(ctx, pts, n, size, hc, ba, activity) {
    strokePath(ctx, pts, n);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!E.LOWQ) { ctx.strokeStyle = rgba(hc, ba * 0.1); ctx.lineWidth = size * 10 * activity; ctx.stroke(); }
    ctx.strokeStyle = rgba(hc, ba * 0.25); ctx.lineWidth = size * 5 * activity; ctx.stroke();
    ctx.strokeStyle = rgba(E.mix(hc, E.WHITE, 0.25), ba * 0.85); ctx.lineWidth = Math.max(1.2, size * 2.2 * activity); ctx.stroke();
  }
  function dirAt(pts, i) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(a.y - b.y, a.x - b.x);
  }

  const bodies = {
    serpent(ctx, pts, s, hc, pal, t, ba, act) { glowStroke(ctx, pts, pts.length, s, hc, ba, act); },
    carapace(ctx, pts, s, hc, pal, t, ba, act) {
      glowStroke(ctx, pts, pts.length, s * 0.8, hc, ba * 0.7, act);
      const n = 9;
      for (let i = n; i >= 0; i--) {
        const p = pts[Math.min(pts.length - 1, i * 2)], a = dirAt(pts, i * 2), w = s * (7.5 - i * 0.45) * act;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, 0, s * 3.2, w, 0, -Math.PI / 2, Math.PI / 2);
        ctx.fillStyle = rgba(E.mix(hc, { r: 0, g: 0, b: 0 }, 0.35), ba * 0.55); ctx.fill();
        ctx.strokeStyle = rgba(E.mix(hc, E.WHITE, 0.2), ba * 0.75); ctx.lineWidth = 0.9; ctx.stroke();
        ctx.restore();
      }
    },
    ctenophore(ctx, pts, s, hc, pal, t, ba, act) {
      const tail = Math.min(pts.length, 20);
      ctx.globalAlpha *= 0.6; glowStroke(ctx, pts.slice(6), tail - 6, s * 0.5, hc, ba * 0.5, 1); ctx.globalAlpha /= 0.6;
      const c = pts[3], a = dirAt(pts, 3), L = s * 12 * act, W = s * 6.5 * act;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(a);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
      g.addColorStop(0, rgba(E.mix(hc, E.WHITE, 0.4), ba * 0.28)); g.addColorStop(1, rgba(hc, ba * 0.05));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, L, W, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(hc, ba * 0.6); ctx.lineWidth = 0.9; ctx.stroke();
      for (let r = 0; r < 6; r++) {
        const y = (r / 5 - 0.5) * W * 1.5;
        for (let k = 0; k < 7; k++) {
          const x = (k / 6 - 0.5) * L * 1.6 * Math.sqrt(1 - Math.pow(y / W, 2) * 0.9);
          const hue = (k * 35 + r * 20 + t * 140) % 360, on = 0.4 + 0.6 * Math.max(0, Math.sin(t * 8 - k * 0.9 + r));
          ctx.fillStyle = `hsla(${hue},95%,72%,${ba * 0.55 * on})`; ctx.fillRect(x - 0.7, y - 0.35, 1.4, 0.7);
        }
      }
      ctx.restore();
    },
    medusa(ctx, pts, s, hc, pal, t, ba, act) {
      const head = pts[0], a = dirAt(pts, 1), pulse = 0.5 + 0.5 * Math.sin(t * 3 + s * 7);
      const R = s * 9 * act * (0.9 + pulse * 0.18), H = s * 7 * (1.1 - pulse * 0.25);
      // trailing tentacles
      const n = 5;
      for (let k = 0; k < n; k++) {
        const off = (k / (n - 1) - 0.5) * R * 1.4;
        ctx.beginPath();
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i], pa = dirAt(pts, i), q = i / pts.length;
          const w = Math.sin(t * 2.4 - i * 0.5 + k * 1.3) * 2.5 * q;
          const x = p.x + Math.cos(pa + Math.PI / 2) * (off * (1 - q * 0.6) + w), y = p.y + Math.sin(pa + Math.PI / 2) * (off * (1 - q * 0.6) + w);
          i === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(hc, ba * 0.35); ctx.lineWidth = 0.7; ctx.stroke();
      }
      ctx.save(); ctx.translate(head.x, head.y); ctx.rotate(a);
      const g = ctx.createRadialGradient(H * 0.3, 0, 0, 0, 0, R * 1.2);
      g.addColorStop(0, rgba(E.mix(hc, E.WHITE, 0.5), ba * 0.4)); g.addColorStop(0.6, rgba(hc, ba * 0.2)); g.addColorStop(1, rgba(hc, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-H * 0.4, -R); ctx.quadraticCurveTo(H * 1.6, -R * 0.9, H * 1.2, 0); ctx.quadraticCurveTo(H * 1.6, R * 0.9, -H * 0.4, R);
      ctx.quadraticCurveTo(-H * 0.1, 0, -H * 0.4, -R); ctx.fill();
      ctx.strokeStyle = rgba(E.mix(hc, E.WHITE, 0.3), ba * 0.7); ctx.lineWidth = 1; ctx.stroke();
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-H * 0.2, (k / 3 - 0.5) * R * 1.4); ctx.lineTo(H * 0.9, (k / 3 - 0.5) * R * 0.5); ctx.strokeStyle = rgba(pal.accent, ba * 0.25); ctx.stroke(); }
      ctx.restore();
    },
    siphonophore(ctx, pts, s, hc, pal, t, ba, act) {
      strokePath(ctx, pts, pts.length);
      ctx.lineCap = 'round'; ctx.strokeStyle = rgba(hc, ba * 0.3); ctx.lineWidth = s * 1.4; ctx.stroke();
      for (let i = 1; i < pts.length; i += 2) {
        const p = pts[i], pulse = 0.5 + 0.5 * Math.sin(t * 3 - i * 0.6 + s), r = s * (i % 4 === 1 ? 3.2 : 2.2) * act * (0.85 + pulse * 0.3);
        ctx.fillStyle = rgba(hc, ba * 0.14); ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(E.mix(hc, E.WHITE, 0.3), ba * (0.35 + pulse * 0.3)); ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.8, 0, TAU); ctx.fill();
        if (i % 4 === 1) { ctx.strokeStyle = rgba(pal.accent, ba * 0.5); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.3, 0, TAU); ctx.stroke(); }
      }
    },
    nautiloid(ctx, pts, s, hc, pal, t, ba, act) {
      glowStroke(ctx, pts.slice(2), Math.min(12, pts.length - 2), s * 0.7, hc, ba * 0.6, act);
      const head = pts[1], a = dirAt(pts, 1), R = s * 9 * act;
      // tentacle fringe forward
      for (let k = 0; k < 7; k++) {
        const ta = a + (k / 6 - 0.5) * 1.2, l = R * (0.8 + 0.3 * Math.sin(t * 3 + k));
        ctx.beginPath(); ctx.moveTo(head.x + Math.cos(a) * R * 0.4, head.y + Math.sin(a) * R * 0.4);
        ctx.quadraticCurveTo(head.x + Math.cos(ta) * l, head.y + Math.sin(ta) * l, head.x + Math.cos(ta + Math.sin(t * 2 + k) * 0.3) * l * 1.4, head.y + Math.sin(ta + Math.sin(t * 2 + k) * 0.3) * l * 1.4);
        ctx.strokeStyle = rgba(hc, ba * 0.45); ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.save(); ctx.translate(head.x - Math.cos(a) * R * 0.6, head.y - Math.sin(a) * R * 0.6); ctx.rotate(a + Math.PI);
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const th = i / 60 * TAU * 1.6, r = R * 0.12 * Math.exp(0.21 * th); const x = Math.cos(th) * r, y = Math.sin(th) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.fillStyle = rgba(E.mix(hc, { r: 0, g: 0, b: 0 }, 0.3), ba * 0.45); ctx.fill();
      ctx.strokeStyle = rgba(E.mix(hc, E.WHITE, 0.3), ba * 0.8); ctx.lineWidth = 1.1; ctx.stroke();
      for (let k = 1; k < 7; k++) { const th = k / 7 * TAU * 1.6, r = R * 0.12 * Math.exp(0.21 * th); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r); ctx.strokeStyle = rgba(pal.accent, ba * 0.3); ctx.lineWidth = 0.6; ctx.stroke(); }
      ctx.restore();
    },
    leviathan(ctx, pts, s, hc, pal, t, ba, act) {
      glowStroke(ctx, pts, pts.length, s, hc, ba, act);
      for (let i = 2; i < pts.length - 2; i += 2) {
        const p = pts[i], a = dirAt(pts, i), l = s * (6 - i * 0.2);
        for (const sd of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a + sd * 2.2) * l, p.y + Math.sin(a + sd * 2.2) * l);
          ctx.strokeStyle = rgba(E.mix(hc, E.WHITE, 0.3), ba * 0.6); ctx.lineWidth = 1.2; ctx.stroke();
        }
        E.glowDot(ctx, p.x, p.y, s * 0.7, pal.accent, ba * (0.4 + 0.4 * Math.sin(t * 3 - i)));
      }
    },
  };

  const C = [
    { id: 'serpent', name: 'Serpent', blurb: 'The seed’s own trail-body. Long, supple and balanced.', slots: 4, hp: 50, armor: 0, speed: 50, turn: 2.8, size: 1.0, bodyLen: 52, sense: 110, cost: 20, spore: 0, hatch: 3, trait: 'Agile: turns sharply' },
    { id: 'carapace', name: 'Carapace', blurb: 'Plated isopod. Slow, but it shrugs off bites. Grants Harden.', slots: 4, hp: 90, armor: 0.25, speed: 36, turn: 2.0, size: 1.15, bodyLen: 32, sense: 90, cost: 35, spore: 0, hatch: 4.5, ability: 'harden', trait: '25% armor' },
    { id: 'ctenophore', name: 'Ctenophore', blurb: 'A glassy comb jelly. Quick and hard to hit. Grants Camouflage.', slots: 3, hp: 38, armor: 0, speed: 64, turn: 3.2, size: 0.9, bodyLen: 36, sense: 120, cost: 28, spore: 0, hatch: 3, ability: 'camo', evasion: 0.2, trait: '20% evasion' },
    { id: 'medusa', name: 'Medusa', blurb: 'A pulsing bell trailing stinging veils. Grants Tentacle Lash.', slots: 3, hp: 60, armor: 0, speed: 38, turn: 2.2, size: 1.25, bodyLen: 44, sense: 150, cost: 40, spore: 15, hatch: 4.5, ability: 'lash', sting: 3, trait: 'Stings anything within 40' },
    { id: 'siphonophore', name: 'Siphonophore', blurb: 'A colonial chain of zooids with six organ slots. Grants Bud Split.', slots: 6, hp: 70, armor: 0, speed: 40, turn: 2.0, size: 1.0, bodyLen: 88, sense: 110, cost: 45, spore: 15, hatch: 5.5, ability: 'split', regen: 1.5, trait: 'Regenerates 1.5 hp/s' },
    { id: 'nautiloid', name: 'Nautiloid', blurb: 'A coiled, jet-driven shell. Grants Ink Cloud.', slots: 4, hp: 80, armor: 0.35, speed: 44, turn: 1.8, size: 1.2, bodyLen: 34, sense: 100, cost: 55, spore: 25, hatch: 5.5, ability: 'ink', trait: '35% armor' },
    { id: 'leviathan', name: 'Leviathan', blurb: 'Apex spawn. One per colony.', slots: 8, hp: 900, armor: 0.3, speed: 42, turn: 1.5, size: 2.3, bodyLen: 150, sense: 240, cost: 0, spore: 0, hatch: 20, trait: 'Colossal', hero: true },
  ];
  E.CHASSIS = {};
  C.forEach(c => { c.draw = bodies[c.id]; E.CHASSIS[c.id] = c; });
  E.CHASSIS_LIST = C.filter(c => !c.hero);
  E.strokePath = strokePath; E.glowStroke = glowStroke;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
