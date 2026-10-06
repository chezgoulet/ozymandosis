// SPDX-License-Identifier: AGPL-3.0-only
// TURN health check. Since D19 every online match is relayed, so a TURN server
// that is down or rejecting our credentials means no online play at all. This
// probe does what a player's browser does: a STUN Allocate over UDP, answered
// first with a 401 challenge, then authenticated with a REST credential minted
// from TURN_SECRET exactly as the hub mints them. A granted allocation proves
// the server is up, reachable and shares our secret; it is released at once.
import dgram from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const COOKIE = 0x2112a442;
const T = { ALLOCATE: 0x0003, REFRESH: 0x0004, ALLOCATE_OK: 0x0103, ALLOCATE_ERR: 0x0113, REFRESH_OK: 0x0104 };
const A = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, LIFETIME: 0x000d, REALM: 0x0014, NONCE: 0x0015, REQUESTED_TRANSPORT: 0x0019 };

export interface TurnTarget { host: string; port: number }
export interface TurnResult { ok: boolean; ms: number; detail: string }

// The first UDP turn: URL in TURN_URLS (turn:host:port or turn:host:port?transport=udp).
export function udpTarget(urls: string): TurnTarget | null {
  for (const raw of urls.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^turn:([^:?]+|\[[^\]]+\])(?::(\d+))?(?:\?transport=(\w+))?$/i.exec(raw);
    if (m && (!m[3] || m[3].toLowerCase() === 'udp')) return { host: m[1].replace(/^\[|\]$/g, ''), port: m[2] ? +m[2] : 3478 };
  }
  return null;
}

// The credential the hub hands players (coturn --use-auth-secret).
export function restCredential(secret: string, who: string, ttlS = 300) {
  const username = `${Math.floor(Date.now() / 1000) + ttlS}:${who}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

function attr(type: number, value: Buffer) {
  const pad = (4 - (value.length % 4)) % 4, b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0); b.writeUInt16BE(value.length, 2); value.copy(b, 4);
  return b;
}
function message(type: number, tx: Buffer, attrs: Buffer[], key?: Buffer) {
  let body = Buffer.concat(attrs);
  const head = (len: number) => { const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(len, 2); h.writeUInt32BE(COOKIE, 4); tx.copy(h, 8); return h; };
  if (!key) return Buffer.concat([head(body.length), body]);
  // MESSAGE-INTEGRITY covers the header (with the length already counting it) and every attribute before it
  const mac = createHmac('sha1', key).update(Buffer.concat([head(body.length + 24), body])).digest();
  body = Buffer.concat([body, attr(A.MESSAGE_INTEGRITY, mac)]);
  return Buffer.concat([head(body.length), body]);
}
export function parse(buf: Buffer) {
  if (buf.length < 20 || buf.readUInt32BE(4) !== COOKIE) return null;
  const type = buf.readUInt16BE(0), len = buf.readUInt16BE(2), tx = buf.subarray(8, 20), attrs = new Map<number, Buffer>();
  for (let o = 20; o + 4 <= 20 + len && o + 4 <= buf.length;) {
    const t = buf.readUInt16BE(o), l = buf.readUInt16BE(o + 2);
    attrs.set(t, buf.subarray(o + 4, o + 4 + l)); o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, tx, attrs };
}
const errorCode = (v?: Buffer) => (v && v.length >= 4 ? v[2] * 100 + v[3] : 0);

export async function probeTurn(target: TurnTarget, secret: string, timeoutMs = 3000): Promise<TurnResult> {
  const t0 = Date.now(), sock = dgram.createSocket(target.host.includes(':') ? 'udp6' : 'udp4');
  const ask = (msg: Buffer) => new Promise<ReturnType<typeof parse>>((res, rej) => {
    const to = setTimeout(() => { sock.off('message', on); rej(new Error(`no answer from ${target.host}:${target.port} within ${timeoutMs} ms`)); }, timeoutMs);
    const on = (b: Buffer) => { const m = parse(b); if (m && m.tx.equals(msg.subarray(8, 20))) { clearTimeout(to); sock.off('message', on); res(m); } };
    sock.on('message', on);
    sock.send(msg, target.port, target.host, e => { if (e) { clearTimeout(to); sock.off('message', on); rej(e); } });
  });
  const done = (ok: boolean, detail: string): TurnResult => ({ ok, ms: Date.now() - t0, detail });
  try {
    sock.on('error', () => { /* surfaced through the pending ask */ });
    const transport = attr(A.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]));
    const first = await ask(message(T.ALLOCATE, randomBytes(12), [transport]));
    if (!first) return done(false, 'not a STUN answer');
    if (first.type === T.ALLOCATE_OK) return done(false, 'allocated without credentials: the server is not enforcing authentication');
    const realm = first.attrs.get(A.REALM), nonce = first.attrs.get(A.NONCE);
    if (first.type !== T.ALLOCATE_ERR || errorCode(first.attrs.get(A.ERROR_CODE)) !== 401 || !realm || !nonce) return done(false, `unexpected first answer (type 0x${first.type.toString(16)}, error ${errorCode(first.attrs.get(A.ERROR_CODE))})`);
    const { username, credential } = restCredential(secret, 'healthcheck');
    const key = createHash('md5').update(`${username}:${realm.toString()}:${credential}`).digest();
    const auth = [attr(A.USERNAME, Buffer.from(username)), attr(A.REALM, realm), attr(A.NONCE, nonce)];
    const second = await ask(message(T.ALLOCATE, randomBytes(12), [transport, ...auth], key));
    if (!second) return done(false, 'not a STUN answer');
    if (second.type !== T.ALLOCATE_OK) {
      const code = errorCode(second.attrs.get(A.ERROR_CODE));
      return done(false, code === 401 ? 'the relay rejected our credentials: TURN_SECRET differs from coturn\'s static-auth-secret' : `allocation refused (error ${code})`);
    }
    // release the allocation straight away
    await ask(message(T.REFRESH, randomBytes(12), [attr(A.LIFETIME, Buffer.from([0, 0, 0, 0])), ...auth], key)).catch(() => null);
    return done(true, 'allocation granted');
  } catch (e: any) {
    return done(false, e.message);
  } finally { sock.close(); }
}

// One probe at a time, reused for a short while (the monitor, /healthz/turn and metrics share it).
export class TurnHealth {
  private last: (TurnResult & { at: number }) | null = null;
  private pending: Promise<TurnResult> | null = null;
  constructor(private urls: string, private secret: string | undefined) {}
  get configured() { return !!(this.secret && udpTarget(this.urls)); }
  async check(maxAgeMs = 30e3): Promise<TurnResult | null> {
    const target = udpTarget(this.urls);
    if (!this.secret || !target) return null;
    if (this.last && Date.now() - this.last.at < maxAgeMs) return this.last;
    if (!this.pending) this.pending = probeTurn(target, this.secret).then(r => { this.last = { ...r, at: Date.now() }; return r; }).finally(() => { this.pending = null; });
    return this.pending;
  }
  peek() { return this.last; }
}
