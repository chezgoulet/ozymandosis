// Builds the Fastify application: plugins, auth resolution, error shape,
// privacy-respecting request logs, CORS for game clients, and every route module.
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fstatic from '@fastify/static';
import Stripe from 'stripe';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Config } from './config.js';
import { openDb, migrate, type Db } from './db/index.js';
import { Secrets, TicketSigner } from './lib/crypto.js';
import { makeMailer, type Mailer } from './lib/mail.js';
import { REDACT_PATHS, userTag } from './lib/privacy.js';
import { HttpError, unauthorized, forbidden, ROLE_RANK, type Ctx, type Role } from './context.js';
import { sessionUser } from './auth/service.js';
import { Hub } from './realtime/hub.js';
import authRoutes from './auth/routes.js';
import oauthRoutes from './auth/oauth.js';
import meRoutes from './auth/me.js';
import billingRoutes from './billing/stripe.js';
import reportRoutes from './reports/routes.js';
import moderationRoutes from './moderation/routes.js';
import adminRoutes from './admin/routes.js';
import publicRoutes from './routes/public.js';

export const SESSION_COOKIE = 'ozy_session';

export async function loadSigner(db: Db, secrets: Secrets): Promise<TicketSigner> {
  const row = await db.one<any>(`select id, private_enc from server_keys order by created_at desc limit 1`);
  if (row) return TicketSigner.load(row.id, secrets.decrypt(row.private_enc));
  const id = 'k' + Date.now().toString(36);
  const { signer, privatePem } = TicketSigner.generate(id);
  await db.query(`insert into server_keys (id, public_key, private_enc) values ($1, $2, $3)`, [id, signer.publicPem, secrets.encrypt(privatePem)]);
  return signer;
}

export interface BuildOpts { db?: Db; mailer?: Mailer; stripe?: Stripe | null; now?: () => number }

