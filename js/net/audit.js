// SPDX-License-Identifier: AGPL-3.0-only
// Verifiable host. In an online match the host runs the only simulation, so a
// modified host could hand itself lumen, drop a rival's orders or change the
// result. The sim is deterministic, so guests can check it:
//
//   1. every 20 s the host commits to the full world state: the SHA-256 of the
//      serialized state rides along in the next snapshot (a hash reveals nothing);
//   2. the host keeps those states and the stream of commands it applied;
//   3. when the match ends each guest walks the windows in a random order (the host
//      cannot know which come first), asking for the two states that bound each
//      window and the commands in between, until its time budget is spent (short
//      matches get checked end to end), and checks that
//        - both states hash to what the host committed during the match,
//        - re-simulating the first state with those commands arrives at the second,
//        - every order this guest sent was applied, and
//        - the committed state agrees with what the guest was shown live.
//
// Different browsers may round trigonometry differently, so the re-simulation is
// compared by per-player facts with tolerances (a cheat moves them far; float drift
// barely at all). The verdict travels with the guest's result claim to the server,
// which only rates results everyone agrees on (apps/play/src/realtime/results.ts).
(function (E) {
  'use strict';
  const EVERY = 600;        // ticks between checkpoints (20 s at 30 Hz)
  const WINDOWS = 4;        // windows per request (each carries two full states)
  const BUDGET_MS = 9000;   // how long a guest keeps checking after the match
  const APPLY_WITHIN = 150; // ticks within which a sent order must be applied (5 s)
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const yieldNow = () => new Promise(r => setTimeout(r, 0));

  const Audit = E.Audit = {
    EVERY, WINDOWS, BUDGET_MS,
    // several batches' verdicts → one
    merge(list) {
      const all = list.filter(Boolean), reasons = [].concat(...all.map(v => v.reasons || []));
      const windows = all.reduce((n, v) => n + (v.windows || 0), 0);
      const verdict = all.some(v => v.verdict === 'tamper') ? 'tamper' : !windows ? 'unverified' : all.some(v => v.verdict === 'drift') ? 'drift' : 'ok';
      return { verdict, windows, reasons: reasons.slice(0, 12) };
    },
    supported() { return !!(window.crypto && crypto.subtle && window.TextEncoder); },
    async hash(str) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))); },
    // Per-player facts a cheat has to change.
    facts(s) {
      return s.players.map(p => {
        const f = { alive: !!p.alive, lumen: p.lumen || 0, spore: p.spore || 0, units: 0, hp: 0, structs: 0, research: (p.research || []).length, evolved: (p.stats && p.stats.evolved) || 0 };
        for (const u of s.units) if (u.o === p.idx) { f.units++; f.hp += u.hp; }
        for (const b of s.structs) if (b.o === p.idx) f.structs++;
        return f;
      });
    },
    // Differences between two sets of facts: 'tamper' when far outside what drift explains.
    compare(want, got, label) {
      const out = [];
      const far = (a, b, abs, rel) => Math.abs(a - b) > Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
      want.forEach((a, i) => {
        const b = got[i]; if (!b) { out.push({ sev: 'tamper', what: `${label}: player ${i} missing` }); return; }
        const note = (sev, what) => out.push({ sev, what: `${label}: player ${i} ${what}` });
        if (a.alive !== b.alive) note('tamper', `alive ${a.alive} vs ${b.alive}`);
        if (far(a.lumen, b.lumen, 150, 0.25)) note('tamper', `lumen ${Math.round(a.lumen)} vs ${Math.round(b.lumen)}`);
        if (far(a.spore, b.spore, 60, 0.25)) note('tamper', `spore ${Math.round(a.spore)} vs ${Math.round(b.spore)}`);
        if (far(a.units, b.units, 3, 0.2)) note('tamper', `creatures ${a.units} vs ${b.units}`);
        if (Math.abs(a.structs - b.structs) > 1) note('tamper', `structures ${a.structs} vs ${b.structs}`);
        if (Math.abs(a.research - b.research) > 1 || Math.abs(a.evolved - b.evolved) > 1) note('tamper', 'evolutions differ');
        if (far(a.hp, b.hp, 400, 0.5)) note('tamper', `health ${Math.round(a.hp)} vs ${Math.round(b.hp)}`);
        else if (a.lumen !== b.lumen || a.units !== b.units || Math.abs(a.hp - b.hp) > 0.01) note('drift', 'small differences');
      });
      return out;
    },
  };

  // ── host ───────────────────────────────────────────────────────
  class AuditHost {
    constructor(world) {
      this.w = world; world.rec = world.rec || [];
      this.cps = new Map(); this.fresh = []; this.busy = false;
    }
    // after each step: checkpoint on the boundary (hashing is async; the commitment follows shortly)
    tick() {
      const s = this.w.s;
      if (s.tick % EVERY !== 0 || this.cps.has(s.tick)) return;
      const str = this.w.serialize(), t = s.tick;
      this.cps.set(t, str);
      Audit.hash(str).then(h => this.fresh.push([t, h])).catch(() => {});
    }
    // new commitments for the next snapshot
    take() { if (!this.fresh.length) return null; const f = this.fresh; this.fresh = []; return f; }
    answer(req) {
      const want = Array.isArray(req && req.w) ? req.w.slice(0, WINDOWS) : [];
      return {
        k: 'audit', w: want.map(a => {
          a = +a; const b = a + EVERY;
          if (!this.cps.has(a) || !this.cps.has(b)) return { a, missing: true };
          return { a, sa: this.cps.get(a), sb: this.cps.get(b), cmds: this.w.rec.filter(r => r[0] >= a && r[0] < b) };
        }),
      };
    }
  }

  // ── guest ──────────────────────────────────────────────────────
  class AuditGuest {
    constructor(slot) {
      this.slot = slot; this.commits = new Map(); this.sent = []; this.seq = 0;
      this.live = new Map(); this.gaps = []; this.lastSnapAt = 0; this.lastTick = 0;
    }
    // every snapshot: commitments, and what we were shown near each checkpoint
    onSnap(d, world) {
      const now = performance.now();
      if (this.lastSnapAt && now - this.lastSnapAt > 3000) this.gaps.push(this.lastTick);
      this.lastSnapAt = now; this.lastTick = d.tick;
      if (d.au) for (const [t, h] of d.au) this.commits.set(+t, String(h));
      const c = Math.floor(d.tick / EVERY) * EVERY;
      if (d.tick - c < 20 && !this.live.has(c)) {
        const me = world.s.players[this.slot];
        if (me) {
          let units = 0; for (const u of world.s.units) if (u.o === this.slot) units++;
          this.live.set(c, { tick: d.tick, lumen: me.lumen, units, alive: !!me.alive });
        }
      }
    }
    // outgoing orders carry a sequence number so we can find them in the host's log
    stamp(cmd) { cmd.n = ++this.seq; this.sent.push({ n: cmd.n, tick: this.lastTick }); return cmd; }
    // every checkable window, in an order the host cannot predict
    order() {
      const ok = [...this.commits.keys()].filter(a => this.commits.has(a + EVERY));
      const r = new Uint32Array(ok.length || 1); crypto.getRandomValues(r);
      return ok.map((a, i) => [r[i], a]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    }
    pick() { return this.order().slice(0, WINDOWS); }
    // → { verdict: 'ok' | 'drift' | 'tamper' | 'unverified', windows, reasons }
    async verify(reply) {
      const reasons = [];
      if (!reply || !Array.isArray(reply.w)) return { verdict: 'unverified', windows: 0, reasons: ['no audit reply'] };
      let checked = 0;
      for (const win of reply.w) {
        const a = +win.a, b = a + EVERY;
        if (win.missing) { reasons.push({ sev: 'info', what: `window ${a}: host no longer has it` }); continue; }
        if (typeof win.sa !== 'string' || typeof win.sb !== 'string' || !Array.isArray(win.cmds)) { reasons.push({ sev: 'tamper', what: `window ${a}: malformed` }); continue; }
        const [ha, hb] = await Promise.all([Audit.hash(win.sa), Audit.hash(win.sb)]);
        if (ha !== this.commits.get(a) || hb !== this.commits.get(b)) { reasons.push({ sev: 'tamper', what: `window ${a}: states differ from what the host committed during the match` }); continue; }
        let shadow, end;
        try { shadow = new E.World({ state: win.sa }); end = JSON.parse(win.sb); } catch (e) { reasons.push({ sev: 'tamper', what: `window ${a}: unreadable state` }); continue; }
        // replay: at each tick the pending commands are exactly those the host applied
        const byTick = new Map();
        for (const [t, pi, cmd] of win.cmds) { if (!byTick.has(t)) byTick.set(t, []); byTick.get(t).push({ pi, cmd }); }
        try {
          for (let k = 0; shadow.s.tick < b && !shadow.s.over; k++) {
            shadow.s.pending = byTick.get(shadow.s.tick) || [];
            shadow.step(); shadow.drainEvents();
            if (k % 60 === 59) await yieldNow();
          }
        } catch (e) { reasons.push({ sev: 'info', what: `window ${a}: replay error ${e.message}` }); continue; }
        if (!shadow.s.over || end.over) reasons.push(...Audit.compare(Audit.facts(shadow.s), Audit.facts(end), `window ${a}`));
        // our orders: everything we sent well inside the window must be in the host's log
        const mine = new Set(win.cmds.filter(r => r[1] === this.slot && r[2] && r[2].n).map(r => r[2].n));
        const due = this.sent.filter(x => x.tick >= a && x.tick < b - APPLY_WITHIN);
        const lost = due.filter(x => !mine.has(x.n)).length;
        if (lost >= 2 && lost > due.length * 0.2) reasons.push({ sev: 'tamper', what: `window ${a}: ${lost} of your ${due.length} orders were never applied` });
        // handing our seat to a bot while our connection was fine
        for (const [t, pi, cmd] of win.cmds) if (pi === this.slot && cmd && cmd.c === 'seat' && cmd.kind === 'bot' && !this.gaps.some(g => Math.abs(g - t) < 300))
          reasons.push({ sev: 'tamper', what: `window ${a}: your colony was handed to a bot while you were connected` });
        // what we were shown live agrees with what the host committed
        for (const [c, st] of [[a, win.sa], [b, end]]) {
          const seen = this.live.get(c); if (!seen) continue;
          const s = typeof st === 'string' ? JSON.parse(st) : st, me = s.players[this.slot]; if (!me) continue;
          let units = 0; for (const u of s.units) if (u.o === this.slot) units++;
          const slack = Math.abs(seen.tick - c) * 3;
          if (Math.abs(me.lumen - seen.lumen) > Math.max(120 + slack, 0.2 * Math.max(me.lumen, seen.lumen)) || Math.abs(units - seen.units) > 3 || me.alive !== seen.alive)
            reasons.push({ sev: 'tamper', what: `tick ${c}: the committed state differs from what you were shown` });
        }
        checked++;
      }
      const verdict = reasons.some(r => r.sev === 'tamper') ? 'tamper' : !checked ? 'unverified' : reasons.some(r => r.sev === 'drift') ? 'drift' : 'ok';
      return { verdict, windows: checked, reasons: reasons.filter(r => r.sev !== 'drift').map(r => r.what).slice(0, 12) };
    }
  }
  E.AuditHost = AuditHost; E.AuditGuest = AuditGuest;
})(window.E);
