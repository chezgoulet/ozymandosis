// SPDX-License-Identifier: AGPL-3.0-only
// Promo codes: staff create them (singly or in batches) in the admin console;
// players redeem them in their account or in the game. Each code grants a month,
// a year or a lifetime of membership and works a fixed number of times, once per player.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import type { Ctx } from '../context.js';
import { bad, notFound, tooMany } from '../context.js';
import { requireUser, requireRole, audit } from '../app.js';
import { Limiter } from '../lib/limiter.js';
import { bump, entitlements } from '../auth/service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: codes are read aloud and typed on phones
const LIFETIME_END = '9999-12-31T00:00:00Z';
const INTERVAL = { month: '1 month', year: '1 year' } as const;
export const normCode = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function makeCode(prefix = 'OZY') {
  let s = ''; for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const redeemLimit = new Limiter(10, 60 * 60e3);

export async function redeem(ctx: Ctx, userId: string, raw: string) {
  const code = normCode(raw);
  if (code.length < 6) throw bad('That code does not look right.', 'code');
  return ctx.db.tx(async t => {
    const p = await t.one<any>(`select * from promo_codes where replace(code, '-', '') = $1 for update`, [code]);
    if (!p || p.disabled) throw bad('That code is not valid.', 'invalid');
    if (p.expires_at && new Date(p.expires_at).getTime() < ctx.now()) throw bad('That code has expired.', 'expired');
    if (p.uses >= p.max_uses) throw bad('That code has been used up.', 'used_up');
    if (await t.one('select 1 from promo_redemptions where code_id = $1 and user_id = $2', [p.id, userId])) throw bad('You have already used this code.', 'already');
    await t.query('update promo_codes set uses = uses + 1 where id = $1', [p.id]);
    await t.query('insert into promo_redemptions (code_id, user_id) values ($1, $2)', [p.id, userId]);
    // one promo membership row per player; codes stack onto it
    const id = 'promo_' + userId;
    if (p.kind === 'life') {
      await t.query(`insert into subscriptions (id, user_id, status, current_period_end) values ($1, $2, 'active', $3)
        on conflict (id) do update set status = 'active', current_period_end = $3, updated_at = now()`, [id, userId, LIFETIME_END]);
    } else {
      const iv = INTERVAL[p.kind as 'month' | 'year'];
      await t.query(`insert into subscriptions (id, user_id, status, current_period_end) values ($1, $2, 'active', now() + $3::interval)
        on conflict (id) do update set status = 'active', updated_at = now(),
          current_period_end = case when subscriptions.current_period_end >= $4::timestamptz then subscriptions.current_period_end
                                    else greatest(subscriptions.current_period_end, now()) + $3::interval end`, [id, userId, iv, LIFETIME_END]);
    }
    const row = await t.one<any>('select current_period_end from subscriptions where id = $1', [id]);
    return { kind: p.kind as string, until: new Date(row.current_period_end).toISOString(), lifetime: p.kind === 'life' };
  });
}

export default async function promoRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/billing/redeem', async req => {
    const a = requireUser(req);
    const b = z.object({ code: z.string().max(40) }).parse(req.body);
    if (!redeemLimit.take(a.user.id)) throw tooMany('Too many tries. Wait a little and try again.');
    const r = await redeem(ctx, a.user.id, b.code);
    await bump(ctx, 'promo_redemptions');
    await audit(ctx, a.user.id, 'promo.redeem', a.user.id, { kind: r.kind });
    ctx.hub.refreshUser(a.user.id);
    const hasStripe = await ctx.db.one(`select 1 from subscriptions where user_id = $1 and id like 'sub_%' and status in ('active', 'trialing') and not cancel_at_period_end`, [a.user.id]);
    return { ok: true, ...r, entitlements: await entitlements(ctx, (await ctx.db.one<any>('select * from users where id = $1', [a.user.id]))!), stripeActive: !!hasStripe };
  });

  // ── staff ──────────────────────────────────────────────────────
  app.post('/api/admin/promos', async req => {
    const a = requireRole(req, 'admin');
    const b = z.object({
      kind: z.enum(['month', 'year', 'life']), maxUses: z.number().int().min(1).max(100000), count: z.number().int().min(1).max(1000).default(1),
      prefix: z.string().regex(/^[A-Z0-9]{2,8}$/).default('OZY'), expiresAt: z.string().datetime().optional(), note: z.string().max(200).default(''), code: z.string().max(32).optional(),
    }).parse(req.body);
    const batch = b.count > 1 ? 'b' + Date.now().toString(36) : null;
    const made: string[] = [];
    await ctx.db.tx(async t => {
      for (let i = 0; i < b.count; i++) {
        // a single named code (e.g. for a stream) or random ones
        const code = b.count === 1 && b.code ? b.code.toUpperCase().replace(/[^A-Z0-9-]/g, '') : makeCode(b.prefix);
        if (normCode(code).length < 6) throw bad('Custom codes need at least 6 letters or digits.');
        if (await t.one(`select 1 from promo_codes where replace(code, '-', '') = $1`, [normCode(code)])) throw bad(`The code ${code} already exists.`);
        await t.query(`insert into promo_codes (code, kind, max_uses, expires_at, note, batch, created_by) values ($1, $2, $3, $4, $5, $6, $7)`, [code, b.kind, b.maxUses, b.expiresAt || null, b.note, batch, a.user.id]);
        made.push(code);
      }
    });
    await audit(ctx, a.user.id, 'promo.create', batch || made[0], { kind: b.kind, maxUses: b.maxUses, count: b.count, note: b.note });
    return { ok: true, codes: made, batch };
  });
  app.get('/api/admin/promos', async req => {
    requireRole(req, 'admin');
    const q = z.object({ q: z.string().max(40).default(''), batch: z.string().optional(), limit: z.coerce.number().max(2000).default(200) }).parse(req.query);
    const rows = await ctx.db.query<any>(`select p.id, p.code, p.kind, p.max_uses, p.uses, p.expires_at, p.disabled, p.note, p.batch, p.created_at, u.display_name as created_by
      from promo_codes p left join users u on u.id = p.created_by
      where ($1 = '' or replace(p.code, '-', '') like '%' || $1 || '%' or p.note ilike '%' || $1 || '%') and ($2::text is null or p.batch = $2)
      order by p.created_at desc limit $3`, [normCode(q.q) || (q.q ? q.q : ''), q.batch || null, q.limit]);
    const totals = await ctx.db.one<any>(`select count(*)::int as codes, coalesce(sum(uses), 0)::int as redemptions from promo_codes`);
    return { promos: rows, totals };
  });
  app.get('/api/admin/promos/:id', async req => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const p = await ctx.db.one<any>('select * from promo_codes where id = $1', [id]);
    if (!p) throw notFound();
    const redemptions = await ctx.db.query(`select r.redeemed_at, u.id as user_id, u.display_name from promo_redemptions r join users u on u.id = r.user_id where r.code_id = $1 order by r.redeemed_at desc limit 500`, [id]);
    return { promo: p, redemptions };
  });
  app.patch('/api/admin/promos/:id', async req => {
    const a = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const b = z.object({ disabled: z.boolean().optional(), maxUses: z.number().int().min(1).max(100000).optional(), note: z.string().max(200).optional() }).parse(req.body);
    const p = await ctx.db.one<any>('select uses from promo_codes where id = $1', [id]);
    if (!p) throw notFound();
    if (b.maxUses !== undefined && b.maxUses < p.uses) throw bad(`It has already been used ${p.uses} times.`);
    await ctx.db.query(`update promo_codes set disabled = coalesce($2, disabled), max_uses = coalesce($3, max_uses), note = coalesce($4, note) where id = $1`, [id, b.disabled ?? null, b.maxUses ?? null, b.note ?? null]);
    await audit(ctx, a.user.id, 'promo.update', id, b);
    return { ok: true };
  });
}
