// Staff API behind the admin console: dashboard, players, crash issues,
// announcements, live configuration, matches and the audit log.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { bad, forbidden, notFound, ROLE_RANK } from '../context.js';
import { requireRole, audit } from '../app.js';
import { entitlements } from '../auth/service.js';
import { deleteAccount } from '../auth/me.js';

const Role = z.enum(['player', 'support', 'moderator', 'admin', 'owner']);

export default async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/admin/dashboard', async req => {
    requireRole(req, 'support');
    const one = async (sql: string, p: unknown[] = []) => Number(Object.values((await ctx.db.one<any>(sql, p)) || { v: 0 })[0] || 0);
    const [users, dau, wau, mau, subs, openIssues, regressed, openReports, matches24] = await Promise.all([
      one(`select count(*) from users where status <> 'deleted'`),
      one(`select count(*) from users where last_seen_at > now() - interval '1 day'`),
      one(`select count(*) from users where last_seen_at > now() - interval '7 days'`),
      one(`select count(*) from users where last_seen_at > now() - interval '30 days'`),
      one(`select count(distinct user_id) from subscriptions where status in ('active', 'trialing') and current_period_end > now()`),
      one(`select count(*) from issues where status in ('open', 'regressed') and kind = 'crash'`),
      one(`select count(*) from issues where status = 'regressed'`),
      one(`select count(*) from player_reports where status = 'open'`),
      one(`select count(*) from matches where started_at > now() - interval '1 day'`),
    ]);
    const series = await ctx.db.query<any>(`select day, key, value from daily_stats where day > current_date - 30 order by day`);
    const topIssues = await ctx.db.query<any>(`select id, title, count, last_seen, last_version, status from issues where kind = 'crash' and status in ('open', 'regressed') order by last_seen desc limit 8`);
    return { now: new Date().toISOString(), live: ctx.hub.stats(), users, dau, wau, mau, subscribers: subs, mrrUsd: subs * 1, openIssues, regressed, openReports, matches24, series, topIssues };
  });

  // ── players ────────────────────────────────────────────────────
  app.get('/api/admin/users', async req => {
    const a = requireRole(req, 'support');
    const q = z.object({ q: z.string().max(100).default(''), status: z.string().optional(), role: z.string().optional(), limit: z.coerce.number().max(200).default(50) }).parse(req.query);
    const term = q.q.trim();
    // Only admins may search by email; everyone else searches names and ids.
    const byEmail = ROLE_RANK[a.user.role] >= ROLE_RANK.admin && term.includes('@');
    const rows = await ctx.db.query<any>(
      `select id, display_name, ${ROLE_RANK[a.user.role] >= ROLE_RANK.admin ? 'email,' : ''} role, status, rating, matches, created_at, last_seen_at, muted_until, suspended_until,
         (select count(*) from player_reports r where r.target_id = u.id and r.status = 'open') as open_reports
       from users u where ($1 = '' or ${byEmail ? 'email = lower($1)' : "name_key like '%' || lower($1) || '%' or id::text = $1"})
         and ($2::text is null or status = $2) and ($3::text is null or role = $3)
       order by last_seen_at desc nulls last limit $4`, [term, q.status || null, q.role || null, q.limit]);
    if (byEmail) await audit(ctx, a.user.id, 'user.search_email', null, {});
    return { users: rows };
  });
  app.get('/api/admin/users/:id', async req => {
    const a = requireRole(req, 'support');
    const { id } = req.params as { id: string };
    const u = await ctx.db.one<any>('select * from users where id = $1', [id]);
    if (!u) throw notFound();
    const admin = ROLE_RANK[a.user.role] >= ROLE_RANK.admin;
    const [identities, sanctions, reportsAgainst, reportsBy, sessions, matches] = await Promise.all([
      ctx.db.query('select provider, created_at from identities where user_id = $1', [id]),
      ctx.db.query(`select s.kind, s.reason, s.until, s.created_at, b.display_name as by from sanctions s left join users b on b.id = s.by_user where s.user_id = $1 order by s.created_at desc limit 50`, [id]),
      ctx.db.query(`select id, reason, details, status, created_at from player_reports where target_id = $1 order by created_at desc limit 50`, [id]),
      ctx.db.one(`select count(*) as n from player_reports where reporter_id = $1`, [id]),
      ctx.db.query('select kind, client, mfa, created_at, last_used_at from sessions where user_id = $1 and expires_at > now() order by last_used_at desc', [id]),
      ctx.db.query(`select m.id, m.mode, m.started_at, m.duration_s, mp.result from match_players mp join matches m on m.id = mp.match_id where mp.user_id = $1 order by m.started_at desc limit 20`, [id]),
    ]);
    if (admin) await audit(ctx, a.user.id, 'user.view', id, {});
    return {
      user: { id: u.id, name: u.display_name, email: admin ? u.email : (u.email ? '•••@' + u.email.split('@')[1] : null), emailVerified: u.email_verified, role: u.role, status: u.status, mfa: u.totp_enabled,
        rating: u.rating, matches: u.matches, wins: u.wins, createdAt: u.created_at, lastSeenAt: u.last_seen_at, mutedUntil: u.muted_until, suspendedUntil: u.suspended_until, stripeCustomer: admin ? u.stripe_customer_id : !!u.stripe_customer_id },
      entitlements: await entitlements(ctx, u), identities, sanctions, reportsAgainst, reportsFiled: Number((reportsBy as any)?.n || 0), sessions, matches,
    };
  });
  app.post('/api/admin/users/:id/role', async req => {
    const a = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const b = z.object({ role: Role }).parse(req.body);
    if (ROLE_RANK[b.role] >= ROLE_RANK[a.user.role] && a.user.role !== 'owner') throw forbidden('You can only grant roles below your own.');
    const t = await ctx.db.one<any>('select role from users where id = $1', [id]);
    if (!t) throw notFound();
    if (ROLE_RANK[t.role as keyof typeof ROLE_RANK] >= ROLE_RANK[a.user.role] && a.user.role !== 'owner') throw forbidden();
    await ctx.db.query('update users set role = $2 where id = $1', [id, b.role]);
    await audit(ctx, a.user.id, 'user.role', id, { role: b.role });
    ctx.hub.refreshUser(id);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/delete', async req => {
    const a = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const b = z.object({ confirm: z.literal('DELETE') }).parse(req.body);
    void b;
    const t = await ctx.db.one<any>('select role from users where id = $1', [id]);
    if (!t) throw notFound();
    if (ROLE_RANK[t.role as keyof typeof ROLE_RANK] >= ROLE_RANK[a.user.role]) throw forbidden();
    await deleteAccount(ctx, id, a.user.id);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/grant', async req => {
    // complimentary membership (press, testers, refunds) without Stripe
    const a = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const b = z.object({ days: z.number().int().min(1).max(3650) }).parse(req.body);
    await ctx.db.query(`insert into subscriptions (id, user_id, status, current_period_end) values ($1, $2, 'active', now() + ($3 || ' days')::interval)
      on conflict (id) do update set status = 'active', current_period_end = now() + ($3 || ' days')::interval, updated_at = now()`, ['comp_' + id, id, String(b.days)]);
    await audit(ctx, a.user.id, 'user.grant', id, { days: b.days });
    ctx.hub.refreshUser(id);
    return { ok: true };
  });

  // ── crash & bug issues ─────────────────────────────────────────
  app.get('/api/admin/issues', async req => {
    requireRole(req, 'support');
    const q = z.object({ status: z.string().default('open'), kind: z.enum(['crash', 'bug', 'all']).default('all'), version: z.string().optional(), limit: z.coerce.number().max(200).default(60) }).parse(req.query);
    const statuses = q.status === 'open' ? ['open', 'regressed'] : q.status === 'all' ? ['open', 'regressed', 'resolved', 'ignored'] : [q.status];
    const rows = await ctx.db.query<any>(
      `select id, kind, title, status, count, first_seen, last_seen, last_version, resolved_in, versions, platforms from issues
       where status = any($1) and ($2 = 'all' or kind = $2) and ($3::text is null or versions ? $3) order by last_seen desc limit $4`, [statuses, q.kind, q.version || null, q.limit]);
    return { issues: rows };
  });
  app.get('/api/admin/issues/:id', async req => {
    requireRole(req, 'support');
    const { id } = req.params as { id: string };
    const issue = await ctx.db.one<any>('select * from issues where id = $1', [id]);
    if (!issue) throw notFound();
    const reports = await ctx.db.query<any>(`select r.id, r.created_at, r.version, r.platform, r.renderer, r.message, r.stack, r.description, r.context, (r.screenshot is not null) as has_screenshot, u.display_name as player
      from reports r left join users u on u.id = r.user_id where r.issue_id = $1 order by r.created_at desc limit 30`, [id]);
    return { issue, reports };
  });
  app.get('/api/admin/reports/:id/screenshot', async (req, reply) => {
    requireRole(req, 'support');
    const { id } = req.params as { id: string };
    const r = await ctx.db.one<any>('select screenshot from reports where id = $1', [id]);
    if (!r?.screenshot) throw notFound();
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(r.screenshot);
    if (!m) throw notFound();
    return reply.type(m[1]).header('cache-control', 'private, max-age=300').send(Buffer.from(m[2], 'base64'));
  });
  app.patch('/api/admin/issues/:id', async req => {
    const a = requireRole(req, 'support');
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['open', 'resolved', 'ignored']).optional(), resolvedIn: z.string().max(32).optional(), notes: z.string().max(5000).optional() }).parse(req.body);
    await ctx.db.query(`update issues set status = coalesce($2, status), resolved_in = case when $2 = 'resolved' then coalesce($3, resolved_in) else resolved_in end, notes = coalesce($4, notes) where id = $1`, [id, b.status || null, b.resolvedIn || null, b.notes ?? null]);
    await audit(ctx, a.user.id, 'issue.update', id, { status: b.status || null });
    return { ok: true };
  });

  // ── announcements ──────────────────────────────────────────────
  app.get('/api/admin/announcements', async req => {
    requireRole(req, 'moderator');
    return { announcements: await ctx.db.query(`select a.*, u.display_name as author from announcements a left join users u on u.id = a.created_by order by created_at desc limit 100`) };
  });
  app.post('/api/admin/announcements', async req => {
    const a = requireRole(req, 'moderator');
    const b = z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(2000), severity: z.enum(['info', 'warning', 'critical']).default('info'), audience: z.enum(['all', 'subscribers', 'free']).default('all'), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional() }).parse(req.body);
    if (b.severity === 'critical' && ROLE_RANK[a.user.role] < ROLE_RANK.admin) throw forbidden('Only admins can post critical announcements.');
    const row = await ctx.db.one<any>(`insert into announcements (title, body, severity, audience, starts_at, ends_at, created_by) values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7) returning *`,
      [b.title, b.body, b.severity, b.audience, b.startsAt || null, b.endsAt || null, a.user.id]);
    await audit(ctx, a.user.id, 'announcement.create', row.id, { title: b.title, audience: b.audience });
    if (new Date(row.starts_at).getTime() <= ctx.now()) ctx.hub.announce({ id: row.id, title: row.title, body: row.body, severity: row.severity, audience: row.audience, startsAt: row.starts_at, endsAt: row.ends_at });
    return { ok: true, announcement: row };
  });
  app.delete('/api/admin/announcements/:id', async req => {
    const a = requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    await ctx.db.query(`update announcements set ends_at = now() where id = $1`, [id]);
    await audit(ctx, a.user.id, 'announcement.end', id);
    ctx.hub.broadcast({ op: 'announcement.end', id });
    return { ok: true };
  });

  // ── live configuration ─────────────────────────────────────────
  const CONFIG_KEYS = z.enum(['maintenance', 'minClientVersion', 'freeMatchMinutes', 'features', 'turnstileSiteKey']);
  app.get('/api/admin/config', async req => {
    requireRole(req, 'admin');
    return { config: await ctx.db.query(`select c.key, c.value, c.updated_at, u.display_name as updated_by from remote_config c left join users u on u.id = c.updated_by`) };
  });
  app.put('/api/admin/config/:key', async req => {
    const a = requireRole(req, 'admin');
    const key = CONFIG_KEYS.parse((req.params as any).key);
    const value = (req.body as any)?.value;
    const shapes: Record<string, z.ZodTypeAny> = {
      maintenance: z.object({ on: z.boolean(), message: z.string().max(300).optional() }),
      minClientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      freeMatchMinutes: z.number().int().min(1).max(600),
      features: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
      turnstileSiteKey: z.string().max(100).nullable(),
    };
    const parsed = shapes[key].safeParse(value);
    if (!parsed.success) throw bad('That value is not valid for ' + key + '.');
    await ctx.db.query(`insert into remote_config (key, value, updated_by) values ($1, $2, $3) on conflict (key) do update set value = $2, updated_at = now(), updated_by = $3`, [key, JSON.stringify(parsed.data), a.user.id]);
    await audit(ctx, a.user.id, 'config.set', key, { value: parsed.data });
    if (key === 'maintenance' && (parsed.data as any).on) ctx.hub.broadcast({ op: 'maintenance', msg: (parsed.data as any).message || 'Online play is going down for maintenance.' }, c => c.user?.role === 'player');
    return { ok: true };
  });

  // ── matches, audit ─────────────────────────────────────────────
  app.get('/api/admin/matches', async req => {
    requireRole(req, 'support');
    const rows = await ctx.db.query(`select m.id, m.code, m.mode, m.started_at, m.ended_at, m.duration_s, h.display_name as host,
      (select json_agg(json_build_object('name', u.display_name, 'result', mp.result, 'until', mp.until)) from match_players mp join users u on u.id = mp.user_id where mp.match_id = m.id) as players
      from matches m left join users h on h.id = m.host_id order by m.started_at desc nulls last limit 100`);
    return { matches: rows, live: ctx.hub.stats() };
  });
  app.get('/api/admin/audit', async req => {
    requireRole(req, 'admin');
    const q = z.object({ limit: z.coerce.number().max(500).default(100), action: z.string().optional() }).parse(req.query);
    return { log: await ctx.db.query(`select l.at, l.action, l.target, l.detail, u.display_name as actor from audit_log l left join users u on u.id = l.actor_id where ($1::text is null or l.action like $1 || '%') order by l.at desc limit $2`, [q.action || null, q.limit]) };
  });
}