export async function buildApp(cfg: Config, opts: BuildOpts = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: cfg.LOG_LEVEL === 'silent' ? false : { level: cfg.LOG_LEVEL, base: undefined, redact: { paths: REDACT_PATHS, censor: '[redacted]' }, serializers: { req: () => undefined as any, res: () => undefined as any } },
  });
  const secrets = Secrets.fromEnv(cfg.SECRET_KEY, !cfg.prod);
  const db = opts.db || (await openDb({ url: cfg.DATABASE_URL, dir: cfg.PGLITE_DIR }));
  await migrate(db, s => app.log.info(s));
  const signer = await loadSigner(db, secrets);
  const mail = opts.mailer || makeMailer(cfg.SMTP_URL, cfg.MAIL_FROM, s => app.log.info(s));
  const stripe = opts.stripe !== undefined ? opts.stripe : cfg.STRIPE_SECRET_KEY ? new Stripe(cfg.STRIPE_SECRET_KEY) : null;
  const ctx: Ctx = { cfg, db, secrets, mail, signer, stripe, log: app.log, hub: null as any, now: opts.now || Date.now };
  ctx.hub = new Hub(ctx);

  // JSON bodies keep their raw bytes for webhook signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    if (!(body as Buffer).length) return done(null, {});
    try { done(null, JSON.parse((body as Buffer).toString('utf8'))); } catch { const e: any = new Error('Malformed JSON'); e.statusCode = 400; done(e); }
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', keyGenerator: req => secrets.pseudonym(req.ip || 'x', 16), errorResponseBuilder: () => ({ statusCode: 429, error: 'Too many requests. Slow down a little.', code: 'rate_limited' }) });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // CORS: game clients run from file://, capacitor:// and other origins and use
  // bearer tokens, so the API answers any origin but never with credentials.
  // Cookie sessions are only honoured same-origin (and need a custom header).
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    reply.header('access-control-allow-origin', origin && origin !== 'null' ? origin : '*');
    reply.header('vary', 'origin');
    reply.header('access-control-allow-headers', 'authorization, content-type, x-ozy');
    reply.header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    reply.header('access-control-max-age', '600');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
    if (!req.url.startsWith('/api/')) reply.header('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com");
    if (cfg.prod) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return payload;
  });

  // Resolve who is calling: bearer token (game clients) or session cookie (portal).
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async req => {
    const h = req.headers.authorization;
    let a = null as Awaited<ReturnType<typeof sessionUser>>;
    if (h && h.startsWith('Bearer ')) a = await sessionUser(ctx, h.slice(7).trim());
    else if (req.cookies[SESSION_COOKIE]) {
      a = await sessionUser(ctx, req.cookies[SESSION_COOKIE]);
      if (a) a.via = 'cookie';
      // cookie auth on a state change must come from our own pages (custom header forces a preflight cross-site)
      if (a && req.method !== 'GET' && req.url.startsWith('/api/') && !req.headers['x-ozy'] && !req.url.startsWith('/api/billing/webhook')) a = null;
    }
    req.auth = a;
    req.tag = userTag(secrets, a?.user.id);
  });

  // One line per request: route, status, time, pseudonymous user. No IPs, no query strings.
  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/healthz') return;
    const route = req.routeOptions?.url || req.url.split('?')[0];
    req.log.info({ m: req.method, r: route, s: reply.statusCode, ms: Math.round(reply.elapsedTime), u: req.tag }, 'req');
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || 'bad_request' });
    if (err.name === 'ZodError') return reply.code(400).send({ error: err.issues?.[0]?.message || 'Invalid request.', code: 'invalid' });
    req.log.error({ err: { message: err.message, stack: err.stack }, r: req.routeOptions?.url, u: req.tag }, 'unhandled');
    return reply.code(500).send({ error: 'Something went wrong on our side. It has been logged.', code: 'server_error' });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.', code: 'not_found' });
    return reply.code(404).type('text/html').send('<!doctype html><title>Not found</title><p style="font-family:system-ui;padding:2rem">Nothing lives here. <a href="/">Go to your account</a>.</p>');
  });

  await publicRoutes(app, ctx);
  await authRoutes(app, ctx);
  await oauthRoutes(app, ctx);
  await meRoutes(app, ctx);
  await billingRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await moderationRoutes(app, ctx);
  await adminRoutes(app, ctx);
  ctx.hub.routes(app);

  // Account portal and admin console (static, same origin as the API).
  const here = dirname(fileURLToPath(import.meta.url));
  const pub = [join(here, '../public'), join(here, '../../public')].find(existsSync);
  if (pub) {
    await app.register(fstatic, { root: pub, prefix: '/', index: ['index.html'], cacheControl: false, setHeaders: (res: any) => res.setHeader('cache-control', 'no-cache') });
    for (const p of ['/login', '/verify', '/reset', '/account']) app.get(p, (req, reply) => reply.sendFile('index.html'));
    app.get('/admin', (req, reply) => reply.sendFile('admin/index.html'));
  }
  app.addHook('onClose', async () => { ctx.hub.close(); await db.close(); });
  return { app, ctx };
}

// ── guards ───────────────────────────────────────────────────────
export function requireUser(req: FastifyRequest) {
  if (!req.auth) throw unauthorized();
  const u = req.auth.user;
  if (u.status === 'banned' || u.status === 'deleted') throw unauthorized('This account cannot sign in.');
  return req.auth;
}
export function requireRole(req: FastifyRequest, role: Role) {
  const a = requireUser(req);
  if (ROLE_RANK[a.user.role] < ROLE_RANK[role]) throw forbidden();
  // in production, staff tools need two-factor sign-in on this very session
  if (process.env.NODE_ENV === 'production' && (!a.user.totp_enabled || !a.mfa)) throw forbidden('Staff tools need two-factor sign-in. Turn it on in your account, then sign in again.');
  return a;
}
export async function audit(ctx: Ctx, actorId: string | null, action: string, target: string | null, detail: object = {}) {
  await ctx.db.query(`insert into audit_log (actor_id, action, target, detail) values ($1, $2, $3, $4)`, [actorId, action, target, JSON.stringify(detail)]);
}
