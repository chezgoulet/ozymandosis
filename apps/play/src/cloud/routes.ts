// Cloud sync: a player's lineage, design library and save slots follow their
// account across devices (and survive browsers that evict local storage).
// Each item carries a version; a write names the version it was based on and
// is refused (409, with the current copy) if another device wrote first, so the
// client can merge and try again. Items are the player's own data: they are in
// the account export and deleted with the account.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { bad, HttpError, notFound } from '../context.js';
import { requireUser } from '../app.js';

export const CLOUD_KEY = /^(profile|designs|save\.(auto|s[1-8]))$/;
export const ITEM_MAX = 768 * 1024;        // one item (a large late-game save is ~150 KB)
export const USER_MAX = 4 * 1024 * 1024;   // everything one player keeps

export default async function cloudRoutes(app: FastifyInstance, ctx: Ctx) {
  const key = (k: string) => { if (!CLOUD_KEY.test(k)) throw notFound('Unknown item.'); return k; };
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.get('/api/cloud', limit, async req => {
    const a = requireUser(req);
    const items = await ctx.db.query<any>('select key, version, size, updated_at from cloud_items where user_id = $1 order by key', [a.user.id]);
    return { items, quota: { item: ITEM_MAX, total: USER_MAX, used: items.reduce((n, i) => n + i.size, 0) } };
  });
  app.get('/api/cloud/:key', limit, async req => {
    const a = requireUser(req), k = key((req.params as any).key);
    const row = await ctx.db.one<any>('select value, version, updated_at from cloud_items where user_id = $1 and key = $2', [a.user.id, k]);
    if (!row) throw notFound('Nothing saved yet.');
    return row;
  });
  app.put('/api/cloud/:key', { ...limit, bodyLimit: ITEM_MAX + 4096 }, async (req, reply) => {
    const a = requireUser(req), k = key((req.params as any).key);
    const b = z.object({ value: z.unknown(), base: z.number().int().min(0) }).parse(req.body);
    if (b.value === undefined || b.value === null) throw bad('Nothing to save.');
    const json = JSON.stringify(b.value), size = Buffer.byteLength(json);
    if (size > ITEM_MAX) throw new HttpError(413, 'That is too large to keep in the cloud.', 'too_large');
    return ctx.db.tx(async t => {
      const cur = await t.one<any>('select value, version, size from cloud_items where user_id = $1 and key = $2 for update', [a.user.id, k]);
      if ((cur?.version ?? 0) !== b.base) { reply.code(409); return { error: 'Another device saved first.', code: 'conflict', value: cur?.value ?? null, version: cur?.version ?? 0 }; }
      const used = Number((await t.one<any>('select coalesce(sum(size), 0) as n from cloud_items where user_id = $1 and key <> $2', [a.user.id, k]))?.n || 0);
      if (used + size > USER_MAX) throw new HttpError(413, 'Your cloud space is full. Delete an old save.', 'quota');
      const row = await t.one<any>(`insert into cloud_items (user_id, key, value, version, size) values ($1, $2, $3::jsonb, 1, $4)
        on conflict (user_id, key) do update set value = excluded.value, version = cloud_items.version + 1, size = excluded.size, updated_at = now() returning version, updated_at`, [a.user.id, k, json, size]);
      return { ok: true, version: row.version, updated_at: row.updated_at };
    });
  });
  app.delete('/api/cloud/:key', limit, async req => {
    const a = requireUser(req), k = key((req.params as any).key);
    await ctx.db.query('delete from cloud_items where user_id = $1 and key = $2', [a.user.id, k]);
    return { ok: true };
  });
}
