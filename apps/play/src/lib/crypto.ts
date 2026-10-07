// SPDX-License-Identifier: AGPL-3.0-only
// Tokens, hashing, encryption at rest, and signatures for match tickets.
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, timingSafeEqual, KeyObject } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('base64url');
export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// Encryption at rest and log pseudonyms, keyed by SECRET_KEY. Rotation: set the new
// SECRET_KEY and the old one in SECRET_KEY_PREVIOUS, deploy, run
// `npm run admin -- secrets:rewrap`, then drop SECRET_KEY_PREVIOUS. Ciphertexts name
// the key that sealed them (v2.<kid>…); v1 ones (before key ids) try every key.
interface KeySet { kid: string; enc: Buffer; mac: Buffer }
const derive = (secret: Buffer): KeySet => {
  const enc = createHmac('sha256', secret).update('ozy:enc:v1').digest();
  return { enc, mac: createHmac('sha256', secret).update('ozy:mac:v1').digest(), kid: createHash('sha256').update(enc).digest('base64url').slice(0, 8) };
};
export class Secrets {
  private keys: KeySet[];
  constructor(secret: Buffer, previous: Buffer[] = []) { this.keys = [derive(secret), ...previous.map(derive)]; }
  static fromEnv(b64: string | undefined, dev: boolean, previousB64?: string): Secrets {
    const prev = (previousB64 || '').split(',').map(s => s.trim()).filter(Boolean).map(s => Buffer.from(s, 'base64'));
    if (b64) return new Secrets(Buffer.from(b64, 'base64'), prev);
    if (!dev) throw new Error('SECRET_KEY is required');
    // development only: a fixed key so local data survives restarts
    return new Secrets(createHash('sha256').update('ozymandosis-dev-only-secret').digest(), prev);
  }
  get kid() { return this.keys[0].kid; }
  encrypt(plain: string): string {
    const k = this.keys[0], iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k.enc, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v2', k.kid, iv.toString('base64url'), body.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
  }
  decrypt(box: string): string {
    const parts = box.split('.');
    const open = (k: KeySet, iv: string, body: string, tag: string) => {
      const d = createDecipheriv('aes-256-gcm', k.enc, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
    };
    if (parts[0] === 'v2') {
      const k = this.keys.find(x => x.kid === parts[1]);
      if (!k) throw new Error('ciphertext sealed with an unknown key (is SECRET_KEY_PREVIOUS set?)');
      return open(k, parts[2], parts[3], parts[4]);
    }
    if (parts[0] !== 'v1') throw new Error('unknown ciphertext version');
    for (const k of this.keys) { try { return open(k, parts[1], parts[2], parts[3]); } catch { /* next key */ } }
    throw new Error('ciphertext does not open with any configured key');
  }
  // sealed with an older key (or before key ids): rewrap it
  stale(box: string): boolean { const p = box.split('.'); return p[0] !== 'v2' || p[1] !== this.keys[0].kid; }
  // Stable pseudonym for logs: a keyed hash that cannot be reversed to the input.
  pseudonym(s: string, len = 10): string { return createHmac('sha256', this.keys[0].mac).update(s).digest('base64url').slice(0, len); }
}

// Ed25519 key for match tickets. Peers verify tickets with the public key, so a
// client cannot grant itself a longer match or claim someone else's seat.
export class TicketSigner {
  constructor(public readonly id: string, private key: KeyObject, public readonly publicPem: string) {}
  static generate(id: string) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return { signer: new TicketSigner(id, privateKey, publicKey.export({ type: 'spki', format: 'pem' }).toString()), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  }
  static load(id: string, privatePem: string) {
    const key = createPrivateKey(privatePem);
    return new TicketSigner(id, key, createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString());
  }
  get publicRaw(): string { return createPublicKey(this.publicPem).export({ format: 'jwk' }).x as string; }
  sign(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = sign(null, Buffer.from(body), this.key).toString('base64url');
    return `${this.id}.${body}.${sig}`;
  }
  verify(ticket: string): any | null {
    const [id, body, sig] = ticket.split('.');
    if (id !== this.id || !body || !sig) return null;
    if (!verify(null, Buffer.from(body), createPublicKey(this.publicPem), Buffer.from(sig, 'base64url'))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  }
}

// Ticket keys in rotation: the newest signs; any key still in the ring verifies,
// so tickets issued before a rotation keep working until they expire (12 h).
// `npm run admin -- keys:rotate` adds a key; keys retired over a day ago drop out.
export class Keyring {
  constructor(private ring: TicketSigner[]) { if (!ring.length) throw new Error('empty keyring'); }
  get id() { return this.ring[0].id; }
  get publicRaw() { return this.ring[0].publicRaw; }
  get size() { return this.ring.length; }
  sign(payload: object) { return this.ring[0].sign(payload); }
  verify(ticket: string) { const kid = String(ticket || '').split('.')[0]; const k = this.ring.find(s => s.id === kid); return k ? k.verify(ticket) : null; }
  publicKeys() { return this.ring.map(s => ({ kid: s.id, x: s.publicRaw })); }
  replace(ring: TicketSigner[]) { if (ring.length) this.ring = ring; }
}
