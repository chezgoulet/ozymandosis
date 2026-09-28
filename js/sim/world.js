// The World: a deterministic, fully serializable simulation.
// All game rules live here. Rendering, UI, audio and networking only read
// world state and submit commands through world.command().
(function (E) {
  'use strict';
  const TAU = E.TAU, DT = E.DT;
  const dist = E.dist, clamp = E.clamp;

  E.STRUCTS = {
    nucleus: { name: 'Nucleus', hp: 6000, armor: 0.3, r: 38, pop: 20, silt: 1.5, lance: { dps: 24, range: 220 }, sight: 380, dropoff: true, hatch: true },
    bud: { name: 'Bud', hp: 1400, armor: 0.2, r: 26, pop: 10, silt: 0.5, lance: { dps: 8, range: 150 }, sight: 300, dropoff: true, hatch: true, cost: { l: 150, s: 0 }, build: 25,
      desc: 'An outpost nucleus. Drop-off point and hatchery. +10 population.' },
    spire: { name: 'Spire', hp: 800, armor: 0.2, r: 18, pop: 0, silt: 0, shot: { dmg: 14, cd: 1, range: 240 }, sight: 340, detect: 240, cost: { l: 110, s: 20 }, build: 18,
      desc: 'A defensive polyp. Fires stinging darts and reveals hidden creatures.' },
  };
  E.DIFFS = {
    easy: { name: 'Gentle', income: 0.7, think: 2.2, wave: [8, 16], first: 420 },
    normal: { name: 'Tidal', income: 1, think: 1.3, wave: [10, 24], first: 280 },
    hard: { name: 'Abyssal', income: 1.25, think: 0.8, wave: [12, 30], first: 210 },
    brutal: { name: 'Leviathan', income: 1.6, think: 0.5, wave: [14, 36], first: 170 },
  };
  E.POP_MAX = 120;
  // Healing. Creatures knit slowly once out of combat; beside their own Nucleus or
  // Bud they mend fast, paid in lumen. Structures regrow slowly when left alone.
  E.MEND = { delay: 5, natural: 0.01, nestReach: 70, nest: 0.12, lumenPerHp: 0.25, nestDelay: 1.5, structDelay: 8, struct: 0.004 };
  const RANK_XP = [60, 180, 420];
  // commands only the host itself may issue; a host drops these when a guest sends them
  E.HOST_CMDS = new Set(['seat']);

  class World {
    constructor(opts) {
      this.events = [];
      this.cache = new Map();
      this.grid = new E.Grid(128);
      this._q = [];
      if (opts.state) { this.s = typeof opts.state === 'string' ? JSON.parse(opts.state) : opts.state; }
      else this.s = this.create(opts.cfg);
      if (!this.s.pending) this.s.pending = [];
      this.index();
    }

    // ── setup ───────────────────────────────────────────────────
    create(cfg) {
      cfg = E.deepCopy(cfg);
      cfg.map = Object.assign({}, E.DEFAULT_MAP, cfg.map || {});
      const map = E.generateMap(cfg.map, cfg.players);
      const s = {
        v: 1, cfg, t: 0, tick: 0, rng: (cfg.map.seed * 7919 + 17) | 0, nextId: map.nextId + 1,
        map: { w: map.w, h: map.h, currents: map.currents },
        players: [], units: [], structs: [], pools: map.pools, vents: map.vents, pickups: [], shots: [], clouds: [],
        over: false, winner: null,
      };
      this.s = s;
      cfg.players.forEach((pc, i) => {
        const cult = E.CULTURES[pc.culture] || E.CULTURE_LIST[i % 6];
        const p = {
          idx: i, name: pc.name || cult.short, culture: cult.id, team: pc.team || 0, kind: pc.kind || 'bot', diff: pc.diff || 'normal',
          lumen: cfg.map.startLumen, spore: cfg.map.startSpore || 0, fever: 0, energy: 0, alive: true,
          tier: { leg: 0, flagella: 0, pili: 0, mandible: 0, antenna: 0 },
          forms: E.ORGAN_LIST.filter(o => o.form === 1).map(o => o.id).concat(cult.startForm ? [cult.startForm] : []),
          chassis: ['serpent'].concat(cult.startChassis ? [cult.startChassis] : []),
          specials: [], research: [], powerCd: {}, autocast: {}, techVer: 0,
          designs: [
            Object.assign({}, E.BUILTIN_DESIGNS._forager, { id: 'forager' }),
            Object.assign({}, E.BUILTIN_DESIGNS._warden, { id: 'warden' }),
            Object.assign({}, E.SIGNATURES[cult.id]),
          ].concat((pc.designs || []).map((d, k) => Object.assign({}, d, { id: 'c' + k }))),
          dseq: 1, stats: { hatched: 0, lost: 0, kills: 0, gathered: 0, spore: 0, dmg: 0, built: 0, peak: 0, mended: 0 },
          persona: pc.persona && E.PERSONAS && E.PERSONAS[pc.persona] ? pc.persona : undefined,
          echoT: 0, coralT: 0, income: pc.kind === 'bot' ? E.DIFFS[pc.diff || 'normal'].income : 1, ai: {}, start: map.starts[i],
        };
        s.players.push(p);
        const st = map.starts[i];
        const nuc = this.addStruct(i, 'nucleus', st.x, st.y, true);
        const toC = Math.atan2(map.h / 2 - st.y, map.w / 2 - st.x);
        nuc.rally = { x: st.x + Math.cos(toC) * 120, y: st.y + Math.sin(toC) * 120 };
        for (let k = 0; k < 5; k++) {
          const a = toC + (k - 2) * 0.5;
          const u = this.spawnUnit(i, 'forager', st.x + Math.cos(a) * 70, st.y + Math.sin(a) * 70, { fade: 1 });
          p.stats.hatched--;
        }
        this.spawnUnit(i, 'warden', nuc.rally.x, nuc.rally.y, { fade: 1 }); p.stats.hatched--;
      });
      return s;
    }
    index() {
      this.byId = new Map();
      for (const u of this.s.units) this.byId.set(u.id, u);
      for (const b of this.s.structs) this.byId.set(b.id, b);
      for (const r of this.s.pools) this.byId.set(r.id, r);
      for (const k of this.s.pickups) this.byId.set(k.id, k);
    }
    serialize() { return JSON.stringify(this.s); }
    rand() {
      let a = (this.s.rng = (this.s.rng + 0x6d2b79f5) | 0);
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    id() { return this.s.nextId++; }
    event(e, d) { d = d || {}; d.e = e; this.events.push(d); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    // ── lookup helpers ──────────────────────────────────────────
    player(i) { return this.s.players[i]; }
    unitById(id) { return this.byId.get(id); }
    teamOf(i) { const p = this.s.players[i]; return p.team ? p.team : 100 + i; }
    isEnemy(a, b) { return a !== b && this.teamOf(a) !== this.teamOf(b); }
    designOf(p, id) {
      if (typeof p === 'number') p = this.s.players[p];
      return p.designs.find(d => d.id === id) || E.BUILTIN_DESIGNS[id] || p.designs[0];
    }
    statsFor(pi, did, rank, elite) {
      const p = this.s.players[pi];
      const key = pi + '|' + did + '|' + (rank || 0) + '|' + (elite || 0) + '|' + p.techVer;
      let st = this.cache.get(key);
      if (!st) {
        st = E.computeStats(this.designOf(p, did), { tier: p.tier, culture: p.culture, specials: p.specials, rank, elite });
        if (this.cache.size > 4000) this.cache.clear();
        this.cache.set(key, st);
      }
      return st;
    }
    stats(u) { return this.statsFor(u.o, u.d, u.rank, u.elite); }
    popOf(pi) {
      const p = this.s.players[pi];
      let cap = 0, used = 0;
      for (const b of this.s.structs) if (b.o === pi && b.build >= 1) cap += E.STRUCTS[b.kind].pop;
      for (const u of this.s.units) if (u.o === pi && !u.temp && !u.free) used++;
      const cult = E.CULTURES[p.culture];
      return { used, cap: Math.min(cap, (this.s.cfg.map.popCap || E.POP_MAX) + (cult.popBonus || 0)) };
    }
    buff(u, k, dur, v, src, x) {
      if (!u.buffs) return;
      const b = u.buffs.find(b => b.k === k);
      if (b) { b.t = Math.max(b.t, dur); b.v = Math.max(b.v, v); if (x !== undefined) b.x = x; b.s = src; }
      else u.buffs.push({ k, t: dur, v, s: src, x });
    }
    buffV(u, k) { if (!u.buffs) return 0; for (const b of u.buffs) if (b.k === k) return b.v; return 0; }
    isStealthed(u) {
      if (u.kind !== undefined) return false;
      if (this.buffV(u, 'veil')) return true;
      if (this.buffV(u, 'camo') && u.revealT <= 0) return true;
      const cult = E.CULTURES[this.s.players[u.o].culture];
      if (cult.stealth && u.revealT <= 0) return true;
      for (const c of this.s.clouds) if (c.kind === 'ink' && !this.isEnemy(c.o, u.o) && E.dist2(c.x, c.y, u.x, u.y) < c.r * c.r) return true;
      return false;
    }
    inEnemyInk(u) {
      for (const c of this.s.clouds) if (c.kind === 'ink' && this.isEnemy(c.o, u.o) && E.dist2(c.x, c.y, u.x, u.y) < c.r * c.r) return true;
      return false;
    }
    // Can a creature/structure of owner `o` at (x,y) with detect radius see target?
    canTarget(o, x, y, detect, tg) {
      if (tg.kind !== undefined) return true;
      if (!this.isStealthed(tg)) return true;
      if (E.dist2(x, y, tg.x, tg.y) < detect * detect) return true;
      // Spires reveal hidden creatures for their whole team
      for (const b of this.s.structs) if (b.kind === 'spire' && b.build >= 1 && !this.isEnemy(b.o, o) && E.dist2(b.x, b.y, tg.x, tg.y) < 240 * 240) return true;
      return false;
    }
    enemiesNear(o, x, y, r) {
      const out = [];
      for (const e of this.grid.query(x, y, r, this._q)) if (e.hp > 0 && this.isEnemy(o, e.o)) out.push(e);
      return out;
    }
    alliesNear(o, x, y, r) {
      const out = [];
      for (const e of this.grid.query(x, y, r, this._q)) if (e.hp > 0 && e.kind === undefined && !this.isEnemy(o, e.o)) out.push(e);
      return out;
    }
    targetOf(u) {
      const id = u.order.t === 'attack' ? u.order.id : u.tgt;
      const t = id && this.byId.get(id);
      return t && t.hp > 0 ? t : null;
    }

    // ── entity creation ─────────────────────────────────────────
    addStruct(o, kind, x, y, built) {
      const sd = E.STRUCTS[kind];
      const b = { id: this.id(), o, kind, x, y, hp: built ? sd.hp : sd.hp * 0.1, build: built ? 1 : 0.01, queue: [], rally: { x, y: y + 80 }, shotT: 0, lastHit: null };
      this.s.structs.push(b); this.byId && this.byId.set(b.id, b);
      return b;
    }
    spawnUnit(o, did, x, y, opts) {
      opts = opts || {};
      const p = this.s.players[o];
      const design = this.designOf(p, did);
      const u = {
        id: this.id(), o, d: design.id, x, y, px: x, py: y,
        a: this.rand() * TAU, hp: 1, cargo: 0, ct: 'l', order: { t: 'idle', x, y }, tgt: 0, acqT: 0, cds: {}, buffs: [], xp: 0, rank: 0,
        fade: opts.fade === undefined ? 0 : opts.fade, age: 0, revealT: 0, ambushT: 0, lastHit: null, shotT: 0, engaged: false, aT: this.rand() * 0.5,
      };
      if (opts.temp) u.temp = opts.temp;
      if (opts.free) u.free = 1;
      if (opts.zooid) u.zooid = 1;
      if (opts.apex) u.apex = 1;
      const st = this.stats(u);
      u.hp = st.hp * (opts.hpFrac || 1);
      if (!opts.noOrder) {
        if (st.canHarvest && (design.role === 'harvest' || st.role === 'Harvester')) {
          const r = this.nearestPool(u, 'lumen'); if (r) u.order = { t: 'harvest', rid: r.id };
        }
      }
      this.s.units.push(u); this.byId && this.byId.set(u.id, u);
      if (!opts.free && !opts.temp) p.stats.hatched++;
      return u;
    }
    spawnApex(p) {
      if (p.apex && this.byId.get(p.apex)) return false;
      const n = this.s.structs.find(b => b.o === p.idx && b.kind === 'nucleus') || this.s.structs.find(b => b.o === p.idx);
      if (!n) return false;
      const u = this.spawnUnit(p.idx, '_leviathan', n.x, n.y + 50, { free: true, apex: true });
      u.order = { t: 'idle', x: n.rally.x, y: n.rally.y };
      p.apex = u.id;
      this.event('apex', { x: u.x, y: u.y, o: p.idx });
      return true;
    }
    cloud(c) { c.id = this.id(); c.t = c.dur; this.s.clouds.push(c); this.event('cloud', { kind: c.kind, x: c.x, y: c.y, r: c.r, o: c.o }); }
    shot(u, x, y, dmg, opts) {
      opts = opts || {};
      const a = Math.atan2(y - u.y, x - u.x), sp = opts.speed || 360;
      const d = Math.hypot(x - u.x, y - u.y);
      this.s.shots.push({ id: this.id(), o: u.o, src: u.id, x: u.x, y: u.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, tid: opts.tid || 0, aoe: opts.aoe || 0, ttl: d / sp + 0.05, pierce: opts.pierce || 0, onHit: opts.onHit || null });
    }
    nearestPool(u, kind) {
      let best = null, bd = Infinity;
      const home = this.nearestDrop(u.o, u.x, u.y);
      for (const r of this.s.pools) {
        if (kind && r.kind !== kind) continue;
        if (r.amt < 30) continue;
        const d = dist(u, r) + (home ? dist(r, home) * 0.7 : 0);
        if (d < bd) { bd = d; best = r; }
      }
      return best;
    }
    nearestDrop(o, x, y) {
      let best = null, bd = Infinity;
      for (const b of this.s.structs) {
        if (b.o !== o || b.build < 1 || !E.STRUCTS[b.kind].dropoff) continue;
        const d = E.dist2(b.x, b.y, x, y); if (d < bd) { bd = d; best = b; }
      }
      return best;
    }

    // ── combat ──────────────────────────────────────────────────
    damage(tg, amt, srcO, src, opts) {
      if (!tg || tg.hp <= 0 || amt <= 0) return 0;
      opts = opts || {};
      let dmg = amt;
      if (tg.kind === undefined) {
        const ts = this.stats(tg);
        if (!opts.dot) dmg *= 1 - ts.evasion;
        let armor = ts.armor + this.buffV(tg, 'plate');
        armor = Math.min(0.8, armor) * (1 - (opts.pierce || 0));
        dmg *= 1 - armor;
        const hard = this.buffV(tg, 'harden'); if (hard) dmg *= 1 - hard;
        if (this.inEddy(tg.x, tg.y)) dmg *= 0.85; // vortex cores are cover
        if (opts.melee && src && ts.thorns && !opts.noThorns) this.damage(src, dmg * ts.thorns, tg.o, tg, { noThorns: true, dot: true });
      } else dmg *= 1 - (E.STRUCTS[tg.kind].armor || 0) * (1 - (opts.pierce || 0));
      if (srcO !== undefined && srcO !== null && tg.o !== undefined) dmg *= this.counterMul(srcO, tg.o);
      tg.hp -= dmg;
      if (srcO !== undefined && srcO !== null) {
        tg.lastHit = { o: srcO, t: this.s.t, src: src ? src.id : 0 };
        const sp = this.s.players[srcO]; if (sp) sp.stats.dmg += dmg;
      }
      if (src && src.kind === undefined && src.hp > 0) {
        src.xp += dmg;
        const ss = this.stats(src);
        let leech = ss.leech; if (this.s.players[src.o].specials.includes('hunger')) leech += 0.1;
        if (leech && !opts.dot) this.heal(src, dmg * leech);
        if (!opts.dot && tg.kind === undefined) {
          if (ss.slowOnHit) this.buff(tg, 'slow', 1.5, ss.slowOnHit, src.o);
          if (ss.poison) this.buff(tg, 'poison', 4, ss.poison, src.o);
          if (ss.bleed) this.buff(tg, 'bleed', 3, ss.bleed, src.o);
          const coat = this.buffV(src, 'coat'); if (coat) this.buff(tg, 'poison', 4, coat, src.o);
        }
        const need = RANK_XP[src.rank] * (this.s.players[src.o].specials.includes('metamorph') ? 0.5 : 1);
        if (src.rank < 3 && src.xp >= need) this.rankUp(src);
      }
      if (tg.kind !== undefined && tg.o !== undefined && this.s.t - (tg.alertT || -99) > 12) {
        tg.alertT = this.s.t; this.event('alert', { x: tg.x, y: tg.y, o: tg.o, kind: tg.kind });
      }
      return dmg;
    }
    inEddy(x, y) {
      for (const c of this.s.map.currents) if (c.kind === 'vortex' && E.dist2(c.x, c.y, x, y) < c.r * c.r * 0.09) return true;
      return false;
    }
    // The Tide Wheel: +12% against cultures you pressure, −8% against those that pressure you.
    counterMul(a, b) {
      const pa = this.s.players[a], pb = this.s.players[b]; if (!pa || !pb || a === b) return 1;
      const A = E.CULTURES[pa.culture], B = E.CULTURES[pb.culture];
      return A.pressures.includes(B.id) ? 1.12 : B.pressures.includes(A.id) ? 0.92 : 1;
    }
    // An own, finished hatchery (Nucleus or Bud) close enough to mend beside.
    nestFor(u) {
      for (const b of this.s.structs) {
        if (b.o !== u.o || b.build < 1 || b.hp <= 0 || !E.STRUCTS[b.kind].hatch) continue;
        const r = E.STRUCTS[b.kind].r + E.MEND.nestReach;
        if (E.dist2(b.x, b.y, u.x, u.y) < r * r) return b;
      }
      return null;
    }
    nearestNest(o, x, y) {
      let best = null, bd = Infinity;
      for (const b of this.s.structs) if (b.o === o && b.build >= 1 && b.hp > 0 && E.STRUCTS[b.kind].hatch) { const d = E.dist2(b.x, b.y, x, y); if (d < bd) { bd = d; best = b; } }
      return best;
    }
    heal(u, amt) { if (u.hp <= 0) return; const s = u.kind === undefined ? this.stats(u) : E.STRUCTS[u.kind]; u.hp = Math.min(s.hp, u.hp + amt); }
    rankUp(u) {
      if (u.rank >= 3) return;
      const f = u.hp / this.stats(u).hp; u.rank++; u.hp = f * this.stats(u).hp;
      this.event('rank', { x: u.x, y: u.y, o: u.o, rank: u.rank });
    }

    // ── commands ────────────────────────────────────────────────
    command(pi, cmd) { this.s.pending.push({ pi, cmd: E.deepCopy(cmd) }); }
    applyCommand(pi, c) {
      const p = this.s.players[pi]; if (!p || !p.alive || this.s.over) return;
      const mine = (c.ids || []).map(id => this.byId.get(id)).filter(u => u && u.o === pi && u.kind === undefined && u.hp > 0);
      const spread = (i) => ({ dx: Math.cos(i * 2.4) * Math.sqrt(i) * 14, dy: Math.sin(i * 2.4) * Math.sqrt(i) * 14 });
      switch (c.c) {
        case 'move': case 'amove': case 'hold': case 'patrol':
          mine.forEach((u, i) => {
            const o = spread(i), x = clamp(c.x + o.dx, 10, this.s.map.w - 10), y = clamp(c.y + o.dy, 10, this.s.map.h - 10);
            const ord = { t: c.c, x, y };
            this.giveOrder(u, ord, c.queue);
          });
          break;
        case 'mend': mine.forEach(u => { const n = this.nearestNest(pi, u.x, u.y); if (n) this.giveOrder(u, { t: 'mend', id: n.id, x: n.x, y: n.y }, c.queue); }); break;
        case 'stop': mine.forEach(u => { u.order = { t: 'idle', x: u.x, y: u.y }; u.tgt = 0; u.q = []; }); break;
        // host only (never accepted from a guest): a seat changes hands between a player and a bot
        case 'seat': p.kind = c.kind === 'bot' ? 'bot' : 'remote'; p.dropped = c.kind === 'bot'; if (c.diff && E.DIFFS[c.diff]) p.diff = c.diff; if (c.income) p.income = +c.income || 1; break;
        case 'attack': { const t = this.byId.get(c.tid); if (t && t.hp > 0 && this.isEnemy(pi, t.o)) mine.forEach(u => this.giveOrder(u, { t: 'attack', id: t.id }, c.queue)); break; }
        case 'restore': {
          // undo: put back the orders a unit had before a mis-tap (only order shapes, only own units)
          const OK = { idle: 1, move: 1, amove: 1, hold: 1, patrol: 1, attack: 1, harvest: 1, mend: 1 };
          for (const r of (c.orders || []).slice(0, 200)) {
            const u = this.byId.get(r.id);
            if (!u || u.o !== pi || u.kind !== undefined || !r.order || !OK[r.order.t]) continue;
            u.order = this.cleanOrder(r.order, u); u.q = (r.q || []).slice(0, 12).filter(o => o && OK[o.t]).map(o => this.cleanOrder(o, u)); u.tgt = 0;
          }
          break;
        }
        case 'harvest': {
          const r = this.byId.get(c.rid);
          if (!r || r.amt === undefined) break;
          mine.forEach((u, i) => {
            if (this.stats(u).canHarvest) u.order = { t: 'harvest', rid: r.id };
            else { const o = spread(i); u.order = { t: 'amove', x: r.x + o.dx, y: r.y + o.dy }; }
          });
          break;
        }
        case 'pickup': { const k = this.byId.get(c.kid); if (k) mine.forEach(u => (u.order = { t: 'move', x: k.x, y: k.y })); break; }
        case 'build': {
          const sd = E.STRUCTS[c.kind]; if (!sd || !sd.cost || !mine.length) break;
          if (!this.canPlace(pi, c.kind, c.x, c.y)) { this.event('deny', { o: pi, why: 'Too close to another structure' }); break; }
          if (p.lumen < sd.cost.l || p.spore < sd.cost.s) { this.event('deny', { o: pi, why: 'Not enough resources' }); break; }
          p.lumen -= sd.cost.l; p.spore -= sd.cost.s;
          let best = mine[0]; for (const u of mine) if (E.dist2(u.x, u.y, c.x, c.y) < E.dist2(best.x, best.y, c.x, c.y)) best = u;
          best.order = { t: 'build', k: c.kind, x: c.x, y: c.y, paid: 1 };
          break;
        }
        case 'hatch': {
          const b = c.sid ? this.byId.get(c.sid) : this.bestHatchery(pi);
          if (!b || b.o !== pi || b.build < 1 || !E.STRUCTS[b.kind].hatch) break;
          const d = this.designOf(p, c.d); if (!d || d.chassis === 'leviathan') break;
          if (E.designLock(d, p)) { this.event('deny', { o: pi, why: E.designLock(d, p) }); break; }
          const n = Math.max(1, Math.min(10, c.n || 1));
          for (let k = 0; k < n; k++) {
            const st = this.statsFor(pi, d.id, 0, 0);
            if (b.queue.length >= 8) break;
            if (p.lumen < st.cost || p.spore < st.spore) { if (!k) this.event('deny', { o: pi, why: 'Not enough resources' }); break; }
            p.lumen -= st.cost; p.spore -= st.spore;
            b.queue.push({ d: d.id, t: 0, dur: st.hatch, l: st.cost, s: st.spore });
          }
          break;
        }
        case 'cancel': {
          const b = this.byId.get(c.sid); if (!b || b.o !== pi) break;
          const q = b.queue.splice(c.i | 0, 1)[0]; if (q) { p.lumen += q.l; p.spore += q.s; }
          break;
        }
        case 'rally': { const b = this.byId.get(c.sid); if (b && b.o === pi) b.rally = { x: c.x, y: c.y }; break; }
        case 'research': {
          const tech = E.TECHS[c.key]; if (!tech) break;
          if (tech.have(p) || p.research.some(r => r.key === c.key)) break;
          if (!this.techReady(p, tech)) break;
          const cost = this.techCost(p, tech);
          if (p.lumen < cost.l || p.spore < cost.s) { this.event('deny', { o: pi, why: 'Not enough resources' }); break; }
          if (p.research.length >= 6) break;
          p.lumen -= cost.l; p.spore -= cost.s;
          p.research.push({ key: c.key, t: 0, dur: tech.time * E.CULTURES[p.culture].mods.research, l: cost.l, s: cost.s });
          break;
        }
        case 'unresearch': {
          const i = p.research.findIndex(r => r.key === c.key); if (i < 0) break;
          const r = p.research.splice(i, 1)[0]; p.lumen += r.l; p.spore += r.s; break;
        }
        case 'ability': {
          const ab = E.ABILITIES[c.ab]; if (!ab) break;
          const ready = mine.filter(u => this.stats(u).abilities.includes(c.ab) && !(u.cds[c.ab] > 0) && !this.buffV(u, 'stun'));
          if (!ready.length) break;
          if (ab.target === 'self') ready.forEach(u => this.cast(u, ab, u));
          else {
            const tg = ab.target === 'unit' ? this.byId.get(c.tid) : { x: c.x, y: c.y };
            if (!tg) break;
            let best = ready[0]; for (const u of ready) if (E.dist2(u.x, u.y, tg.x, tg.y) < E.dist2(best.x, best.y, tg.x, tg.y)) best = u;
            if (ab.range && dist(best, tg) > ab.range * 1.15) { best.order = { t: 'move', x: tg.x, y: tg.y }; best.pendingCast = { ab: c.ab, x: tg.x, y: tg.y, tid: c.tid }; break; }
            this.cast(best, ab, tg);
          }
          break;
        }
        case 'autocast': p.autocast[c.ab] = c.on ? 0 : 1; break; // stored inverted: 1 = disabled
        case 'power': {
          const pw = E.POWERS[c.id]; if (!pw || pw.kind !== 'active' || !p.specials.includes(c.id)) break;
          if ((p.powerCd[c.id] || 0) > 0) break;
          if ((pw.useLumen || 0) > p.lumen || (pw.useSpore || 0) > p.spore) { this.event('deny', { o: pi, why: 'Not enough resources' }); break; }
          const ok = pw.cast(this, p, { x: c.x, y: c.y });
          if (ok === false) break;
          p.lumen -= pw.useLumen || 0; p.spore -= pw.useSpore || 0;
          p.powerCd[c.id] = pw.cd;
          this.event('power', { id: c.id, o: pi, x: c.x, y: c.y });
          break;
        }
        case 'design': {
          const d = c.design; if (!d || !E.CHASSIS[d.chassis] || E.CHASSIS[d.chassis].hero) break;
          const ch = E.CHASSIS[d.chassis];
          const organs = (d.organs || []).filter(o => E.ORGANS[o]).slice(0, ch.slots);
          if (!organs.length) break;
          if (p.designs.length >= 24) break;
          const nd = { id: 'u' + p.dseq++, name: String(d.name || 'Design').slice(0, 24), chassis: d.chassis, organs, role: d.role === 'harvest' ? 'harvest' : undefined };
          p.designs.push(nd);
          this.event('design', { o: pi, id: nd.id });
          break;
        }
        case 'deldesign': { const i = p.designs.findIndex(d => d.id === c.id && d.id[0] === 'u'); if (i >= 0) p.designs.splice(i, 1); break; }
        case 'surrender': for (const b of this.s.structs) if (b.o === pi) b.hp = 0; break;
      }
    }
    cleanOrder(o, u) {
      const m = this.s.map, n = { t: o.t };
      if (o.x !== undefined) { n.x = clamp(+o.x || 0, 10, m.w - 10); n.y = clamp(+o.y || 0, 10, m.h - 10); }
      if (o.t === 'attack' || o.t === 'mend') n.id = o.id | 0;
      if (o.t === 'harvest') n.rid = o.rid | 0;
      if (o.t === 'patrol') { n.ax = o.ax !== undefined ? clamp(+o.ax, 10, m.w - 10) : u.x; n.ay = o.ay !== undefined ? clamp(+o.ay, 10, m.h - 10) : u.y; }
      if (n.x === undefined && o.t !== 'attack' && o.t !== 'harvest') { n.x = u.x; n.y = u.y; }
      return n;
    }
    // Replace the current order, or append to the waypoint queue (shift/queue mode).
    giveOrder(u, ord, queue) {
      if (!u.q) u.q = [];
      const busy = u.order.t !== 'idle' && u.order.t !== 'hold';
      if (queue && busy) { if (u.q.length < 12) u.q.push(ord); return; }
      if (ord.t === 'patrol') { ord.ax = u.x; ord.ay = u.y; }
      u.order = ord; u.tgt = 0; if (!queue) u.q = [];
    }
    // Current order finished: take the next waypoint, or rest where we are.
    nextOrder(u, x, y) {
      const n = u.q && u.q.length ? u.q.shift() : null;
      if (n) { if (n.t === 'patrol') { n.ax = u.x; n.ay = u.y; } u.order = n; }
      else u.order = { t: 'idle', x: x === undefined ? u.x : x, y: y === undefined ? u.y : y };
      u.tgt = 0;
    }
    techCost(p, t) { const m = E.CULTURES[p.culture].mods.research; return { l: Math.round(t.cost.l * m), s: Math.round(t.cost.s * m) }; }
    techReady(p, t) { return !t.have(p) && t.req(p); }
    bestHatchery(pi) {
      let best = null;
      for (const b of this.s.structs) if (b.o === pi && b.build >= 1 && E.STRUCTS[b.kind].hatch && (!best || b.queue.length < best.queue.length)) best = b;
      return best;
    }
    canPlace(pi, kind, x, y) {
      const m = this.s.map, r = E.STRUCTS[kind].r;
      if (x < r + 20 || y < r + 20 || x > m.w - r - 20 || y > m.h - r - 20) return false;
      for (const b of this.s.structs) if (E.dist2(b.x, b.y, x, y) < Math.pow(kind === 'spire' || b.kind === 'spire' ? 90 : 260, 2)) return false;
      return true;
    }
    cast(u, ab, tg) {
      ab.cast(this, u, tg);
      u.cds[ab.id] = ab.cd;
      u.revealT = Math.max(u.revealT, 1.5);
      this.event('ability', { id: ab.id, x: u.x, y: u.y, o: u.o, tx: tg && tg.x, ty: tg && tg.y });
    }

    // ── the tick ────────────────────────────────────────────────
    step() {
      const s = this.s;
      if (s.over) return;
      const pend = s.pending; s.pending = [];
      // an online host keeps the applied command stream so guests can audit it (js/net/audit.js)
      if (this.rec) for (const { pi, cmd } of pend) this.rec.push([s.tick, pi, cmd]);
      for (const { pi, cmd } of pend) this.applyCommand(pi, cmd);
      s.t += DT; s.tick++;
      // pools & vents
      for (const r of s.pools) {
        r.x = r.ax + Math.cos(s.t * r.spd + r.ph) * r.orbit; r.y = r.ay + Math.sin(s.t * r.spd * 1.3 + r.ph) * r.orbit * 0.7;
        r.amt = Math.min(r.max, r.amt + (r.kind === 'spore' ? 0.6 : 1.4) * DT);
      }
      if (s.cfg.map.powerups) for (const v of s.vents) {
        v.t -= DT;
        if (v.t <= 0) {
          v.t = (60 + this.rand() * 50) / s.cfg.map.powerups;
          if (!s.pickups.some(k => k.vent === v.id)) {
            const pu = E.POWERUP_LIST[Math.floor(this.rand() * E.POWERUP_LIST.length)];
            const k = { id: this.id(), k: pu.id, x: v.x, y: v.y, vent: v.id }; s.pickups.push(k); this.byId.set(k.id, k);
            this.event('spawnPickup', { x: v.x, y: v.y, k: pu.id });
          }
        }
      }
      // grid
      this.grid.clear();
      for (const u of s.units) if (u.hp > 0) this.grid.insert(u);
      for (const b of s.structs) if (b.hp > 0) this.grid.insert(b);
      // players
      const fighting = new Array(s.players.length).fill(0), busy = new Array(s.players.length).fill(0), count = new Array(s.players.length).fill(0);
      for (const u of s.units) { count[u.o]++; if (u.engaged) { fighting[u.o]++; busy[u.o]++; } else if (u.harvesting) busy[u.o]++; }
      for (const p of s.players) {
        if (!p.alive) continue;
        p.fever = Math.max(0, p.fever - 0.03 * DT);
        p.fever = Math.min(1, p.fever + 0.004 * DT * fighting[p.idx]);
        const tgt = (count[p.idx] ? busy[p.idx] / count[p.idx] : 0) * 0.8 + p.fever * 0.2;
        p.energy += (tgt - p.energy) * Math.min(1, DT * 1.5);
        for (const k in p.powerCd) p.powerCd[k] = Math.max(0, p.powerCd[k] - DT);
        p.echoT = Math.max(0, (p.echoT || 0) - DT); p.coralT = Math.max(0, (p.coralT || 0) - DT);
        const lanes = Math.min(3, 1 + s.structs.filter(b => b.o === p.idx && b.kind === 'bud' && b.build >= 1).length);
        for (let i = 0; i < Math.min(lanes, p.research.length); i++) {
          const r = p.research[i]; r.t += DT;
          if (r.t >= r.dur) { p.research.splice(i, 1); i--; this.complete(p, r.key); }
        }
        if (count[p.idx] > p.stats.peak) p.stats.peak = count[p.idx];
      }
      // structures
      for (const b of s.structs) this.updateStruct(b);
      // units
      for (const u of s.units) if (u.hp > 0) this.updateUnit(u);
      this.separate();
      // shots & clouds
      this.updateShots(); this.updateClouds();
      // deaths
      this.reap();
      // bots
      for (const p of s.players) {
        if (!p.alive || p.kind !== 'bot') continue;
        p.ai.t = (p.ai.t === undefined ? p.idx * 0.37 : p.ai.t) - DT;
        if (p.ai.t <= 0) { p.ai.t = E.DIFFS[p.diff].think; E.AI.tick(this, p); }
        E.AI.micro(this, p);
      }
      this.checkVictory();
    }
    complete(p, key) {
      const t = E.TECHS[key]; if (!t) return;
      if (t.kind === 'tier') p.tier[t.cls] = Math.max(p.tier[t.cls], t.lvl);
      else if (t.kind === 'form') { if (!p.forms.includes(t.organ)) p.forms.push(t.organ); }
      else if (t.kind === 'chassis') { if (!p.chassis.includes(t.chassis)) p.chassis.push(t.chassis); }
      else if (t.kind === 'power') { if (!p.specials.includes(t.power)) p.specials.push(t.power); }
      p.stats.evolved = (p.stats.evolved || 0) + 1;
      // keep hp fraction across stat changes
      const fr = new Map(); for (const u of this.s.units) if (u.o === p.idx) fr.set(u, u.hp / this.stats(u).hp);
      p.techVer++;
      for (const [u, f] of fr) u.hp = f * this.stats(u).hp;
      this.event('research', { o: p.idx, key });
    }

    updateStruct(b) {
      const s = this.s, sd = E.STRUCTS[b.kind], p = s.players[b.o];
      if (b.hp <= 0) return;
      if (b.build < 1) {
        b.build = Math.min(1, b.build + DT / sd.build);
        b.hp = Math.min(sd.hp, b.hp + sd.hp * 0.9 * DT / sd.build);
        if (b.build >= 1) { this.event('built', { x: b.x, y: b.y, o: b.o, kind: b.kind }); p.stats.built++; }
        return;
      }
      if (p.specials.includes('roots')) b.hp = Math.min(sd.hp, b.hp + 4 * DT);
      if (b.hp < sd.hp && (!b.lastHit || s.t - b.lastHit.t > E.MEND.structDelay)) b.hp = Math.min(sd.hp, b.hp + sd.hp * E.MEND.struct * DT);
      if (sd.silt) { const g = sd.silt * (p.specials.includes('roots') ? 2 : 1) * p.income * DT; p.lumen += g; }
      // hatching
      const q = b.queue[0];
      if (q) {
        const pop = this.popOf(b.o);
        if (pop.used < pop.cap) {
          q.t += DT * (1 + 0.5 * p.fever);
          if (q.t >= q.dur) {
            b.queue.shift();
            const a = Math.atan2(b.rally.y - b.y, b.rally.x - b.x) + (this.rand() - 0.5) * 0.8;
            const hatchOne = () => {
              const u = this.spawnUnit(b.o, q.d, b.x + Math.cos(a) * sd.r, b.y + Math.sin(a) * sd.r);
              u.a = a;
              if (u.order.t !== 'harvest') u.order = { t: 'amove', x: b.rally.x + (this.rand() - 0.5) * 50, y: b.rally.y + (this.rand() - 0.5) * 50 };
              this.event('hatch', { x: u.x, y: u.y, o: b.o, id: u.id });
            };
            hatchOne();
            if (p.specials.includes('mitosis') && this.rand() < 0.15) hatchOne();
            p.fever = Math.min(1, p.fever + 0.04);
          }
        }
      }
      // defense
      b.shotT -= DT;
      if (sd.lance || (sd.shot && b.shotT <= 0)) {
        const range = sd.lance ? sd.lance.range : sd.shot.range;
        let best = null, bd = range * range;
        for (const e of this.grid.query(b.x, b.y, range, this._q)) {
          if (e.kind !== undefined || e.hp <= 0 || !this.isEnemy(b.o, e.o)) continue;
          if (!this.canTarget(b.o, b.x, b.y, sd.detect || 60, e)) continue;
          const d = E.dist2(b.x, b.y, e.x, e.y); if (d < bd) { bd = d; best = e; }
        }
        b.lance = best ? best.id : 0;
        if (best) {
          if (sd.lance) this.damage(best, sd.lance.dps * DT, b.o, null, { dot: true });
          else { b.shotT = sd.shot.cd; this.s.shots.push({ id: this.id(), o: b.o, src: 0, x: b.x, y: b.y, vx: 0, vy: 0, dmg: sd.shot.dmg, tid: best.id, aoe: 0, ttl: 2, pierce: 0 }); this.event('spire', { x: b.x, y: b.y, o: b.o }); }
        }
      }
    }

    updateUnit(u) {
      const s = this.s, p = s.players[u.o], st = this.stats(u);
      u.px = u.x; u.py = u.y;
      u.age += DT; u.fade = Math.min(1, u.fade + DT * 1.2);
      if (u.temp !== undefined) { u.temp -= DT; if (u.temp <= 0) { u.hp = 0; u.withered = 1; return; } }
      if (st.lifespan && u.age >= st.lifespan && !u.free) { u.hp = 0; u.withered = 1; return; }
      u.revealT = Math.max(0, u.revealT - DT); u.ambushT = Math.max(0, u.ambushT - DT);
      for (const k in u.cds) u.cds[k] = Math.max(0, u.cds[k] - DT);
      // buffs
      let slow = 0, stun = false;
      for (let i = u.buffs.length - 1; i >= 0; i--) {
        const b = u.buffs[i]; b.t -= DT;
        if (b.k === 'poison' || b.k === 'bleed') this.damage(u, b.v * DT, b.s, null, { dot: true });
        else if (b.k === 'drain') { const src = this.byId.get(b.x); this.damage(u, b.v * DT, b.s, null, { dot: true }); if (src && src.hp > 0) this.heal(src, b.v * DT); }
        else if (b.k === 'hot') this.heal(u, b.v * DT);
        else if (b.k === 'slow') slow = Math.max(slow, b.v);
        else if (b.k === 'stun') stun = true;
        if (b.t <= 0) u.buffs.splice(i, 1);
      }
      if (st.regen) this.heal(u, st.regen * DT);
      if (u.hp < st.hp) {
        const since = u.lastHit ? s.t - u.lastHit.t : 1e9;
        if (since > E.MEND.delay) this.heal(u, st.hp * E.MEND.natural * DT);
        // the nest: fast mending, paid for in lumen, only out of the fight
        if (since > E.MEND.nestDelay && this.nestFor(u)) {
          const want = Math.min(st.hp - u.hp, st.hp * E.MEND.nest * DT), cost = want * E.MEND.lumenPerHp;
          if (want > 0 && p.lumen >= cost) { p.lumen -= cost; u.hp += want; p.stats.mended = (p.stats.mended || 0) + want; }
        }
      }
      if (p.fever > 0.6 && !(p.coralT > 0)) u.hp -= (p.fever - 0.6) * 6 * DT;
      // periodic auras (every 0.5s)
      u.aT -= DT;
      if (u.aT <= 0) {
        u.aT = 0.5;
        if (st.aura) for (const a of this.alliesNear(u.o, u.x, u.y, 120)) this.buff(a, 'aura', 0.6, st.aura, u.o);
        if (st.lure) for (const e of this.enemiesNear(u.o, u.x, u.y, 80)) if (e.kind === undefined) this.buff(e, 'slow', 0.6, st.lure, u.o);
        if (st.sting) for (const e of this.enemiesNear(u.o, u.x, u.y, 40)) this.damage(e, st.sting * 0.5, u.o, u, { dot: true });
        if (p.specials.includes('symbiosis') && this.alliesNear(u.o, u.x, u.y, 90).length >= 4) this.buff(u, 'hot', 0.6, 1.5, u.o);
        // autocast
        if (!stun && (p.kind === 'bot' || p.kind === 'remote' || p.kind === 'human')) {
          for (const ab of st.abilities) {
            if (u.cds[ab] > 0 || p.autocast[ab]) continue;
            const A = E.ABILITIES[ab]; const tg = A.auto(this, u, st);
            if (tg) { this.cast(u, A, tg); break; }
          }
        }
      }
      if (u.pendingCast) {
        const pc = u.pendingCast, A = E.ABILITIES[pc.ab];
        const tg = A.target === 'unit' ? this.byId.get(pc.tid) : pc;
        if (!tg || tg.hp <= 0 && A.target === 'unit' || u.cds[pc.ab] > 0) u.pendingCast = null;
        else if (dist(u, tg) <= (A.range || 0)) { this.cast(u, A, tg); u.pendingCast = null; u.order = { t: 'idle', x: u.x, y: u.y }; }
      }
      u.engaged = false; u.harvesting = false;
      let tx = u.x + Math.cos(u.a) * 20, ty = u.y + Math.sin(u.a) * 20, spK = 1;
      const o = u.order;
      if (!stun) {
        if (o.t === 'harvest') {
          const r = this.byId.get(o.rid);
          const full = u.cargo >= st.cargo - 0.01;
          if (!st.canHarvest) u.order = { t: 'idle', x: u.x, y: u.y };
          else if (full || (u.cargo > 0 && (!r || r.amt < 3))) {
            const d = this.nearestDrop(u.o, u.x, u.y);
            if (!d) u.order = { t: 'idle', x: u.x, y: u.y };
            else {
              tx = d.x; ty = d.y;
              if (dist(u, d) < E.STRUCTS[d.kind].r + 14) {
                if (u.ct === 's') { const g = u.cargo * (E.CULTURES[p.culture].sporeMul || 1); p.spore += g; p.stats.spore += g; }
                else { p.lumen += u.cargo; p.stats.gathered += u.cargo; }
                u.cargo = 0;
                this.event('deposit', { x: d.x, y: d.y, o: u.o });
              }
            }
          } else {
            let pool = r;
            if (!pool || pool.amt < 3) { pool = this.nearestPool(u, r ? r.kind : 'lumen'); if (pool) o.rid = pool.id; }
            if (!pool) u.order = { t: 'idle', x: u.x, y: u.y };
            else {
              if (u.ct !== (pool.kind === 'spore' ? 's' : 'l')) { u.cargo = 0; u.ct = pool.kind === 'spore' ? 's' : 'l'; }
              if (dist(u, pool) < pool.r * 0.85) {
                u.harvesting = true;
                let rate = st.harvest * p.income;
                if (pool.kind === 'spore') rate *= 0.35 * (st.sporeBonus ? 2 : 1);
                const take = Math.min(rate * DT, pool.amt, st.cargo - u.cargo);
                u.cargo += take; pool.amt -= take;
                if (!u.wp || E.dist2(u.wp.x, u.wp.y, u.x, u.y) < 100 || E.dist2(u.wp.x, u.wp.y, pool.x, pool.y) > pool.r * pool.r) {
                  const a = this.rand() * TAU, rr = this.rand() * pool.r * 0.55; u.wp = { x: pool.x + Math.cos(a) * rr, y: pool.y + Math.sin(a) * rr };
                }
                tx = u.wp.x; ty = u.wp.y; spK = 0.55;
              } else { tx = pool.x; ty = pool.y; }
            }
          }
          // harvesters defend themselves only if attacked in melee range
        } else if (o.t === 'mend') {
          // swim home and stay beside the nest until whole; ignore fights on the way
          let n = this.byId.get(o.id);
          if (!n || n.hp <= 0 || n.o !== u.o) { n = this.nearestNest(u.o, u.x, u.y); if (n) { o.id = n.id; o.x = n.x; o.y = n.y; } }
          if (!n) this.nextOrder(u);
          else {
            const r = E.STRUCTS[n.kind].r + E.MEND.nestReach * 0.6;
            if (E.dist2(u.x, u.y, n.x, n.y) < r * r) {
              if (u.hp >= st.hp - 0.01 || p.lumen < 0.5) this.nextOrder(u);
              if (!u.wp || E.dist2(u.wp.x, u.wp.y, u.x, u.y) < 144) { const a = this.rand() * TAU, rr = E.STRUCTS[n.kind].r + 12 + this.rand() * 30; u.wp = { x: n.x + Math.cos(a) * rr, y: n.y + Math.sin(a) * rr }; }
              tx = u.wp.x; ty = u.wp.y; spK = 0.35;
            } else { tx = n.x; ty = n.y; }
          }
        } else if (o.t === 'build') {
          tx = o.x; ty = o.y;
          if (E.dist2(u.x, u.y, o.x, o.y) < 36 * 36) {
            const sd = E.STRUCTS[o.k];
            if (this.canPlace(u.o, o.k, o.x, o.y)) { this.addStruct(u.o, o.k, o.x, o.y, false); this.event('plant', { x: o.x, y: o.y, o: u.o, kind: o.k }); }
            else { p.lumen += sd.cost.l; p.spore += sd.cost.s; this.event('deny', { o: u.o, why: 'Site blocked. Refunded.' }); }
            this.nextOrder(u);
          }
        } else {
          const blind = this.inEnemyInk(u);
          let target = null;
          if (o.t === 'attack') {
            target = this.byId.get(o.id);
            if (!target || target.hp <= 0 || (target.kind === undefined && !this.canTarget(u.o, u.x, u.y, st.detect, target) && E.dist2(u.x, u.y, target.x, target.y) > 90000)) { this.nextOrder(u); target = null; }
          }
          if (!target && o.t !== 'move' && !blind) {
            u.acqT -= DT;
            if (u.acqT <= 0) { u.acqT = 0.25; u.tgt = this.acquire(u, st, o.t === 'hold' ? Math.max(st.range, st.shotRange) + 20 : st.sense); }
            let t = u.tgt ? this.byId.get(u.tgt) : null;
            if (t && (t.hp <= 0 || !this.canTarget(u.o, u.x, u.y, st.detect, t))) { t = null; u.tgt = 0; }
            // leash for idle/hold
            if (t && o.t === 'idle' && E.dist2(o.x, o.y, u.x, u.y) > 420 * 420) { t = null; u.tgt = 0; }
            target = t;
          }
          if (target && !blind) {
            const tr = target.kind !== undefined ? E.STRUCTS[target.kind].r : 6 * this.stats(target).size;
            const d = dist(u, target);
            tx = target.x; ty = target.y;
            if (st.shot) {
              if (d < st.shotRange + tr) {
                u.engaged = true;
                u.shotT -= DT;
                if (u.shotT <= 0) {
                  u.shotT = st.shotCd;
                  const mul = this.dmgMul(u, p);
                  this.shot(u, target.x, target.y, st.shot * mul, { tid: target.id, pierce: st.pierce });
                  u.revealT = 2;
                }
                // kite: hold at 80% range
                if (d < st.shotRange * 0.6) { const a = Math.atan2(u.y - target.y, u.x - target.x); tx = u.x + Math.cos(a) * 40; ty = u.y + Math.sin(a) * 40; }
                else { const a = u.id + s.t * 0.6; tx = target.x + Math.cos(a) * st.shotRange * 0.8; ty = target.y + Math.sin(a) * st.shotRange * 0.8; spK = 0.5; }
              }
            } else if (d < st.range + tr + 6) {
              u.engaged = true; spK = 0.6;
              const a = u.id * 1.7 + s.t * 1.6;
              tx = target.x + Math.cos(a) * (tr + st.range * 0.6); ty = target.y + Math.sin(a) * (tr + st.range * 0.6);
              const cult = E.CULTURES[p.culture];
              if (cult.stealth && u.revealT <= 0) u.ambushT = 1.5;
              let dmg = st.dps * DT * this.dmgMul(u, p) * (u.ambushT > 0 ? 2 : 1);
              this.damage(target, dmg, u.o, u, { melee: true, pierce: st.pierce });
              if (!this.buffV(u, 'veil')) u.revealT = 2;
            }
            if (o.t === 'hold') { tx = o.x; ty = o.y; }
          } else if (o.t !== 'attack') {
            const d2 = E.dist2(o.x, o.y, u.x, u.y);
            tx = o.x; ty = o.y;
            if (d2 < 45 * 45) {
              if (o.t === 'patrol') { u.order = { t: 'patrol', x: o.ax, y: o.ay, ax: o.x, ay: o.y }; u.wp = null; }
              else if (o.t === 'move' || o.t === 'amove') this.nextOrder(u, o.x, o.y);
              if (!u.wp || E.dist2(u.wp.x, u.wp.y, u.x, u.y) < 144 || E.dist2(u.wp.x, u.wp.y, o.x, o.y) > 3600) u.wp = { x: o.x + (this.rand() * 2 - 1) * 40, y: o.y + (this.rand() * 2 - 1) * 40 };
              tx = u.wp.x; ty = u.wp.y; spK = o.t === 'hold' ? 0.3 : 0.45;
            }
          }
        }
      }
      // movement
      const pal = E.panicOf(p.fever);
      let spd = st.speed * spK * (1 + 0.45 * p.fever) * (1 - slow) * (1 + this.buffV(u, 'haste')) * (1 + this.buffV(u, 'song') * 0.5);
      if (stun || this.buffV(u, 'harden')) spd = 0;
      if (u.fade < 1) spd *= 0.5 + u.fade * 0.5;
      if (spd > 0) {
        const diff = E.angWrap(Math.atan2(ty - u.y, tx - u.x) - u.a), tr = (st.turn + pal * 3) * DT;
        u.a += clamp(diff, -tr, tr);
        if (pal > 0 && this.rand() < 0.02) u.a += (this.rand() - 0.5) * pal * 0.5;
        spd *= 1 + pal * this.rand() * 0.3;
        u.x += Math.cos(u.a) * spd * DT; u.y += Math.sin(u.a) * spd * DT;
      }
      if (u.dash) { u.x += u.dash.vx * DT; u.y += u.dash.vy * DT; u.dash.t -= DT; if (u.dash.t <= 0) u.dash = null; }
      if (s.map.currents.length) {
        // riding a current speeds you up, fighting it slows you (with the flow ×1.4, against ×0.75)
        const f = E.currentAt(s.map.currents, u.x, u.y); const k = st.chassis === 'nautiloid' || st.chassis === 'carapace' ? 0.5 : 1;
        u.x += f.x * DT * k; u.y += f.y * DT * k;
        if (spd > 0) { const along = Math.cos(u.a) * f.x + Math.sin(u.a) * f.y, mul = clamp(1 + along * 0.012, 0.75, 1.4) - 1; u.x += Math.cos(u.a) * spd * mul * DT; u.y += Math.sin(u.a) * spd * mul * DT; }
      }
      const m = s.map;
      if (u.x < 8) { u.x = 8; u.a = Math.PI - u.a; } else if (u.x > m.w - 8) { u.x = m.w - 8; u.a = Math.PI - u.a; }
      if (u.y < 8) { u.y = 8; u.a = -u.a; } else if (u.y > m.h - 8) { u.y = m.h - 8; u.a = -u.a; }
      // pickups
      if (s.pickups.length) for (let i = s.pickups.length - 1; i >= 0; i--) {
        const k = s.pickups[i];
        if (E.dist2(k.x, k.y, u.x, u.y) < 28 * 28) {
          const pu = E.POWERUPS[k.k]; s.pickups.splice(i, 1); this.byId.delete(k.id);
          pu.apply(this, u, p);
          this.event('pickup', { x: k.x, y: k.y, o: u.o, k: k.k });
        }
      }
    }
    dmgMul(u, p) { return (1 + 0.6 * p.fever) * (1 + this.buffV(u, 'song')) * (1 + this.buffV(u, 'aura')); }
    acquire(u, st, r) {
      let best = null, bs = -Infinity;
      for (const e of this.grid.query(u.x, u.y, r, this._q)) {
        if (e.hp <= 0 || !this.isEnemy(u.o, e.o)) continue;
        if (e.kind === undefined && !this.canTarget(u.o, u.x, u.y, st.detect, e)) continue;
        const d = Math.sqrt(E.dist2(u.x, u.y, e.x, e.y));
        let sc = -d;
        if (e.kind === undefined) { const es = this.stats(e); if (es.dps > 2 || es.shot) sc += 200; else sc += 80; }
        if (sc > bs) { bs = sc; best = e; }
      }
      return best ? best.id : 0;
    }
    separate() {
      const q = [];
      for (const a of this.s.units) {
        if (a.hp <= 0) continue;
        this.grid.query(a.x, a.y, 16, q);
        for (const b of q) {
          if (b === a || b.kind !== undefined || b.id < a.id) continue;
          const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 196 && d2 > 0.01) { const d = Math.sqrt(d2), pp = (14 - d) * 2 * DT / d; a.x += dx * pp; a.y += dy * pp; b.x -= dx * pp; b.y -= dy * pp; }
        }
      }
    }
    updateShots() {
      const s = this.s;
      for (let i = s.shots.length - 1; i >= 0; i--) {
        const sh = s.shots[i];
        const tg = sh.tid ? this.byId.get(sh.tid) : null;
        if (tg && tg.hp > 0) { const a = Math.atan2(tg.y - sh.y, tg.x - sh.x), sp = Math.max(300, Math.hypot(sh.vx, sh.vy)); sh.vx = Math.cos(a) * sp; sh.vy = Math.sin(a) * sp; sh.ttl = Math.max(sh.ttl, 0.1); }
        sh.x += sh.vx * DT; sh.y += sh.vy * DT; sh.ttl -= DT;
        const hitUnit = tg && tg.hp > 0 && E.dist2(tg.x, tg.y, sh.x, sh.y) < 144;
        if (hitUnit || sh.ttl <= 0) {
          const src = this.byId.get(sh.src);
          if (sh.aoe) { for (const e of this.enemiesNear(sh.o, sh.x, sh.y, sh.aoe)) this.damage(e, sh.dmg, sh.o, src, { pierce: sh.pierce }); }
          else if (hitUnit) this.damage(tg, sh.dmg, sh.o, src && src.hp > 0 ? src : null, { pierce: sh.pierce });
          this.event('hit', { x: sh.x, y: sh.y, o: sh.o });
          s.shots.splice(i, 1);
        }
      }
    }
    updateClouds() {
      const s = this.s;
      for (let i = s.clouds.length - 1; i >= 0; i--) {
        const c = s.clouds[i]; c.t -= DT;
        if (c.kind === 'venom' || c.kind === 'tide' || c.kind === 'bloom') {
          for (const e of this.grid.query(c.x, c.y, c.r, this._q)) {
            if (e.kind !== undefined || e.hp <= 0) continue;
            const enemy = this.isEnemy(c.o, e.o);
            if (c.kind === 'venom' && enemy) { this.buff(e, 'poison', 1, c.dps, c.o); this.buff(e, 'slow', 0.5, 0.3, c.o); }
            else if (c.kind === 'tide') {
              if (enemy) { const a = Math.atan2(e.y - c.y, e.x - c.x), d = Math.hypot(e.x - c.x, e.y - c.y); e.x += (Math.cos(a) * 70 - Math.sin(a) * 50) * (1 - d / c.r) * DT; e.y += (Math.sin(a) * 70 + Math.cos(a) * 50) * (1 - d / c.r) * DT; this.buff(e, 'slow', 0.5, 0.3, c.o); }
              else this.buff(e, 'haste', 0.5, 0.2, c.o);
            } else if (c.kind === 'bloom' && !enemy) this.buff(e, 'hot', 0.5, this.stats(e).hp * 0.12, c.o);
          }
        }
        if (c.t <= 0) s.clouds.splice(i, 1);
      }
    }
    reap() {
      const s = this.s;
      for (let i = s.units.length - 1; i >= 0; i--) {
        const u = s.units[i]; if (u.hp > 0) continue;
        const k = u.lastHit, p = s.players[u.o];
        const killer = k && s.t - k.t < 1.5 && this.isEnemy(k.o, u.o) ? s.players[k.o] : null;
        if (!u.withered && killer) {
          killer.stats.kills++;
          if (killer.specials.includes('hunger')) killer.lumen += 8;
          const kc = E.CULTURES[killer.culture];
          if (kc.convert && !u.apex && !u.zooid && this.rand() < kc.convert) {
            // conversion: keep the body, change allegiance
            const design = this.designOf(p, u.d);
            const nd = design.id[0] === '_' ? design.id : this.adoptDesign(killer, design);
            p.stats.lost++;
            u.o = killer.idx; u.d = nd; u.hp = this.stats(u).hp * 0.5; u.buffs = []; u.order = { t: 'idle', x: u.x, y: u.y }; u.tgt = 0; u.lastHit = null; u.free = 1; u.age = 0; u.cargo = 0;
            this.event('convert', { x: u.x, y: u.y, o: killer.idx, from: p.idx, id: u.id });
            continue;
          }
        }
        s.units.splice(i, 1); this.byId.delete(u.id);
        if (!u.temp) p.stats.lost++;
        if (u.apex) p.apex = 0;
        this.event('die', { id: u.id, x: u.x, y: u.y, o: u.o, withered: !!u.withered, by: killer ? killer.idx : -1, d: u.d });
      }
      for (let i = s.structs.length - 1; i >= 0; i--) {
        const b = s.structs[i]; if (b.hp > 0) continue;
        s.structs.splice(i, 1); this.byId.delete(b.id);
        const k = b.lastHit; if (k && s.players[k.o]) s.players[k.o].stats.kills++;
        for (const q of b.queue) { s.players[b.o].lumen += q.l; }
        this.event('destroy', { x: b.x, y: b.y, o: b.o, kind: b.kind, by: k ? k.o : -1 });
      }
    }
    adoptDesign(p, design) {
      const ex = p.designs.find(d => d.chassis === design.chassis && d.organs.join() === design.organs.join());
      if (ex) return ex.id;
      const nd = { id: 'x' + p.dseq++, name: design.name + ' (taken)', chassis: design.chassis, organs: design.organs.slice(), captured: true };
      p.designs.push(nd); return nd.id;
    }
    checkVictory() {
      const s = this.s;
      if (s.tick % 15) return;
      const mode = s.cfg.map.mode || 'annihilation';
      for (const p of s.players) {
        if (!p.alive) continue;
        const dead = mode === 'regicide' ? !s.structs.some(b => b.o === p.idx && b.kind === 'nucleus') : !s.structs.some(b => b.o === p.idx);
        if (dead) {
          if (mode === 'regicide') for (const b of s.structs) if (b.o === p.idx) b.hp = 0;
          p.alive = false;
          for (const u of s.units) if (u.o === p.idx) { u.hp = 0; u.withered = 1; }
          this.event('eliminated', { o: p.idx });
        }
      }
      const teams = new Set(s.players.filter(p => p.alive).map(p => this.teamOf(p.idx)));
      let winner = teams.size <= 1 ? (teams.size ? [...teams][0] : null) : undefined;
      if (winner === undefined && (mode === 'tide' || mode === 'bloom')) winner = this.objectiveTick(mode, teams);
      if (winner !== undefined) {
        s.over = true; s.winner = winner;
        this.event('over', { winner: s.winner, mode });
      }
    }
    // Tide: hold the great caustics. Bloom: gather the most light. Returns a winning team or undefined.
    objectiveTick(mode, teams) {
      const s = this.s, obj = s.obj || (s.obj = { score: {}, holders: {} });
      const goal = E.objectiveGoal(s.cfg.map);
      if (mode === 'tide') {
        for (const r of s.pools) {
          if (!r.great) continue;
          const present = new Set();
          for (const u of this.grid.query(r.x, r.y, r.r * 1.6, this._q)) if (u.kind === undefined && u.hp > 0) present.add(this.teamOf(u.o));
          const holder = present.size === 1 ? [...present][0] : null;
          if (obj.holders[r.id] !== holder) { obj.holders[r.id] = holder; this.event('objective', { pool: r.id, team: holder, x: r.x, y: r.y }); }
          if (holder !== null) obj.score[holder] = (obj.score[holder] || 0) + 0.5;
        }
      } else {
        for (const tm of teams) obj.score[tm] = 0;
        for (const p of s.players) if (p.alive) obj.score[this.teamOf(p.idx)] = (obj.score[this.teamOf(p.idx)] || 0) + p.stats.gathered;
      }
      for (const tm in obj.score) if (obj.score[tm] >= goal && teams.has(+tm)) return +tm;
      return undefined;
    }
    // Vision radius sources for a player (and allies) — used by fog + UI
    visionSources(pi) {
      const out = [], s = this.s;
      for (const u of s.units) if (!this.isEnemy(pi, u.o)) out.push({ x: u.x, y: u.y, r: this.stats(u).vision });
      for (const b of s.structs) if (!this.isEnemy(pi, b.o)) out.push({ x: b.x, y: b.y, r: E.STRUCTS[b.kind].sight * (b.build >= 1 ? 1 : 0.5) });
      for (const c of s.clouds) if (c.kind === 'flare' && !this.isEnemy(pi, c.o)) out.push({ x: c.x, y: c.y, r: c.r });
      return out;
    }
  }
  E.panicOf = f => { const temp = 33 + f * 15; return temp > 38 ? clamp((temp - 38) / 10, 0, 1) : 0; };
  E.World = World;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
