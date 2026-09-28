// Tokens, hashing, encryption at rest, and signatures for match tickets.
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, timingSafeEqual, KeyObject } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('base64url');
export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export class Secrets {
  private enc: Buffer; private mac: Buffer;
  constructor(secret: Buffer) {
    // derive independent keys for encryption and pseudonymisation
    this.enc = createHmac('sha256', secret).update('ozy:enc:v1').digest();
    this.mac = createHmac('sha256', secret).update('ozy:mac:v1').digest();
  }
  static fromEnv(b64: string | undefined, dev: boolean): Secrets {
    if (b64) return new Secrets(Buffer.from(b64, 'base64'));
    if (!dev) throw new Error('SECRET_KEY is required');
    // development only: a fixed key so local data survives restarts
    return new Secrets(createHash('sha256').update('ozymandosis-dev-only-secret').digest());
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.enc, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), body.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
  }
  decrypt(box: string): string {
    const [v, iv, body, tag] = box.split('.');
    if (v !== 'v1') throw new Error('unknown ciphertext version');
    const d = createDecipheriv('aes-256-gcm', this.enc, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  }
  // Stable pseudonym for logs: a keyed hash that cannot be reversed to the input.
  pseudonym(s: string, len = 10): string { return createHmac('sha256', this.mac).update(s).digest('base64url').slice(0, len); }
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
