// SPDX-License-Identifier: AGPL-3.0-only
// Core utilities shared by sim, renderer and UI. No DOM access here.
(function (E) {
  'use strict';
  const TAU = Math.PI * 2;
  E.TAU = TAU;
  E.DT = 1 / 30; // fixed simulation step

  E.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  E.dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  E.angWrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  E.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  E.lerp = (a, b, t) => a + (b - a) * t;
  E.round = (v, d) => { const k = Math.pow(10, d || 0); return Math.round(v * k) / k; };

  // Seeded RNG with serializable state (mulberry32).
  E.RNG = function (seed) {
    const r = { s: seed >>> 0 };
    r.next = function () {
      let a = (r.s = (r.s + 0x6d2b79f5) | 0);
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + r.next() * (hi - lo);
    r.int = (lo, hi) => lo + Math.floor(r.next() * (hi - lo + 1));
    r.pick = arr => arr[Math.floor(r.next() * arr.length)];
    r.chance = p => r.next() < p;
    return r;
  };
  E.hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // Colors
  E.hex = h => { const n = parseInt(h.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
  E.toHex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(E.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  E.mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  E.rgba = (c, a) => `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
  E.WHITE = { r: 255, g: 255, b: 255 };
  E.RED = { r: 0xef, g: 0x44, b: 0x44 };

  // Uniform spatial hash for neighbour queries.
  E.Grid = function (cell) {
    this.cell = cell; this.map = new Map();
  };
  E.Grid.prototype.clear = function () { this.map.clear(); };
  E.Grid.prototype.key = function (cx, cy) { return (cx + 1024) * 4096 + (cy + 1024); };
  E.Grid.prototype.insert = function (o) {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); } b.push(o);
  };
  E.Grid.prototype.query = function (x, y, r, out) {
    out = out || []; out.length = 0;
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const b = this.map.get(this.key(cx, cy)); if (!b) continue;
      for (const o of b) { const dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy <= r2) out.push(o); }
    }
    return out;
  };

  E.fmtTime = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  E.deepCopy = o => JSON.parse(JSON.stringify(o));
})(typeof window !== 'undefined' ? (window.E = window.E || {}) : (globalThis.E = globalThis.E || {}));
