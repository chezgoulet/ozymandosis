// LAN signaling: introduces players on one network so their browsers can open a
// WebRTC connection straight to each other. It brokers offers, answers and ICE
// candidates only; the match runs peer to peer and never passes through here.
// Shared by the LAN server (server/server.js) and the desktop shell's in-app host
// (apps/desktop). Android and iOS implement the same protocol natively
// (android/…/LanHost.java, ios/…/LanPlugin.swift). Zero dependencies.
//
// Protocol (JSON text frames over /ws):
//   → host {name}              ← hosted {room, id: 0, ice: []}
//   → join {room, name}        ← joined {room, id, ice: [], hostName}; host ← peer {id, name}
//     room '*' joins the only room there is (what a join code or discovery gives you)
//   → signal {to, data}        ← signal {from, data}      (host ↔ guest only)
//   → kick {id}                (host only)
//   ← left {id}, closed, error {msg}
// It never logs addresses (D16): only room codes and the names players chose.
'use strict';
const crypto = require('crypto');

const MAX_FRAME = 4 * 1024 * 1024, MAX_PEERS = 5;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function createSignal(opts) {
  opts = opts || {};
  // A same-network match needs no STUN or TURN: host candidates suffice, and no
  // outside server is contacted (D19). ICE_SERVERS can still override for testing.
  const ICE = opts.ice || [];
  const log = opts.log || (() => {});
  const rooms = new Map();

  // ── minimal RFC 6455 WebSocket ──────────────────────────────────
  function accept(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
    const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    socket.setNoDelay(true);
    const conn = { socket, buf: Buffer.alloc(0), frag: [], alive: true, id: 0, room: null, name: '' };
    socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parse(conn); });
    socket.on('close', () => onClose(conn));
    socket.on('error', () => socket.destroy());
    return conn;
  }
  function parse(c) {
    for (;;) {
      const b = c.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) { c.socket.destroy(); return; }
      const mo = off; if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) { const m = b.subarray(mo, mo + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      c.buf = b.subarray(off + len);
      if (op === 8) { sendFrame(c, 8, Buffer.alloc(0)); c.socket.end(); return; }
      if (op === 9) { sendFrame(c, 10, payload); continue; }
      if (op === 10) { c.alive = true; continue; }
      if (op === 0 || op === 1 || op === 2) {
        c.frag.push(payload);
        if (fin) { const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onMessage(c, msg); }
      }
    }
  }
  function sendFrame(c, op, data) {
    if (c.socket.destroyed) return;
    const len = data.length; let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    c.socket.write(Buffer.concat([head, data]));
  }
  const send = (c, obj) => c && sendFrame(c, 1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));

  // ── rooms ───────────────────────────────────────────────────────
  function code() { let s; do { s = ''; for (let i = 0; i < 4; i++) s += LETTERS[crypto.randomInt(LETTERS.length)]; } while (rooms.has(s)); return s; }
  function onMessage(c, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.op === 'host') {
      if (c.room) return;
      const room = { code: code(), host: c, peers: new Map(), seq: 0 };
      rooms.set(room.code, room); c.room = room; c.id = 0; c.name = String(m.name || 'Host').slice(0, 18);
      send(c, { op: 'hosted', room: room.code, id: 0, ice: ICE });
      log(`room ${room.code} hosted by ${c.name}`);
    } else if (m.op === 'join') {
      if (c.room) return;
      const want = String(m.room || '').toUpperCase();
      const room = want === '*' ? (rooms.size === 1 ? [...rooms.values()][0] : null) : rooms.get(want);
      if (!room) return send(c, { op: 'error', msg: want === '*' ? (rooms.size ? 'More than one game is open there. Enter its room code.' : 'No game is open there yet.') : 'No room with that code.' });
      if (room.peers.size >= MAX_PEERS) return send(c, { op: 'error', msg: 'Room is full.' });
      c.room = room; c.id = ++room.seq; c.name = String(m.name || 'Guest').slice(0, 18);
      room.peers.set(c.id, c);
      send(c, { op: 'joined', room: room.code, id: c.id, ice: ICE, hostName: room.host.name });
      send(room.host, { op: 'peer', id: c.id, name: c.name });
      log(`${c.name} joined ${room.code}`);
    } else if (m.op === 'signal' && c.room && m.data && typeof m.data === 'object') {
      // WebRTC negotiation only: host ↔ guest, never guest ↔ guest
      const room = c.room, to = c === room.host ? room.peers.get(m.to) : m.to === 0 ? room.host : null;
      if (to) send(to, { op: 'signal', from: c.id, data: m.data });
    } else if (m.op === 'kick' && c.room && c === c.room.host) {
      const p = c.room.peers.get(m.id); if (p) { send(p, { op: 'error', msg: 'Removed by host.' }); p.socket.end(); }
    }
  }
  function onClose(c) {
    const room = c.room; if (!room) return;
    c.room = null;
    if (room.host === c) {
      for (const p of room.peers.values()) { send(p, { op: 'closed' }); p.room = null; }
      rooms.delete(room.code); log(`room ${room.code} closed`);
    } else if (room.peers.get(c.id) === c) {
      room.peers.delete(c.id); send(room.host, { op: 'left', id: c.id });
    }
  }
  const beat = setInterval(() => { for (const r of rooms.values()) for (const c of [r.host, ...r.peers.values()]) sendFrame(c, 9, Buffer.alloc(0)); }, 25000);
  if (beat.unref) beat.unref();

  return {
    rooms,
    // hand an HTTP upgrade to the signaling endpoint (only /ws)
    upgrade(req, socket) { let p = ''; try { p = new URL(req.url, 'http://x').pathname; } catch (e) { /* */ } if (p !== '/ws') return socket.destroy(); accept(req, socket); },
    close() { clearInterval(beat); for (const r of rooms.values()) for (const c of [r.host, ...r.peers.values()]) c.socket.destroy(); rooms.clear(); },
  };
}

// Join codes: a host's private IPv4 address and port, 48 bits in ten Crockford
// base-32 characters (no I, L, O or U), shown as two groups of five. The same
// scheme lives in js/net/lan.js; the tests hold the two to each other.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function encodeJoin(ip, port) {
  const o = String(ip).split('.').map(Number);
  if (o.length !== 4 || o.some(x => !(x >= 0 && x <= 255)) || !(port > 0 && port < 65536)) return null;
  let n = BigInt(o[0]) << 40n | BigInt(o[1]) << 32n | BigInt(o[2]) << 24n | BigInt(o[3]) << 16n | BigInt(port);
  let s = ''; for (let i = 0; i < 10; i++) { s = B32[Number(n & 31n)] + s; n >>= 5n; }
  return s.slice(0, 5) + '-' + s.slice(5);
}
function decodeJoin(code) {
  const s = String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
  let n = 0n; for (const ch of s) n = n << 5n | BigInt(B32.indexOf(ch));
  const port = Number(n & 0xffffn), ip = [40n, 32n, 24n, 16n].map(k => Number((n >> k) & 255n)).join('.');
  return port ? { ip, port } : null;
}

module.exports = { createSignal, encodeJoin, decodeJoin };
