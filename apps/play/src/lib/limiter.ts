// SPDX-License-Identifier: AGPL-3.0-only
// In-memory sliding-window limiter for sensitive endpoints (sign-in, reports).
// Keys are pseudonyms (never raw IPs or emails); entries expire on their own.
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {
    setInterval(() => { const now = Date.now(); for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > this.windowMs) this.hits.delete(k); }, Math.min(60000, windowMs)).unref();
  }
  // true if allowed (and counts the hit)
  take(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr); return true;
  }
  reset(key: string) { this.hits.delete(key); }
}
