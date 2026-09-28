// Unauthenticated endpoints: health, client configuration, announcements.
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { enabledProviders } from '../auth/oauth.js';
import { entitlements, freeMinutes } from '../auth/service.js';
import { plans } from '../billing/stripe.js';

export async function activeAnnouncements(ctx: Ctx, subscriber: boolean | null) {
  const rows = await ctx.db.query<any>(`select id, title, body, severity, audience, starts_at, ends_at from announcements where starts_at <= now() and (ends_at is null or ends_at > now()) order by starts_at desc limit 10`);
  return rows.filter(r => r.audience === 'all' || subscriber === null || (r.audience === 'subscribers') === subscriber)
    .map(r => ({ id: r.id, title: r.title, body: r.body, severity: r.severity, audience: r.audience, startsAt: r.starts_at, endsAt: r.ends_at }));
}

export default async function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/healthz', async () => { await ctx.db.one('select 1'); return { ok: true }; });
  // For the external uptime monitor: the relay every online match depends on (D19).
  // Kept apart from /healthz so a TURN outage never rolls back a deploy of this service.
  app.get('/healthz/turn', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const r = await ctx.monitor.turn.check();
    if (!r) return reply.code(503).send({ ok: false, detail: 'TURN is not configured (TURN_URLS with a udp turn: URL, and TURN_SECRET)' });
    return reply.code(r.ok ? 200 : 503).send({ ok: r.ok, ms: r.ms, detail: r.detail });
  });

  app.get('/api/config', async () => {
    const rows = await ctx.db.query<any>(`select key, value from remote_config`);
    const rc: Record<string, any> = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      minClientVersion: rc.minClientVersion || ctx.cfg.MIN_CLIENT_VERSION,
      maintenance: rc.maintenance || { on: false },
      freeMatchMinutes: await freeMinutes(ctx),
      priceUsd: 1,
      providers: enabledProviders(ctx),
      billing: !!ctx.stripe,
      // what membership costs, from Stripe (amounts in minor units, tax included)
      plans: Object.entries(await plans(ctx)).map(([plan, p]) => ({ plan, amount: p!.amount, currency: p!.currency })),
      turnstileSiteKey: rc.turnstileSiteKey || null,
      ticketKey: { kid: ctx.signer.id, x: ctx.signer.publicRaw },
      ticketKeys: ctx.signer.publicKeys(),
      features: rc.features || {},
    };
  });

  // Development and tests only: mail that would have been sent (there is no SMTP locally).
  if (!ctx.cfg.prod && !ctx.cfg.SMTP_URL) app.get('/api/dev/outbox', async () => ({ mail: ctx.mail.outbox.slice(-20) }));

  app.get('/api/announcements', async req => {
    const sub = req.auth ? (await entitlements(ctx, req.auth.user)).subscriber : null;
    return { announcements: await activeAnnouncements(ctx, sub) };
  });
}
