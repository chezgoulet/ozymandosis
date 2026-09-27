// Multiplayer transport (relay client) and snapshot packing.
// Model: host-authoritative. The host runs the World; guests send commands
// and render interpolated snapshots.
(function (E) {
  'use strict';

  class Relay {
    constructor() { this.ws = null; this.handlers = {}; this.id = -1; this.room = ''; }
    static defaultUrl() {
      if (location.protocol === 'http:' || location.protocol === 'https:') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      return 'ws://localhost:8080/ws';
    }
    on(op, fn) { this.handlers[op] = fn; return this; }
    connect(url) {
      return new Promise((res, rej) => {
        let ws;
        try { ws = new WebSocket(url); } catch (e) { rej(e); return; }
        this.ws = ws;
        const to = setTimeout(() => { rej(new Error('Timed out connecting to ' + url)); try { ws.close(); } catch (e) { /* */ } }, 6000);
        ws.onopen = () => { clearTimeout(to); res(this); };
        ws.onerror = () => { clearTimeout(to); rej(new Error('Could not reach ' + url)); };
        ws.onclose = () => { const h = this.handlers.close; if (h) h(); };
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          const h = this.handlers[m.op]; if (h) h(m);
        };
      });
    }
    raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    host(name) { this.raw({ op: 'host', name }); }
    join(room, name) { this.raw({ op: 'join', room, name }); }
    send(to, data) { this.raw({ op: 'send', to, data }); }
    toHost(data) { this.raw({ op: 'send', to: 'host', data }); }
    kick(id) { this.raw({ op: 'kick', id }); }
    close() { this.handlers = {}; if (this.ws) try { this.ws.close(); } catch (e) { /* */ } this.ws = null; }
  }
  E.Relay = Relay;

  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  E.NetPack = {
    init(w, slot) {
      const s = w.s;
      return { k: 'init', you: slot, cfg: s.cfg, map: s.map, vents: s.vents,
        pools: s.pools.map(r => ({ id: r.id, kind: r.kind, r: r.r, max: r.max, great: r.great, ax: r.ax, ay: r.ay, orbit: r.orbit, spd: r.spd, ph: r.ph })) };
    },
    snap(w, slot, events) {
      const s = w.s;
      return {
        k: 'snap', t: r2(s.t), tick: s.tick, over: s.over, winner: s.winner,
        players: s.players.map(p => { const c = Object.assign({}, p); delete c.ai; return c; }),
        structs: s.structs.map(b => Object.assign({}, b, { x: r1(b.x), y: r1(b.y), hp: Math.round(b.hp) })),
        pools: s.pools.map(r => [r.id, r1(r.x), r1(r.y), Math.round(r.amt)]),
        pickups: s.pickups, clouds: s.clouds, obj: s.obj,
        shots: s.shots.map(h => [r1(h.x), r1(h.y), Math.round(h.vx), Math.round(h.vy), h.o]),
        units: s.units.map(u => [u.id, u.o, u.d, r1(u.x), r1(u.y), r2(u.a), Math.round(u.hp * 10) / 10,
          (u.engaged ? 1 : 0) | (u.harvesting ? 2 : 0) | (u.elite ? 4 : 0) | (u.revealT > 0 ? 8 : 0) | (u.temp ? 16 : 0) | (u.apex ? 32 : 0) | (u.ct === 's' ? 64 : 0) | (u.free ? 128 : 0),
          r1(u.cargo), u.rank, u.buffs.length ? u.buffs.map(b => [b.k, r2(b.v), r1(b.t)]) : 0, r2(u.fade),
          u.o === slot ? [u.order, u.cds, u.q || []] : 0]),
        ev: events,
      };
    },
    // Build the initial mirror World for a guest
    mirror(init) {
      const s = {
        v: 1, cfg: init.cfg, t: 0, tick: 0, rng: 1, nextId: 1, map: init.map, players: [], units: [], structs: [],
        pools: init.pools.map(p => Object.assign({ x: p.ax, y: p.ay, amt: p.max }, p)), vents: init.vents, pickups: [], shots: [], clouds: [], over: false, winner: null, pending: [],
      };
      const w = new E.World({ state: s });
      w.poolById = new Map(w.s.pools.map(p => [p.id, p]));
      w.unitMap = new Map();
      return w;
    },
    apply(w, m) {
      const s = w.s;
      s.t = m.t; s.tick = m.tick; s.over = m.over; s.winner = m.winner;
      s.players = m.players; s.structs = m.structs; s.pickups = m.pickups; s.clouds = m.clouds; s.obj = m.obj;
      for (const [id, x, y, amt] of m.pools) { const p = w.poolById.get(id); if (p) { p.x = x; p.y = y; p.amt = amt; } }
      s.shots = m.shots.map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], o: a[4] }));
      const next = new Map(), list = [];
      for (const a of m.units) {
        const prev = w.unitMap.get(a[0]);
        const u = prev || { id: a[0], cds: {}, order: { t: 'idle', x: a[3], y: a[4] } };
        // interpolate from where we currently draw it
        u.px = prev ? prev.x : a[3]; u.py = prev ? prev.y : a[4];
        u.o = a[1]; u.d = a[2]; u.x = a[3]; u.y = a[4]; u.a = a[5]; u.hp = a[6];
        const f = a[7];
        u.engaged = !!(f & 1); u.harvesting = !!(f & 2); u.elite = f & 4 ? 1 : 0; u.revealT = f & 8 ? 1 : 0;
        u.temp = f & 16 ? 1 : undefined; u.apex = f & 32 ? 1 : 0; u.ct = f & 64 ? 's' : 'l'; u.free = f & 128 ? 1 : 0;
        u.cargo = a[8]; u.rank = a[9]; u.buffs = a[10] ? a[10].map(b => ({ k: b[0], v: b[1], t: b[2] })) : []; u.fade = a[11];
        if (a[12]) { u.order = a[12][0]; u.cds = a[12][1]; u.q = a[12][2]; }
        next.set(u.id, u); list.push(u);
      }
      w.unitMap = next; s.units = list;
      w.index();
    },
  };
})(window.E);
