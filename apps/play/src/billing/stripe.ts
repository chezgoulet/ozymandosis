// SPDX-License-Identifier: AGPL-3.0-only
// Subscriptions through Stripe (the web portal): $2 a month or $12 a year
// (docs/MONETIZATION.md) unlocks online play beyond the free allowance. Checkout and the Customer Portal are
// hosted by Stripe (no card data touches this server); webhooks keep our
// subscription table and the player's live entitlements in sync.
import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import type { Ctx } from '../context.js';
import { bad, HttpError } from '../context.js';
import { requireUser, audit } from '../app.js';
import { bump } from '../auth/service.js';

export const PRICE_LOOKUP_KEY = 'ozymandosis_monthly';
export const YEARLY_LOOKUP_KEY = 'ozymandosis_yearly';
export type Plan = 'month' | 'year';

// Prices come from Stripe (by id from the environment, or by lookup key), cached ten minutes.
let cache: { at: number; plans: Partial<Record<Plan, { id: string; amount: number; currency: string; taxBehavior: string | null }>> } | null = null;
export async function plans(ctx: Ctx) {
  if (!ctx.stripe) return {};
  if (cache && Date.now() - cache.at < 600e3) return cache.plans;
  const out: NonNullable<typeof cache>['plans'] = {};
  const load = async (plan: Plan, id: string | undefined, key: string) => {
    try {
      const p = id ? await ctx.stripe!.prices.retrieve(id) : (await ctx.stripe!.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
      if (p && p.unit_amount != null) out[plan] = { id: p.id, amount: p.unit_amount, currency: p.currency, taxBehavior: p.tax_behavior ?? null };
    } catch (e: any) { ctx.log.warn({ plan, e: e.message }, 'stripe price lookup failed'); }
  };
  await Promise.all([load('month', ctx.cfg.STRIPE_PRICE_ID, PRICE_LOOKUP_KEY), load('year', ctx.cfg.STRIPE_PRICE_ID_YEARLY, YEARLY_LOOKUP_KEY)]);
  cache = { at: Date.now(), plans: out };
  return out;
}
export async function priceId(ctx: Ctx, plan: Plan = 'month'): Promise<string> {
  const p = (await plans(ctx))[plan];
  if (!p) throw new HttpError(503, plan === 'year' ? 'Yearly membership is not offered right now.' : 'Subscriptions are not set up yet.', 'billing_unconfigured');
  return p.id;
}
export const resetPriceCache = () => { cache = null; };

// Create the product and prices once (npm run admin -- stripe:setup [yearly cents]).
// Prices include tax (EU and UK law require consumer prices shown tax-inclusive);
// Stripe Tax works out the tax inside them.
export async function setupStripeProduct(stripe: Stripe, yearlyCents?: number) {
  const list = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY, YEARLY_LOOKUP_KEY], limit: 2 });
  let monthly = list.data.find(p => p.lookup_key === PRICE_LOOKUP_KEY), yearly = list.data.find(p => p.lookup_key === YEARLY_LOOKUP_KEY);
  const product = monthly ? (typeof monthly.product === 'string' ? monthly.product : monthly.product.id)
    : (await stripe.products.create({ name: 'Ozymandosis Membership', description: 'Online play beyond the free daily match. Supports development and servers.', tax_code: 'txcd_10201000' })).id;
  if (!monthly) monthly = await stripe.prices.create({ product, unit_amount: 200, currency: 'usd', recurring: { interval: 'month' }, lookup_key: PRICE_LOOKUP_KEY, tax_behavior: 'inclusive' });
  if (!yearly && yearlyCents) yearly = await stripe.prices.create({ product, unit_amount: yearlyCents, currency: 'usd', recurring: { interval: 'year' }, lookup_key: YEARLY_LOOKUP_KEY, tax_behavior: 'inclusive' });
  return { monthly, yearly };
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
    // Memberships are sold in each platform's store (docs/MONETIZATION.md); web checkout is off unless an operator turns it on.
    if (!ctx.cfg.WEB_BILLING) throw new HttpError(410, 'Membership is bought in the game, through the store of the platform you play on.', 'store_only');
    const plan: Plan = (req.body as any)?.plan === 'year' ? 'year' : 'month';
    if (a.user.status !== 'active') throw bad('This account cannot subscribe right now.');
    const active = await ctx.db.one(`select 1 from subscriptions where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`, [a.user.id]);
    if (active) throw bad('You already have a membership. Manage it from your account.', 'already');
    const customer = await customerFor(ctx, a.user);
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription', customer, client_reference_id: a.user.id,
      line_items: [{ price: await priceId(ctx, plan), quantity: 1 }],
      subscription_data: { metadata: { user_id: a.user.id } },
      allow_promotion_codes: true,
      success_url: `${ctx.cfg.PUBLIC_URL}/account?billing=success`,
      cancel_url: `${ctx.cfg.PUBLIC_URL}/account?billing=cancelled`,
    };
    // tax where the buyer lives: Checkout asks for the country (and postcode where needed)
    if (ctx.cfg.STRIPE_TAX) Object.assign(params, { automatic_tax: { enabled: true }, customer_update: { address: 'auto' }, billing_address_collection: 'auto' });
    let s: Stripe.Checkout.Session;
    try { s = await stripe.checkout.sessions.create(params); }
    catch (e: any) {
      if (!ctx.cfg.STRIPE_TAX || !/tax/i.test(e.message || '')) throw e;
      // Stripe Tax not activated yet: keep selling, but make it loud
      ctx.log.error({ err: { message: e.message } }, 'stripe tax unavailable: checkout without automatic tax');
      await audit(ctx, null, 'billing.tax_unavailable', a.user.id, { message: String(e.message).slice(0, 300) });
      const { automatic_tax: _a, customer_update: _c, ...plain } = params as any;
      s = await stripe.checkout.sessions.create(plain);
    }
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
