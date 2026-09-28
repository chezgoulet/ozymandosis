// Players report players; staff act on reports. Sanctions are recorded,
// audited, and take effect immediately on connected clients.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { bad, notFound, tooMany, forbidden, ROLE_RANK } from '../context.js';
import { requireUser, requireRole, audit } from '../app.js';
import { Limiter } from '../lib/limiter.js';
import { scrub } from '../lib/privacy.js';
import { revokeAll, uniqueName } from '../auth/service.js';
import { nameKey } from '../lib/names.js';

const reportLimit = new Limiter(12, 60 * 60e3);

export type SanctionKind = 'warn' | 'mute' | 'unmute' | 'suspend' | 'ban' | 'unban' | 'rename' | 'reset_mfa' | 'revoke_sessions';
export async function sanction(ctx: Ctx, actor: { id: string; role: string }, userId: string, kind: SanctionKind, reason: string, hours?: number | null, reportId?: string | null) {
  const target = await ctx.db.one<any>('select id, role, display_name from users where id = $1', [userId]);
  if (!target) throw notFound('No such player.');
  if (ROLE_RANK[target.role as keyof typeof ROLE_RANK] >= ROLE_RANK[actor.role as keyof typeof ROLE_RANK] && actor.id !== userId) throw forbidden('You cannot act on staff at or above your role.');
  const until = hours ? new Date(ctx.now() + hours * 3600e3) : null;
  switch (kind) {
    case 'warn': break;
    case 'mute': await ctx.db.query('update users set muted_until = $2 where id = $1', [userId, until || new Date(ctx.now() + 24 * 3600e3)]); break;
    case 'unmute': await ctx.db.query('update users set muted_until = null where id = $1', [userId]); break;
    case 'suspend': if (!until) throw bad('A suspension needs a length.'); await ctx.db.query(`update users set status = 'suspended', suspended_until = $2 where id = $1`, [userId, until]); break;
    case 'ban': await ctx.db.query(`update users set status = 'banned' where id = $1`, [userId]); await revokeAll(ctx, userId); break;
    case 'unban': await ctx.db.query(`update users set status = 'active', suspended_until = null where id = $1 and status in ('banned', 'suspended')`, [userId]); break;
    case 'rename': { const n = await uniqueName(ctx, null); await ctx.db.query('update users set display_name = $2, name_key = $3 where id = $1', [userId, n, nameKey(n)]); break; }
    case 'reset_mfa': await ctx.db.query('update users set totp_enabled = false, totp_secret_enc = null, totp_last_step = null where id = $1', [userId]); await ctx.db.query('delete from recovery_codes where user_id = $1', [userId]); break;
    case 'revoke_sessions': await revokeAll(ctx, userId); break;
  }
  await ctx.db.query(`insert into sanctions (user_id, kind, reason, until, by_user, report_id) values ($1, $2, $3, $4, $5, $6)`, [userId, kind, reason.slice(0, 500), until, actor.id, reportId || null]);
  await audit(ctx, actor.id, 'sanction.' + kind, userId, { reason: reason.slice(0, 200), hours: hours || null, report: reportId || null });
  if (kind === 'ban' || kind === 'suspend' || kind === 'revoke_sessions') ctx.hub.kickUser(userId, kind === 'ban' ? 'This account has been banned.' : kind === 'suspend' ? `Your account is suspended until ${until!.toUTCString()}.` : 'Please sign in again.');
  else ctx.hub.refreshUser(userId);
}

