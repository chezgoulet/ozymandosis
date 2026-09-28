// Frame-rate runs from game clients (js/ui/framestats.js): anonymous numbers about
// how a match ran on a class of device, kept for RETENTION.perfRunsDays and listed
// for staff in the admin console (Performance). No account, no address is stored:
// a run is accepted signed in or not, and the user is not recorded.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { tooMany } from '../context.js';
import { requireRole } from '../app.js';
import { Limiter } from '../lib/limiter.js';

const perClient = new Limiter(20, 60 * 60e3);
const word = (n: number) => z.string().max(n).regex(/^[\w .@×x:+-]*$/);
export const PerfRun = z.object({
  version: word(32), platform: word(20), deviceClass: z.enum(['desktop', 'mobile', 'low']), renderer: word(20), mode: z.enum(['local', 'online', 'lan']),
  seconds: z.number().int().min(1).max(86400), frames: z.number().int().min(1).max(10_000_000), fps: z.number().min(0).max(1000),
  p50: z.number().min(0).max(1000), p95: z.number().min(0).max(1000), p99: z.number().min(0).max(1000), worst: z.number().min(0).max(100000).optional(),
  below30: z.number().min(0).max(100), hitches: z.number().int().min(0).optional(), cpuMs: z.number().min(0).max(1000).optional(),
  tierStart: word(20).nullable().optional(), tierEnd: word(20).nullable().optional(), tierChanges: z.number().int().min(0).max(100000),
  tierLog: z.array(z.object({ s: z.number(), from: word(20).nullable(), to: word(20), why: z.string().max(80) })).max(40).optional(),
  unitsPeak: z.number().int().min(0).max(100000).optional(), popCap: z.number().int().nullable().optional(), players: z.number().int().nullable().optional(),
  quality: word(20).optional(), cores: z.number().int().nullable().optional(), memoryGB: z.number().nullable().optional(), screen: word(24).optional(),
});

export default async function perfRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/perf', async req => {
    const r = PerfRun.parse(req.body);
    if (r.mode === 'lan') return { ok: true, skipped: true }; // local play does not report to the service
    const key = req.auth ? 'u:' + ctx.secrets.pseudonym(req.auth.user.id, 16) : 'ip:' + ctx.secrets.pseudonym(req.ip || '', 16);
    if (!perClient.take(key)) throw tooMany();
    const detail = { worst: r.worst, hitches: r.hitches, cpuMs: r.cpuMs, tierLog: r.tierLog || [], popCap: r.popCap, players: r.players, quality: r.quality, cores: r.cores, memoryGB: r.memoryGB, screen: r.screen };
    await ctx.db.query(`insert into perf_runs (version, platform, device_class, renderer, mode, seconds, frames, fps, p50, p95, p99, below30, tier_start, tier_end, tier_changes, units_peak, detail)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [r.version, r.platform, r.deviceClass, r.renderer, r.mode, r.seconds, r.frames, r.fps, r.p50, r.p95, r.p99, r.below30, r.tierStart ?? null, r.tierEnd ?? null, r.tierChanges, r.unitsPeak ?? null, JSON.stringify(detail)]);
    return { ok: true };
  });

  // Staff: recent runs, and per device class and renderer, the median of each percentile.
  app.get('/api/admin/perf', async req => {
    requireRole(req, 'support');
    const q = req.query as any, days = Math.min(365, Math.max(1, Number(q.days) || 30));
    const runs = await ctx.db.query<any>(`select * from perf_runs where created_at > now() - make_interval(days => $1) ${q.version ? 'and version = $2' : ''} order by created_at desc limit 200`, q.version ? [days, String(q.version)] : [days]);
    const summary = await ctx.db.query<any>(`select device_class, renderer, platform, count(*)::int as runs,
        percentile_cont(0.5) within group (order by p50) as p50, percentile_cont(0.5) within group (order by p95) as p95, percentile_cont(0.5) within group (order by p99) as p99,
        percentile_cont(0.5) within group (order by fps) as fps, avg(tier_changes)::real as tier_changes, avg(below30)::real as below30
      from perf_runs where created_at > now() - make_interval(days => $1) group by 1, 2, 3 order by runs desc`, [days]);
    return { runs, summary };
  });
}
