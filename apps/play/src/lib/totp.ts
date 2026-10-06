// SPDX-License-Identifier: AGPL-3.0-only
// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), compatible with every authenticator app.
import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out: number[] = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}
export const stepAt = (ms = Date.now()) => Math.floor(ms / 30000);

// Accepts ±1 step of drift; returns the matched step so a code can't be replayed.
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepAt(now);
  for (const d of [0, -1, 1]) {
    const step = s + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (hotp(secret, step) === c) return step;
  }
  return null;
}
export function otpauthUri(secret: string, account: string, issuer = 'Ozymandosis') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