export default async function moderationRoutes(app: FastifyInstance, ctx: Ctx) {
  // A player reports another player (from a lobby or the end-of-match screen).
  app.post('/api/player-reports', async req => {
    const a = requireUser(req);
    const b = z.object({
      target: z.string().uuid(), reason: z.enum(['cheating', 'harassment', 'name', 'spam', 'griefing', 'other']), details: z.string().max(1000).default(''),
      match: z.string().uuid().optional(), chat: z.array(z.object({ from: z.string().max(40), text: z.string().max(200) })).max(30).default([]),
    }).parse(req.body);
    if (b.target === a.user.id) throw bad('You cannot report yourself.');
    if (!reportLimit.take(a.user.id)) throw tooMany('You have sent a lot of reports. Our moderators will get to them.');
    if (!(await ctx.db.one('select 1 from users where id = $1', [b.target]))) throw notFound('That player no longer exists.');
    const dup = await ctx.db.one(`select 1 from player_reports where reporter_id = $1 and target_id = $2 and created_at > now() - interval '1 hour'`, [a.user.id, b.target]);
    if (dup) return { ok: true, duplicate: true };
    await ctx.db.query(`insert into player_reports (reporter_id, target_id, reason, details, match_id, chat) values ($1, $2, $3, $4, $5, $6)`,
      [a.user.id, b.target, b.reason, scrub(b.details, 1000), b.match || null, JSON.stringify(b.chat.map(c => ({ from: c.from, text: scrub(c.text, 200) })))]);
    return { ok: true };
  });

  // Staff: the report queue and actions on it.
  app.get('/api/admin/player-reports', async req => {
    requireRole(req, 'moderator');
    const q = z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open'), limit: z.coerce.number().max(200).default(50) }).parse(req.query);
    const rows = await ctx.db.query<any>(
      `select r.*, t.display_name as target_name, t.status as target_status, rp.display_name as reporter_name,
        (select count(*) from player_reports x where x.target_id = r.target_id) as target_reports,
        (select count(*) from sanctions s where s.user_id = r.target_id) as target_sanctions
       from player_reports r join users t on t.id = r.target_id left join users rp on rp.id = r.reporter_id
       where r.status = $1 order by r.created_at ${q.status === 'open' ? 'asc' : 'desc'} limit $2`, [q.status, q.limit]);
    return { reports: rows };
  });
  app.post('/api/admin/player-reports/:id/resolve', async req => {
    const a = requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['actioned', 'dismissed']), resolution: z.string().max(500).default(''), action: z.enum(['warn', 'mute', 'suspend', 'ban', 'rename']).optional(), hours: z.number().positive().max(24 * 365).optional() }).parse(req.body);
    const r = await ctx.db.one<any>('select * from player_reports where id = $1', [id]);
    if (!r) throw notFound();
    if (b.action) await sanction(ctx, { id: a.user.id, role: a.user.role }, r.target_id, b.action, b.resolution || r.reason, b.hours, id);
    await ctx.db.query(`update player_reports set status = $2, resolution = $3, resolved_by = $4, resolved_at = now() where id = $1`, [id, b.status, b.resolution, a.user.id]);
    // close other open reports against the same player for the same reason when actioned
    if (b.status === 'actioned') await ctx.db.query(`update player_reports set status = 'actioned', resolution = 'Handled with ' || $3, resolved_by = $4, resolved_at = now() where target_id = $1 and reason = $2 and status = 'open'`, [r.target_id, r.reason, id, a.user.id]);
    await audit(ctx, a.user.id, 'report.' + b.status, r.target_id, { report: id });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/sanction', async req => {
    const a = requireRole(req, 'moderator');
    const { id } = req.params as { id: string };
    const b = z.object({ kind: z.enum(['warn', 'mute', 'unmute', 'suspend', 'ban', 'unban', 'rename', 'reset_mfa', 'revoke_sessions']), reason: z.string().max(500).default(''), hours: z.number().positive().max(24 * 365).optional() }).parse(req.body);
    if ((b.kind === 'ban' || b.kind === 'unban' || b.kind === 'reset_mfa') && ROLE_RANK[a.user.role] < ROLE_RANK.admin) throw forbidden('Only admins can ban, unban or reset two-factor.');
    await sanction(ctx, { id: a.user.id, role: a.user.role }, id, b.kind, b.reason, b.hours);
    return { ok: true };
  });
}
