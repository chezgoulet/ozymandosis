import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createHash, createHmac } from 'node:crypto';
import { probeTurn, udpTarget, parse } from '../src/ops/turn.js';
import { boot, type T } from './helpers.js';

// A TURN server double that behaves like coturn with --use-auth-secret: it
// challenges, then checks MESSAGE-INTEGRITY against the REST credential.
function fakeTurn(secret: string, opts: { silent?: boolean; open?: boolean } = {}) {
  const sock = dgram.createSocket('udp4'), seen: string[] = [];
  const reply = (req: Buffer, type: number, attrs: [number, Buffer][], to: dgram.RemoteInfo) => {
    const body = Buffer.concat(attrs.map(([t, v]) => { const pad = (4 - (v.length % 4)) % 4, b = Buffer.alloc(4 + v.length + pad); b.writeUInt16BE(t, 0); b.writeUInt16BE(v.length, 2); v.copy(b, 4); return b; }));
    const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(body.length, 2); req.copy(h, 4, 4, 20);
    sock.send(Buffer.concat([h, body]), to.port, to.address);
  };
  sock.on('message', (buf, rinfo) => {
    if (opts.silent) return;
    const m = parse(buf)!; const type = buf.readUInt16BE(0);
    const user = m.attrs.get(0x0006)?.toString(), mi = m.attrs.get(0x0008);
    if (opts.open && type === 0x0003) { seen.push('open'); return reply(buf, 0x0103, [], rinfo); }
    if (!mi) { seen.push('challenge'); return reply(buf, type | 0x0110, [[0x0009, Buffer.from([0, 0, 4, 1])], [0x0014, Buffer.from('test')], [0x0015, Buffer.from('nonce-1')]], rinfo); }
    // recompute the integrity over the message up to the MESSAGE-INTEGRITY attribute
    const at = buf.indexOf(Buffer.from([0x00, 0x08, 0x00, 0x14]), 20);
    const pass = createHmac('sha1', secret).update(user!).digest('base64');
    const key = createHash('md5').update(`${user}:test:${pass}`).digest();
    const head = Buffer.from(buf.subarray(0, at)); head.writeUInt16BE(at - 20 + 24, 2);
    const ok = createHmac('sha1', key).update(head).digest().equals(mi);
    seen.push(ok ? (type === 0x0004 ? 'refresh' : 'allocate') : 'bad-integrity');
    if (!ok) return reply(buf, type | 0x0110, [[0x0009, Buffer.from([0, 0, 4, 1])], [0x0014, Buffer.from('test')], [0x0015, Buffer.from('nonce-1')]], rinfo);
    reply(buf, type | 0x0100, [], rinfo);
  });
  return new Promise<{ port: number; seen: string[]; close: () => void }>(res => sock.bind(0, '127.0.0.1', () => res({ port: (sock.address() as any).port, seen, close: () => sock.close() })));
}

test('TURN_URLS: the probe picks the first UDP relay', () => {
  assert.deepEqual(udpTarget('turns:t.example:5349?transport=tcp,turn:t.example:3478?transport=udp'), { host: 't.example', port: 3478 });
  assert.deepEqual(udpTarget('turn:t.example'), { host: 't.example', port: 3478 });
  assert.equal(udpTarget('turn:t.example:3478?transport=tcp'), null);
});

test('a healthy relay grants an authenticated allocation, which is released at once', async () => {
  const s = await fakeTurn('turnsecret');
  const r = await probeTurn({ host: '127.0.0.1', port: s.port }, 'turnsecret');
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(s.seen, ['challenge', 'allocate', 'refresh']);
  s.close();
});

test('a relay with a different secret fails the probe and says why', async () => {
  const s = await fakeTurn('another-secret');
  const r = await probeTurn({ host: '127.0.0.1', port: s.port }, 'turnsecret');
  assert.equal(r.ok, false); assert.match(r.detail, /TURN_SECRET/);
  s.close();
});

test('a relay that does not answer fails the probe', async () => {
  const s = await fakeTurn('turnsecret', { silent: true });
  const r = await probeTurn({ host: '127.0.0.1', port: s.port }, 'turnsecret', 300);
  assert.equal(r.ok, false); assert.match(r.detail, /no answer/);
  s.close();
});

test('a relay that allocates without credentials is reported, not trusted', async () => {
  const s = await fakeTurn('turnsecret', { open: true });
  const r = await probeTurn({ host: '127.0.0.1', port: s.port }, 'turnsecret');
  assert.equal(r.ok, false); assert.match(r.detail, /not enforcing/);
  s.close();
});

let t: T;
after(async () => { if (t) await t.app.close(); });
test('the monitor alerts when the relay is down, and /healthz/turn and /metrics say so', async () => {
  const s = await fakeTurn('turnsecret', { silent: true });
  t = await boot({ TURN_URLS: `turn:127.0.0.1:${s.port}?transport=udp`, METRICS_TOKEN: 'a-long-enough-metrics-token-123' });
  const alerts = await t.ctx.monitor.check();
  assert.ok(alerts.some(a => a.key === 'turn.down'), 'turn.down fires');
  const h = await t.api('GET', '/healthz/turn');
  assert.equal(h.status, 503); assert.equal(h.json.ok, false);
  const m = await t.api('GET', '/metrics', undefined, undefined, { authorization: 'Bearer a-long-enough-metrics-token-123' });
  assert.match(m.raw.body, /ozy_turn_up 0/);
  s.close();
});
