// Multiplayer transport (peer-to-peer over WebRTC) and snapshot packing.
// Model: host-authoritative. The host runs the World; guests send commands
// and render interpolated snapshots.
(function (E) {
  'use strict';

  // Peer-to-peer transport. A signaling server (the LAN server or play.ozymandosis.com)
  // introduces the players; every game message then travels over WebRTC
  // DataChannels straight between host and guest, encrypted end to end (DTLS).
  // The server never sees game traffic, and a match survives the server going away.
  // API (unchanged from the old relay): host(name), join(room, name), send(to, data),
  // toHost(data), kick(id), close(); events hosted, joined, peer, left, msg, closed,
  // close (data path lost), sigclose (signaling lost), error, plus server passthroughs.
  const CHUNK = 15000, HIGH_WATER = 1 << 20;
  class Relay {
    constructor(opts) { this.opts = opts || {}; this.ws = null; this.handlers = {}; this.id = -1; this.room = ''; this.role = null; this.peers = new Map(); this.ice = []; this.seq = 0; }
    static defaultUrl() {
      if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return 'ws://192.168.1.10:8080/ws'; // no origin server inside the app: enter the LAN host
      if (location.protocol === 'http:' || location.protocol === 'https:') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      return 'ws://localhost:8080/ws';
    }
    on(op, fn) { this.handlers[op] = fn; return this; }
    emit(op, m) { const h = this.handlers[op]; if (h) try { h(m); } catch (e) { console.error(e); } }
    connect(url) {
      return new Promise((res, rej) => {
        let ws;
        try { ws = new WebSocket(url); } catch (e) { rej(e); return; }
        this.ws = ws;
        const to = setTimeout(() => { rej(new Error('Timed out connecting to ' + url)); try { ws.close(); } catch (e) { /* */ } }, 8000);
        ws.onopen = () => { clearTimeout(to); res(this); };
        ws.onerror = () => { clearTimeout(to); rej(new Error('Could not reach ' + url)); };
        ws.onclose = () => { this.ws = null; this.emit('sigclose'); if (!this.peers.size || this.role !== 'host') { if (this.role !== 'guest' || !this.hostOpen()) this.emit('close'); } };
        ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.onSignal(m); };
      });
    }
    attach(ws) { this.ws = ws; return this; }
    raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    host(name, extra) { this.raw(Object.assign({ op: 'host', name }, extra || {})); }
    join(room, name, extra) { this.raw(Object.assign({ op: 'join', room, name }, extra || {})); }
    hostOpen() { const p = this.peers.get(0); return !!(p && p.dc && p.dc.readyState === 'open'); }
    onSignal(m) {
      switch (m.op) {
        case 'hosted': this.role = 'host'; this.id = 0; this.room = m.room; this.ice = m.ice || []; this.emit('hosted', m); break;
        case 'joined': this.role = 'guest'; this.id = m.id; this.room = m.room; this.ice = m.ice || []; this.pendingJoin = m; this.makePeer(0, m.hostName || 'Host', false); break;
        case 'peer': if (this.role === 'host') this.makePeer(m.id, m.name, true, m); break;
        case 'signal': this.onPeerSignal(m.from, m.data); break;
        case 'left': this.dropPeer(m.id, true); break;
        case 'closed': this.emit('closed', m); break;
        case 'ticket': this.ticket = m; this.emit('ticket', m); break;
        default: this.emit(m.op, m);
      }
    }
    iceConfig() { return { iceServers: this.ice, iceTransportPolicy: this.opts.relayOnly ? 'relay' : 'all' }; }
    makePeer(id, name, initiator, info) {
      this.dropPeer(id, false);
      const pc = new RTCPeerConnection(this.iceConfig());
      const p = { id, name, pc, dc: null, info: info || {}, parts: new Map(), open: false, cands: [] };
      this.peers.set(id, p);
      pc.onicecandidate = e => { if (e.candidate) this.raw({ op: 'signal', to: id, data: { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(id, true); };
      const wire = dc => {
        p.dc = dc; dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
          p.open = true;
          if (this.role === 'host') this.emit('peer', Object.assign({ id, name }, p.info));
          else this.emit('joined', Object.assign({}, this.pendingJoin, { id: this.id, room: this.room }));
        };
        dc.onclose = () => this.dropPeer(id, true);
        dc.onmessage = ev => this.onData(p, ev.data);
      };
      if (initiator) {
        wire(pc.createDataChannel('ozymandosis', { ordered: true }));
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.raw({ op: 'signal', to: id, data: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } })).catch(e => this.emit('error', { msg: 'Could not open a connection: ' + e.message }));
      } else pc.ondatachannel = e => wire(e.channel);
      return p;
    }
    async onPeerSignal(from, d) {
      const p = this.peers.get(from); if (!p || !d) return;
      const pc = p.pc;
      try {
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp);
          for (const c of p.cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.raw({ op: 'signal', to: from, data: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } }); }
        } else if (d.c) { if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {}); else p.cands.push(d.c); }
      } catch (e) { this.emit('error', { msg: 'Connection negotiation failed: ' + e.message }); }
    }
    dropPeer(id, notify) {
      const p = this.peers.get(id); if (!p) return;
      this.peers.delete(id);
      try { if (p.dc) p.dc.close(); p.pc.close(); } catch (e) { /* */ }
      if (!notify) return;
      if (this.role === 'host') { if (p.open) this.emit('left', { id }); }
      else { this.emit('closed', {}); this.emit('close'); }
    }
    // framing: 'M' + json, or chunks 'C' + seq + '|' + index + '|' + count + '|' + part
    onData(p, raw) {
      if (typeof raw !== 'string') return;
      let json;
      if (raw[0] === 'M') json = raw.slice(1);
      else if (raw[0] === 'C') {
        const a = raw.indexOf('|'), b = raw.indexOf('|', a + 1), c = raw.indexOf('|', b + 1);
        const seq = raw.slice(1, a), i = +raw.slice(a + 1, b), n = +raw.slice(b + 1, c);
        let buf = p.parts.get(seq); if (!buf) { buf = { n, got: 0, parts: new Array(n) }; p.parts.set(seq, buf); }
        if (buf.parts[i] === undefined) { buf.parts[i] = raw.slice(c + 1); buf.got++; }
        if (buf.got < buf.n) return;
        p.parts.delete(seq); json = buf.parts.join('');
      } else return;
      let data; try { data = JSON.parse(json); } catch (e) { return; }
      this.emit('msg', { from: p.id, data });
    }
    sendTo(p, data) {
      if (!p || !p.dc || p.dc.readyState !== 'open') return;
      // snapshots are disposable: never queue them behind a congested link
      if (data && data.k === 'snap' && p.dc.bufferedAmount > HIGH_WATER) return;
      const s = JSON.stringify(data);
      if (s.length <= CHUNK) { p.dc.send('M' + s); return; }
      const seq = (++this.seq).toString(36), n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) p.dc.send('C' + seq + '|' + i + '|' + n + '|' + s.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    send(to, data) {
      if (to === 'all') { for (const p of this.peers.values()) if (p.id !== 0 || this.role !== 'host') this.sendTo(p, data); }
      else this.sendTo(this.peers.get(to), data);
    }
    toHost(data) { this.sendTo(this.peers.get(0), data); }
    kick(id) { this.raw({ op: 'kick', id }); this.dropPeer(id, false); }
    peerInfo(id) { const p = this.peers.get(id); return p ? p.info : null; }
    close() { this.handlers = {}; for (const id of [...this.peers.keys()]) this.dropPeer(id, false); if (this.ws) try { this.ws.close(); } catch (e) { /* */ } this.ws = null; }
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
