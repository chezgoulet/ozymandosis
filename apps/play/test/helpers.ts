import { WebSocket } from 'ws';
import Stripe from 'stripe';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { makeMailer } from '../src/lib/mail.js';
import { hotp, stepAt } from '../src/lib/totp.js';

export const WEBHOOK_SECRET = 'whsec_test_secret';
export async function boot(env: Record<string, string> = {}) {
  const cfg = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', PUBLIC_URL: 'http://play.test', SITE_URL: 'http://site.test', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TURN_SECRET: 'turnsecret', TURN_URLS: 'turn:turn.test:3478', ...env } as any);
  const mailer = makeMailer(undefined, 'test', () => {});
  const stripe = new Stripe('sk_test_dummy');
  const built = await buildApp(cfg, { mailer, stripe });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (built.app.server.address() as any).port;
  const api = async (method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await built.app.inject({ method: method as any, url, payload: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
    let json: any = null; try { json = r.json(); } catch { /* */ }
    return { status: r.statusCode, json, headers: r.headers, raw: r };
  };
  return { ...built, port, api, mailer, cfg, stripe };
}
export type T = Awaited<ReturnType<typeof boot>>;

let n = 0;
export async function signup(t: T, over: Partial<{ email: string; password: string; name: string; verify: boolean }> = {}) {
  const email = over.email || `player${++n}_${Date.now()}@example.com`, password = over.password || 'correct horse battery';
  const r = await t.api('POST', '/api/auth/signup', { email, password, name: over.name, client: 'game' });
  if (r.status !== 200) throw new Error('signup failed ' + JSON.stringify(r.json));
  if (over.verify !== false) {
    const mail = t.mailer.outbox.filter(m => m.to === email).pop()!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const v = await t.api('POST', '/api/auth/verify', { token });
    if (v.status !== 200) throw new Error('verify failed');
  }
  const me = await t.api('GET', '/api/me', undefined, r.json.token);
  return { email, password, token: r.json.token as string, id: me.json.user.id as string, name: me.json.user.name as string };
}
export const code = (secret: string, offset = 0) => hotp(secret, stepAt() + offset);

export class Client {
  ws!: WebSocket; hello: any; msgs: any[] = []; waiters: { op: string; res: (m: any) => void; pred?: (m: any) => boolean }[] = [];
  static async open(t: T, token: string, extra: Record<string, unknown> = {}) {
    const c = new Client();
    c.ws = new WebSocket(`ws://127.0.0.1:${t.port}/ws`);
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); });
    c.ws.on('message', d => { const m = JSON.parse(d.toString()); c.msgs.push(m); c.waiters = c.waiters.filter(w => { if (w.op === m.op && (!w.pred || w.pred(m))) { w.res(m); return false; } return true; }); });
    c.send({ op: 'auth', token, version: '9.9.9', platform: 'test', proto: 2, ...extra });
    c.hello = await c.wait('hello');
    return c;
  }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  wait(op: string, pred?: (m: any) => boolean, ms = 3000): Promise<any> {
    const got = this.msgs.find(m => m.op === op && (!pred || pred(m)));
    if (got) { this.msgs.splice(this.msgs.indexOf(got), 1); return Promise.resolve(got); }
    return new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout waiting for ' + op)), ms); this.waiters.push({ op, pred, res: m => { clearTimeout(to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } }); });
  }
  close() { this.ws.close(); }
}
