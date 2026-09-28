import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { boot, signup, type T } from './helpers.js';
import { resetPriceCache } from '../src/billing/stripe.js';

// A Stripe double: real webhook helpers, scripted prices and checkout.
const real = new Stripe('sk_test_dummy');
const sessions: any[] = [];
let taxBroken = false;
const fake: any = {
  webhooks: real.webhooks,
  prices: {
    list: async ({ lookup_keys }: any) => ({ data: lookup_keys.includes('ozymandosis_yearly') && lookup_keys.length === 1 ? [{ id: 'price_y', unit_amount: 1000, currency: 'usd', tax_behavior: 'inclusive', lookup_key: 'ozymandosis_yearly' }] : lookup_keys.includes('ozymandosis_monthly') ? [{ id: 'price_m', unit_amount: 100, currency: 'usd', tax_behavior: 'inclusive', lookup_key: 'ozymandosis_monthly' }] : [] }),
    retrieve: async (id: string) => ({ id, unit_amount: 100, currency: 'usd', tax_behavior: 'inclusive' }),
  },
  customers: { create: async () => ({ id: 'cus_' + Math.random().toString(36).slice(2) }) },
  checkout: { sessions: { create: async (p: any) => { if (taxBroken && p.automatic_tax) throw new Error('Stripe Tax has not been activated on your account.'); sessions.push(p); return { url: 'https://checkout.stripe.test/s' }; } } },
};

let t: T;
test('boot', async () => { resetPriceCache(); t = await boot({ WEB_BILLING: 'true' }, { stripe: fake }); });

test('web checkout is off unless an operator turns it on: memberships are sold per platform, in its store', async () => {
  const off = await boot({}, { stripe: fake });
  const u = await signup(off);
  const r = await off.api('POST', '/api/billing/checkout', { plan: 'year' }, u.token);
  assert.equal(r.status, 410); assert.equal(r.json.code, 'store_only');
  assert.equal((await off.api('GET', '/api/config')).json.billing, false);
  await off.app.close();
});
after(async () => { await t.app.close(); });

test('prices come from Stripe and are shown tax-inclusive', async () => {
  const c = await t.api('GET', '/api/config');
  assert.deepEqual(c.json.plans.sort((a: any, b: any) => a.amount - b.amount), [{ plan: 'month', amount: 100, currency: 'usd' }, { plan: 'year', amount: 1000, currency: 'usd' }]);
});

test('checkout collects tax where the buyer lives, for the chosen plan', async () => {
  const u = await signup(t);
  const r = await t.api('POST', '/api/billing/checkout', { plan: 'year' }, u.token);
  assert.equal(r.status, 200); assert.ok(r.json.url);
  const s = sessions.pop();
  assert.equal(s.line_items[0].price, 'price_y');
  assert.deepEqual(s.automatic_tax, { enabled: true }); assert.equal(s.customer_update.address, 'auto');
});

test('if Stripe Tax is not active yet, checkout still works and the problem is recorded', async () => {
  taxBroken = true;
  const u = await signup(t);
  const r = await t.api('POST', '/api/billing/checkout', {}, u.token);
  assert.equal(r.status, 200);
  assert.equal(sessions.pop().automatic_tax, undefined);
  assert.ok(await t.ctx.db.one(`select 1 from audit_log where action = 'billing.tax_unavailable'`));
  taxBroken = false;
});
