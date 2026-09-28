// Crash and bug reports from game clients. Reports are scrubbed of anything
// personal, grouped into issues by a fingerprint of the error, and shown to
// staff in the admin console. Signed-in players can opt out in their account.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { tooMany } from '../context.js';
import { scrub } from '../lib/privacy.js';
import { sha256 } from '../lib/crypto.js';
import { Limiter } from '../lib/limiter.js';
import { bump } from '../auth/service.js';

const perClient = new Limiter(30, 60 * 60e3);
// What a crash or bug report may carry as context: settings and game-state summaries only.
export const REPORT_CONTEXT_KEYS = ['settings', 'backend', 'tier', 'fps', 'mode', 'players', 'mapSize', 'time', 'units', 'net', 'log', 'url', 'screen', 'memory', 'lang'] as const;
const Report = z.object({
  kind: z.enum(['crash', 'bug']),
  message: z.string().max(4000).default(''),
  stack: z.string().max(40000).default(''),
  description: z.string().max(4000).default(''),
  version: z.string().max(32).default('?'),
  platform: z.string().max(40).default('?'),
  renderer: z.string().max(40).default('?'),
  context: z.record(z.string(), z.unknown()).default({}),
  screenshot: z.string().max(900_000).optional(),
});

// Fingerprint: the message with numbers and ids stripped, plus the top frames of
// the stack without line/column numbers or origins, so one bug is one issue across builds.
export function fingerprint(kind: string, message: string, stack: string): { fp: string; title: string } {
  const msg = message.replace(/\b\d+(\.\d+)?\b/g, 'N').replace(/'[^']*'|"[^"]*"/g, 'S').slice(0, 200).trim();
  const frames = stack.split('\n').map(l => l.trim()).filter(l => /^at |@/.test(l)).slice(0, 4)
    .map(l => l.replace(/\(?(https?|file|capacitor):\/\/[^)\s]*?\/([^/)\s]+?)(\?[^:)\s]*)?:\d+:\d+\)?/g, '$2').replace(/:\d+:\d+/g, ''));
  const plain = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  const title = kind === 'bug' ? (plain || 'Bug report') : (plain || frames[0] || 'Unknown crash');
  return { fp: sha256(kind + '|' + (kind === 'bug' ? 'user-reported' : msg + '|' + frames.join('|'))), title: title.slice(0, 160) };
}

export default async function reportRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/reports', { bodyLimit: 1_200_000 }, async req => {
    const r = Report.parse(req.body);
    const uid = req.auth?.user.id || null;
    if (req.auth && !req.auth.user.crash_reports && r.kind === 'crash') return { ok: true, skipped: true };
    const key = uid ? 'u:' + uid : 'ip:' + ctx.secrets.pseudonym(req.ip || '', 16);
    if (!perClient.take(key)) throw tooMany();
    const message = scrub(r.message, 4000), stack = scrub(r.stack, 40000), description = scrub(r.description, 4000);
    // context is whitelisted: settings and game state summaries only
    const context: Record<string, unknown> = {};
    for (const k of REPORT_CONTEXT_KEYS) if (k in r.context) context[k] = typeof r.context[k] === 'string' ? scrub(r.context[k] as string, 8000) : r.context[k];
    if (typeof context.url === 'string') context.url = String(context.url).split(/[?#]/)[0];
    const shot = r.screenshot && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.screenshot) ? r.screenshot : null;
    const { fp, title } = fingerprint(r.kind, message, stack);
    const fpKey = r.kind === 'bug' ? sha256(fp + Date.now() + Math.random()) : fp; // each bug report is its own issue
    const issue = await ctx.db.one<any>(
      `insert into issues (fingerprint, kind, title, count, last_version, versions, platforms) values ($1, $2, $3, 1, $4, jsonb_build_object($4::text, 1), jsonb_build_object($5::text, 1))
       on conflict (fingerprint) do update set count = issues.count + 1, last_seen = now(), last_version = $4,
         versions = issues.versions || jsonb_build_object($4::text, coalesce((issues.versions ->> $4)::int, 0) + 1),
         platforms = issues.platforms || jsonb_build_object($5::text, coalesce((issues.platforms ->> $5)::int, 0) + 1),
         status = case when issues.status = 'resolved' and issues.resolved_in ~ '^[0-9]+(\\.[0-9]+)*$' and $4 ~ '^[0-9]+(\\.[0-9]+)*$'
           and string_to_array($4, '.')::int[] >= string_to_array(issues.resolved_in, '.')::int[] then 'regressed' else issues.status end
       returning id, count`, [fpKey, r.kind, title, r.version, r.platform]);
    // keep a bounded sample of raw reports per issue
    if (issue.count <= 50 || issue.count % 25 === 0) {
      await ctx.db.query(`insert into reports (issue_id, user_id, version, platform, renderer, message, stack, description, context, screenshot) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [issue.id, uid, r.version, r.platform, r.renderer, message, stack, description, JSON.stringify(context), shot]);
    }
    await bump(ctx, r.kind === 'crash' ? 'crashes' : 'bug_reports');
    return { ok: true, issue: issue.id };
  });
}
