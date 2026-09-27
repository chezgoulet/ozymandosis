#!/usr/bin/env node
// Efflorescent relay server: serves the game files and relays multiplayer
// messages between a room's host and its guests. Zero dependencies.
//   node server/server.js            (PORT=8080 by default)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_FRAME = 4 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };

// ── static files ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/]\.(git|env)/.test(file) || file.includes('node_modules')) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

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
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function code() { let s; do { s = ''; for (let i = 0; i < 4; i++) s += LETTERS[crypto.randomInt(LETTERS.length)]; } while (rooms.has(s)); return s; }
function onMessage(c, raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (m.op === 'host') {
    if (c.room) return;
    const room = { code: code(), host: c, peers: new Map(), seq: 0 };
    rooms.set(room.code, room); c.room = room; c.id = 0; c.name = String(m.name || 'Host').slice(0, 18);
    send(c, { op: 'hosted', room: room.code, id: 0 });
    log(`room ${room.code} hosted by ${c.name}`);
  } else if (m.op === 'join') {
    const room = rooms.get(String(m.room || '').toUpperCase());
    if (!room) return send(c, { op: 'error', msg: 'No room with that code.' });
    if (room.peers.size >= 5) return send(c, { op: 'error', msg: 'Room is full.' });
    c.room = room; c.id = ++room.seq; c.name = String(m.name || 'Guest').slice(0, 18);
    room.peers.set(c.id, c);
    send(c, { op: 'joined', room: room.code, id: c.id });
    send(room.host, { op: 'peer', id: c.id, name: c.name });
    log(`${c.name} joined ${room.code}`);
  } else if (m.op === 'send' && c.room) {
    const room = c.room;
    if (c === room.host) {
      const out = JSON.stringify({ op: 'msg', from: 0, data: m.data });
      if (m.to === 'all') for (const p of room.peers.values()) send(p, out);
      else send(room.peers.get(m.to), out);
    } else send(room.host, { op: 'msg', from: c.id, data: m.data });
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
server.on('upgrade', (req, socket) => { if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy(); accept(req, socket); });
setInterval(() => { for (const r of rooms.values()) for (const c of [r.host, ...r.peers.values()]) sendFrame(c, 9, Buffer.alloc(0)); }, 25000);
function log(s) { if (!process.env.QUIET) console.log(new Date().toISOString().slice(11, 19), s); }

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Efflorescent server on http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  LAN: http://${ip}:${PORT}`);
});
module.exports = server;
