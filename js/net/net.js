// Multiplayer transport (peer-to-peer over WebRTC) and snapshot packing.
// Model: host-authoritative. The host runs the World; guests send commands
// and render interpolated snapshots.
(function (E) {
  'use strict';

  // Peer-to-peer transport. A signaling server (the LAN host or play.ozymandosis.com)
  // introduces the players; every game message then travels over WebRTC
  // DataChannels between host and guest, encrypted end to end (DTLS): directly on
  // a LAN, through the TURN relay online (D19).
  // The server never sees game traffic, and a match survives the server going away.
  // API (unchanged from the old relay): host(name), join(room, name), send(to, data),
  // toHost(data), kick(id), close(); events hosted, joined, peer, left, msg, closed,
  // close (data path lost), sigclose (signaling lost), error, plus server passthroughs.
  const CHUNK = 15000, HIGH_WATER = 1 << 20;
  // The peer protocol: bump whenever snapshots, commands, game data or the sim
  // change in a way an older build cannot follow. Both sides say hello with it
  // as soon as their DataChannel opens; different protocols never play together.
  E.PROTOCOL = 2;
  const HELLO_WAIT = 6000;
  // A flaky link (Wi-Fi to mobile data, a NAT rebinding) gets an ICE restart and
  // RECOVER_MS to come back before the peer counts as gone.
  const RECOVER_MS = 15000, SOFT_WAIT = 2500;
  // Messages over 1 KB travel deflated when both ends can (CompressionStream).
  // Inbound limits keep a hostile peer from exhausting memory.
  const ZIP = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  const ZIP_MIN = 1024, BIN_CHUNK = 16000, MAX_MSG = 8 << 20, MAX_PARTS = 600, MAX_PARTIALS = 8;
  async function deflate(str) {
    const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str)); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const rd = ds.readable.getReader(), parts = []; let n = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      n += value.byteLength; if (n > MAX_MSG) { rd.cancel().catch(() => {}); throw new Error('message too large'); }
      parts.push(value);
    }
    const out = new Uint8Array(n); let o = 0; for (const v of parts) { out.set(v, o); o += v.byteLength; }
    return new TextDecoder().decode(out);
  }
  class Relay {
    constructor(opts) { this.opts = opts || {}; this.ws = null; this.handlers = {}; this.id = -1; this.room = ''; this.role = null; this.peers = new Map(); this.ice = []; this.seq = 0; }
    static defaultUrl() {
      // A native shell has no origin server, so there is no host we can guess: the
      // host runs on the players' own network and one of them types it. Returning ''
      // rather than a built-in address keeps a private address out of the shipped
      // app, and stops every install from dialling a host that only exists on the
      // developer's LAN. Callers must treat '' as "ask the player".
      if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return '';
      if (location.protocol === 'http:' || location.protocol === 'https:') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      return 'ws://localhost:8080/ws';
    }
    // Accept what a person actually types on a phone: either a full ws:// URL or a
    // bare host:port, which gains the scheme and the /ws path.
    static fromInput(raw) {
      const s = (raw || '').trim(); if (!s) return '';
      if (/^wss?:\/\//i.test(s)) return s;
      return 'ws://' + s.replace(/\/+$/, '').replace(/\/ws$/, '') + '/ws';
    }
    on(op, fn) { this.handlers[op] = fn; return this; }
    emit(op, m) { const h = this.handlers[op]; if (h) try { h(m); } catch (e) { console.error(e); } }
    connect(url) {
      this.url = url;
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
    // D19. Online, every match travels through the TURN relay, unconditionally: no
    // player learns another's address, and no saved setting can turn that off.
    // A LAN match (same network, no service) connects directly, with no ICE
    // servers at all, so it never touches the relay or any outside host.
    iceConfig() { return this.opts.lan ? { iceServers: [], iceTransportPolicy: 'all' } : { iceServers: this.ice, iceTransportPolicy: 'relay' }; }
    makePeer(id, name, initiator, info) {
      this.dropPeer(id, false);
      const pc = new RTCPeerConnection(this.iceConfig());
      const p = { id, name, pc, dc: null, info: info || {}, parts: new Map(), open: false, cands: [], out: Promise.resolve(), inq: Promise.resolve(), queued: 0, z: false };
      this.peers.set(id, p);
      pc.onicecandidate = e => { if (e.candidate) this.raw({ op: 'signal', to: id, data: { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') { if (p.graceT) { clearTimeout(p.graceT); clearTimeout(p.softT); p.graceT = p.softT = null; this.emit('stable', { id }); } }
        else if (st === 'disconnected' || st === 'failed') this.recover(p);
        else if (st === 'closed') this.dropPeer(id, true);
      };
      const wire = dc => {
        p.dc = dc; dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
          dc.send('M' + JSON.stringify({ k: 'hi', p: E.PROTOCOL, v: E.VERSION || '?', z: ZIP }));
          p.helloT = setTimeout(() => this.mismatch(p, null), HELLO_WAIT);
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
    // Keep a wobbling link: restart ICE (the host offers; a guest asks it to), and give up after RECOVER_MS.
    recover(p) {
      const restart = () => { if (this.peers.get(p.id) !== p) return; if (this.role === 'host') this.restartIce(p); else this.raw({ op: 'signal', to: 0, data: { restart: 1 } }); };
      if (p.pc.connectionState === 'failed') { clearTimeout(p.softT); restart(); } else if (!p.softT) p.softT = setTimeout(() => { if (p.pc.connectionState !== 'connected') restart(); }, SOFT_WAIT);
      if (p.graceT) return;
      this.emit('unstable', { id: p.id });
      p.graceT = setTimeout(() => { p.graceT = null; if (p.pc.connectionState !== 'connected') this.dropPeer(p.id, true); }, RECOVER_MS);
    }
    restartIce(p) {
      const pc = p.pc; if (!this.ws || pc.signalingState === 'closed') return;
      try { if (pc.restartIce) pc.restartIce(); } catch (e) { /* older browsers: the iceRestart offer below does it */ }
      pc.createOffer({ iceRestart: true }).then(o => pc.setLocalDescription(o))
        .then(() => this.raw({ op: 'signal', to: p.id, data: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } })).catch(() => {});
    }
    async onPeerSignal(from, d) {
      const p = this.peers.get(from); if (!p || !d) return;
      const pc = p.pc;
      if (d.restart) { if (this.role === 'host') this.restartIce(p); return; }
      try {
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp);
          for (const c of p.cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.raw({ op: 'signal', to: from, data: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } }); }
        } else if (d.c) { if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {}); else p.cands.push(d.c); }
      } catch (e) { this.emit('error', { msg: 'Connection negotiation failed: ' + e.message }); }
    }
    // the other side's hello: same protocol opens the game channel, anything else is refused
    onHello(p, m) {
      clearTimeout(p.helloT);
      if (p.open) return;
      if (m.p !== E.PROTOCOL) { this.mismatch(p, m); return; }
      p.open = true; p.version = String(m.v || '?').slice(0, 20); p.z = ZIP && m.z === true;
      if (this.role === 'host') this.emit('peer', Object.assign({ id: p.id, name: p.name, version: p.version }, p.info));
      else this.emit('joined', Object.assign({}, this.pendingJoin, { id: this.id, room: this.room, hostVersion: p.version }));
    }
    mismatch(p, m) {
      const v = m && String(m.v || '?').slice(0, 20);
      const theirs = !m ? 'an older version' : v === E.VERSION ? 'an incompatible build' : `version ${v}`;
      const newer = m && m.p > E.PROTOCOL;
      const msg = this.role === 'host'
        ? `${p.name} could not join: they run ${theirs} of Ozymandosis and you run ${E.VERSION}. Everyone needs the same version.`
        : `The host runs ${theirs} of Ozymandosis and you run ${E.VERSION}. ${newer ? 'Update the game to join.' : 'The host needs to update.'}`;
      this.emit('error', { msg, code: 'version' });
      if (this.role === 'host') {
        // current guests see the mismatch themselves and leave; builds too old to say hello are removed shortly after
        this.dropPeer(p.id, false);
        setTimeout(() => this.raw({ op: 'kick', id: p.id }), 3000);
      } else { this.dropPeer(p.id, false); this.emit('closed', { reason: 'version' }); this.close(); }
    }
    dropPeer(id, notify) {
      const p = this.peers.get(id); if (!p) return;
      this.peers.delete(id); clearTimeout(p.helloT); clearTimeout(p.graceT); clearTimeout(p.softT);
      try { if (p.dc) p.dc.close(); p.pc.close(); } catch (e) { /* */ }
      if (!notify) return;
      if (this.role === 'host') { if (p.open) this.emit('left', { id }); }
      else { this.emit('close'); this.emit('closed', { link: true }); } // a lost link, not the host ending the game
    }
    // Framing. Text: 'M' + json, or chunks 'C' + seq|index|count|part.
    // Binary (deflated json): [1] + bytes, or chunks [2, seq u32, index u16, count u16] + bytes.
    // Inbound messages are handled strictly in order, even while one inflates.
    onData(p, raw) { p.inq = p.inq.then(() => this.decode(p, raw)).then(data => { if (data !== undefined) this.dispatch(p, data); }).catch(() => {}); }
    partial(p, key, n) {
      let buf = p.parts.get(key);
      if (!buf) {
        if (!(n >= 1 && n <= MAX_PARTS) || p.parts.size >= MAX_PARTIALS) return null;
        buf = { n, got: 0, size: 0, parts: new Array(n) }; p.parts.set(key, buf);
      }
      return buf.n === n ? buf : null;
    }
    async decode(p, raw) {
      if (typeof raw === 'string') {
        let json;
        if (raw[0] === 'M') json = raw.slice(1);
        else if (raw[0] === 'C') {
          const a = raw.indexOf('|'), b = raw.indexOf('|', a + 1), c = raw.indexOf('|', b + 1);
          const i = +raw.slice(a + 1, b), n = +raw.slice(b + 1, c), buf = this.partial(p, 't' + raw.slice(1, a), n);
          if (!buf || !(i >= 0 && i < n)) return undefined;
          if (buf.parts[i] === undefined) { buf.parts[i] = raw.slice(c + 1); buf.got++; buf.size += raw.length; }
          if (buf.size > MAX_MSG) { p.parts.delete('t' + raw.slice(1, a)); return undefined; }
          if (buf.got < buf.n) return undefined;
          p.parts.delete('t' + raw.slice(1, a)); json = buf.parts.join('');
        } else return undefined;
        try { return JSON.parse(json); } catch (e) { return undefined; }
      }
      if (!(raw instanceof ArrayBuffer) || !raw.byteLength) return undefined;
      const u8 = new Uint8Array(raw);
      let bytes;
      if (u8[0] === 1) bytes = u8.subarray(1);
      else if (u8[0] === 2 && u8.length > 9) {
        const dv = new DataView(raw), key = 'b' + dv.getUint32(1), i = dv.getUint16(5), n = dv.getUint16(7), buf = this.partial(p, key, n);
        if (!buf || i >= n) return undefined;
        if (buf.parts[i] === undefined) { buf.parts[i] = u8.slice(9); buf.got++; buf.size += u8.length - 9; }
        if (buf.size > MAX_MSG) { p.parts.delete(key); return undefined; }
        if (buf.got < buf.n) return undefined;
        p.parts.delete(key);
        bytes = new Uint8Array(buf.size); let o = 0; for (const x of buf.parts) { bytes.set(x, o); o += x.byteLength; }
      } else return undefined;
      try { return JSON.parse(await inflate(bytes)); } catch (e) { return undefined; }
    }
    dispatch(p, data) {
      if (data && data.k === 'hi') { this.onHello(p, data); return; }
      if (!p.open) return; // nothing but the hello until the protocols agree
      this.emit('msg', { from: p.id, data });
    }
    // A peer whose link is backed up: skip its snapshot this round (they are disposable).
    congested(id) { const p = this.peers.get(id); return !p || !p.dc || p.dc.readyState !== 'open' || p.dc.bufferedAmount > HIGH_WATER || p.queued > 4; }
    sendTo(p, data) {
      if (!p || !p.dc || p.dc.readyState !== 'open') return;
      const s = JSON.stringify(data);
      p.queued++;
      p.out = p.out.then(async () => {
        if (!p.dc || p.dc.readyState !== 'open') return;
        if (p.z && s.length > ZIP_MIN) this.sendBin(p, await deflate(s));
        else this.sendText(p, s);
      }).catch(() => {}).then(() => { p.queued--; });
    }
    sendText(p, s) {
      if (s.length <= CHUNK) { p.dc.send('M' + s); return; }
      const seq = (++this.seq).toString(36), n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) p.dc.send('C' + seq + '|' + i + '|' + n + '|' + s.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    sendBin(p, bytes) {
      if (!p.dc || p.dc.readyState !== 'open') return;
      if (bytes.byteLength + 1 <= BIN_CHUNK) { const b = new Uint8Array(bytes.byteLength + 1); b[0] = 1; b.set(bytes, 1); p.dc.send(b.buffer); return; }
      const seq = (++this.seq) >>> 0, n = Math.ceil(bytes.byteLength / BIN_CHUNK);
      for (let i = 0; i < n; i++) {
        const part = bytes.subarray(i * BIN_CHUNK, (i + 1) * BIN_CHUNK), b = new Uint8Array(part.byteLength + 9), dv = new DataView(b.buffer);
        b[0] = 2; dv.setUint32(1, seq); dv.setUint16(5, i); dv.setUint16(7, n); b.set(part, 9);
        p.dc.send(b.buffer);
      }
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
  // What a player may know about a rival colony during a match: what it looks like
  // (designs, organs, its glow), never its economy, research or where it started.
  const PUBLIC = ['idx', 'name', 'culture', 'team', 'kind', 'alive', 'dropped', 'tier', 'forms', 'chassis', 'specials', 'designs', 'techVer', 'persona', 'energy', 'fever', 'echoT', 'income'];
  const VIS_CELL = 64, EDGE = 80;
  // Player fields that change rarely: sent only when they change for that guest (the memo).
  const SLOW = ['name', 'culture', 'team', 'designs', 'forms', 'chassis', 'specials', 'tier', 'research', 'persona', 'start', 'dseq', 'autocast', 'techVer'];
  E.NetPack = {
    init(w, slot) {
      const s = w.s;
      return { k: 'init', you: slot, cfg: s.cfg, map: s.map, vents: s.vents,
        pools: s.pools.map(r => ({ id: r.id, kind: r.kind, r: r.r, max: r.max, great: r.great, ax: r.ax, ay: r.ay, orbit: r.orbit, spd: r.spd, ph: r.ph })) };
    },
    // Everything the slot's team can see right now (plus an edge so creatures glide in),
    // or null when the slot may see everything (no fog, echo, spectating, match over).
    sight(w, slot) {
      const s = w.s, me = s.players[slot];
      if (!s.cfg.map.fog || s.over || !me || !me.alive || me.echoT > 0) return null;
      const cols = Math.ceil(s.map.w / VIS_CELL), rows = Math.ceil(s.map.h / VIS_CELL), g = new Uint8Array(cols * rows);
      for (const src of w.visionSources(slot)) {
        const r = src.r + EDGE, c0 = Math.max(0, Math.floor((src.x - r) / VIS_CELL)), c1 = Math.min(cols - 1, Math.floor((src.x + r) / VIS_CELL));
        const r0 = Math.max(0, Math.floor((src.y - r) / VIS_CELL)), rr1 = Math.min(rows - 1, Math.floor((src.y + r) / VIS_CELL)), rr = (r + VIS_CELL) * (r + VIS_CELL);
        for (let cy = r0; cy <= rr1; cy++) { const dy = (cy + 0.5) * VIS_CELL - src.y; for (let cx = c0; cx <= c1; cx++) { const dx = (cx + 0.5) * VIS_CELL - src.x; if (dx * dx + dy * dy <= rr) g[cy * cols + cx] = 1; } }
      }
      return (x, y) => { const cx = Math.floor(x / VIS_CELL), cy = Math.floor(y / VIS_CELL); return cx >= 0 && cy >= 0 && cx < cols && cy < rows && g[cy * cols + cx] === 1; };
    },
    // One guest's snapshot: its own team in full; rivals only where it can see them.
    // memo (per guest, reset on init) remembers the slow player fields it already has.
    snap(w, slot, events, memo) {
      const s = w.s, see = this.sight(w, slot);
      // owned by the slot's team (neutral things, with no owner, are nobody's ally)
      const ally = o => o === slot || (o >= 0 && !!s.players[o] && !w.isEnemy(slot, o));
      const shown = (o, x, y) => !see || ally(o) || see(x, y);
      const players = s.players.map(p => {
        let c;
        if (!see || ally(p.idx)) { c = Object.assign({}, p); delete c.ai; }
        else {
          c = {}; for (const k of PUBLIC) if (p[k] !== undefined) c[k] = p[k];
          c.lumen = Math.min(20, Math.round(p.lumen)); // only "is it starving" shows in its glow
        }
        if (memo) {
          const slow = {}; for (const k of SLOW) if (c[k] !== undefined) slow[k] = c[k];
          const key = JSON.stringify(slow);
          if (memo[p.idx] === key) { for (const k of SLOW) delete c[k]; c.$ = 1; } else memo[p.idx] = key;
        }
        return c;
      });
      const units = [];
      for (const u of s.units) {
        if (!shown(u.o, u.x, u.y) || (see && !ally(u.o) && w.isStealthed(u))) continue;
        units.push([u.id, u.o, u.d, r1(u.x), r1(u.y), r2(u.a), Math.round(u.hp * 10) / 10,
          (u.engaged ? 1 : 0) | (u.harvesting ? 2 : 0) | (u.elite ? 4 : 0) | (u.revealT > 0 ? 8 : 0) | (u.temp ? 16 : 0) | (u.apex ? 32 : 0) | (u.ct === 's' ? 64 : 0) | (u.free ? 128 : 0),
          r1(u.cargo), u.rank, u.buffs.length ? u.buffs.map(b => [b.k, r2(b.v), r1(b.t)]) : 0, r2(u.fade),
          u.o === slot ? [u.order, u.cds, u.q || []] : 0]);
      }
      return {
        k: 'snap', t: r2(s.t), tick: s.tick, over: s.over, winner: s.winner, fog: !!see,
        players,
        structs: s.structs.filter(b => shown(b.o, b.x, b.y)).map(b => Object.assign({}, b, { x: r1(b.x), y: r1(b.y), hp: Math.round(b.hp) })),
        pools: s.pools.map(r => !see || see(r.x, r.y) ? [r.id, r1(r.x), r1(r.y), Math.round(r.amt)] : [r.id, r1(r.x), r1(r.y)]),
        pickups: see ? s.pickups.filter(k => see(k.x, k.y)) : s.pickups,
        clouds: see ? s.clouds.filter(c => ally(c.o) || see(c.x, c.y)) : s.clouds,
        obj: s.obj,
        shots: s.shots.filter(h => shown(h.o, h.x, h.y)).map(h => [r1(h.x), r1(h.y), Math.round(h.vx), Math.round(h.vy), h.o]),
        units,
        ev: see ? events.filter(ev => ev.x === undefined ? (ev.o === undefined || ally(ev.o) || ev.e === 'eliminated' || ev.e === 'objective') : ally(ev.o) || ev.by === slot || see(ev.x, ev.y)) : events,
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
    // local: the guest's slot; seen(x, y): what it sees right now (its renderer's vision), for fog memory
    apply(w, m, local, seen) {
      const s = w.s;
      s.t = m.t; s.tick = m.tick; s.over = m.over; s.winner = m.winner;
      // players marked $ kept their slow fields (designs, research…): carry them over
      const prev = s.players;
      for (const p of m.players) if (p.$) { const o = prev[p.idx]; if (o) for (const k of SLOW) if (o[k] !== undefined && p[k] === undefined) p[k] = o[k]; delete p.$; }
      s.players = m.players; s.pickups = m.pickups; s.clouds = m.clouds; s.obj = m.obj;
      // Fog memory: rival structures stay where they were last seen until we look
      // again (or watch them die), the way scouting works in any RTS.
      const ghosts = w.ghosts || (w.ghosts = new Map()), live = new Set(m.structs.map(b => b.id)), gone = new Set();
      for (const ev of m.ev || []) if (ev.e === 'destroy' && ev.id !== undefined) gone.add(ev.id);
      const rival = o => !(local >= 0) || !(o >= 0) || !s.players[o] || w.isEnemy(local, o);
      if (!m.fog) ghosts.clear();
      else for (const b of s.structs) if (!live.has(b.id) && !gone.has(b.id) && rival(b.o)) ghosts.set(b.id, Object.assign(b, { ghost: true }));
      for (const id of live) ghosts.delete(id);
      for (const id of gone) ghosts.delete(id);
      for (const [id, b] of ghosts) if (seen && seen(b.x, b.y)) ghosts.delete(id);
      s.structs = ghosts.size ? m.structs.concat([...ghosts.values()]) : m.structs;
      for (const a of m.pools) { const p = w.poolById.get(a[0]); if (p) { p.x = a[1]; p.y = a[2]; if (a.length > 3) p.amt = a[3]; } }
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
