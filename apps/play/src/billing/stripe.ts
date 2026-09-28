// Subscriptions through Stripe: $1 per player per month unlocks multiplayer
// matches longer than the free limit. Checkout and the Customer Portal are
// hosted by Stripe (no card data touches this server); webhooks keep our
// subscription table and the player's live entitlements in sync.
import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import type { Ctx } from '../context.js';
import { bad, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { bump } from '../auth/service.js';

export const PRICE_LOOKUP_KEY = 'ozymandosis_monthly';
let cachedPrice: string | null = null;
export async function priceId(ctx: Ctx): Promise<string> {
  if (ctx.cfg.STRIPE_PRICE_ID) return ctx.cfg.STRIPE_PRICE_ID;
  if (cachedPrice) return cachedPrice;
  const r = await ctx.stripe!.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
  if (!r.data[0]) throw new HttpError(503, 'Subscriptions are not set up yet.', 'billing_unconfigured');
  return (cachedPrice = r.data[0].id);
}

// Create the product and $1/month price once (npm run admin -- stripe:setup).
export async function setupStripeProduct(stripe: Stripe) {
  const existing = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], limit: 1 });
  if (existing.data[0]) return existing.data[0];
  const product = await stripe.products.create({ name: 'Ozymandosis Membership', description: 'Unlimited-length online matches. Supports development and servers.' });
  return stripe.prices.create({ product: product.id, unit_amount: 100, currency: 'usd', recurring: { interval: 'month' }, lookup_key: PRICE_LOOKUP_KEY, tax_behavior: 'exclusive' });
}

async function customerFor(ctx: Ctx, user: { id: string; email: string | null; stripe_customer_id: string | null }): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  // Stripe needs an email for receipts; the display name is not sent.
  const c = await ctx.stripe!.customers.create({ email: user.email || undefined, metadata: { user_id: user.id } });
  await ctx.db.query('update users set stripe_customer_id = $2 where id = $1', [user.id, c.id]);
  return c.id;
}

const periodEnd = (s: Stripe.Subscription): number | null => (s as any).current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;

export async function upsertSubscription(ctx: Ctx, s: Stripe.Subscription) {
  const customer = typeof s.customer === 'string' ? s.customer : s.customer.id;
  let userId = s.metadata?.user_id || null;
  if (!userId) userId = (await ctx.db.one<any>('select id from users where stripe_customer_id = $1', [customer]))?.id || null;
  if (!userId) { ctx.log.warn({ sub: s.id }, 'subscription for unknown customer'); return null; }
  const end = periodEnd(s);
  await ctx.db.query(
    `insert into subscriptions (id, user_id, status, price_id, current_period_end, cancel_at_period_end, updated_at) values ($1, $2, $3, $4, to_timestamp($5), $6, now())
     on conflict (id) do update set status = excluded.status, price_id = excluded.price_id, current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now()`,
    [s.id, userId, s.status, s.items?.data?.[0]?.price?.id || null, end, !!s.cancel_at_period_end]);
  ctx.hub.refreshUser(userId);
  return userId;
}

export default async function billingRoutes(app: FastifyInstance, ctx: Ctx) {
  const need = () => { if (!ctx.stripe) throw new HttpError(503, 'Subscriptions are not available on this server.', 'billing_unconfigured'); return ctx.stripe; };

  app.post('/api/billing/checkout', async req => {
    const a = requireUser(req), stripe = need();
    if (a.user.status !== 'active') throw bad('This account cannot subscribe right now.');
    const active = await ctx.db.one(`select 1 from subscriptions where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`, [a.user.id]);
    if (active) throw bad('You already have a membership. Manage it from your account.', 'already');
    const customer = await customerFor(ctx, a.user);
    const s = await stripe.checkout.sessions.create({
      mode: 'subscription', customer, client_reference_id: a.user.id,
      line_items: [{ price: await priceId(ctx), quantity: 1 }],
      subscription_data: { metadata: { user_id: a.user.id } },
      allow_promotion_codes: true,
      success_url: `${ctx.cfg.PUBLIC_URL}/account?billing=success`,
      cancel_url: `${ctx.cfg.PUBLIC_URL}/account?billing=cancelled`,
    });
    return { url: s.url };
  });

  app.post('/api/billing/portal', async req => {
    const a = requireUser(req), stripe = need();
    if (!a.user.stripe_customer_id) throw bad('No billing history yet.');
    const s = await stripe.billingPortal.sessions.create({ customer: a.user.stripe_customer_id, return_url: `${ctx.cfg.PUBLIC_URL}/account` });
    return { url: s.url };
  });

  app.post('/api/billing/webhook', { config: { rateLimit: false } }, async (req, reply) => {
    const stripe = need();
    if (!ctx.cfg.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook secret not configured.');
    let ev: Stripe.Event;
    try { ev = stripe.webhooks.constructEvent(req.rawBody || Buffer.alloc(0), String(req.headers['stripe-signature'] || ''), ctx.cfg.STRIPE_WEBHOOK_SECRET); }
    catch { return reply.code(400).send({ error: 'Bad signature' }); }
    const first = await ctx.db.one(`insert into stripe_events (id, type) values ($1, $2) on conflict do nothing returning 1`, [ev.id, ev.type]);
    if (!first) return { ok: true, duplicate: true };
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object as Stripe.Checkout.Session;
        if (s.mode === 'subscription' && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
          const uid = await upsertSubscription(ctx, sub);
          if (uid) { await bump(ctx, 'subscriptions_started'); await audit(ctx, uid, 'billing.subscribed', uid); }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const uid = await upsertSubscription(ctx, ev.data.object as Stripe.Subscription);
        if (uid && ev.type === 'customer.subscription.deleted') await bump(ctx, 'subscriptions_ended');
        break;
      }
      case 'invoice.payment_failed': {
        const inv = ev.data.object as any;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.parent?.subscription_details?.subscription;
        if (subId) await upsertSubscription(ctx, await stripe.subscriptions.retrieve(subId));
        break;
      }
      default: break;
    }
    return { ok: true };
  });
}
