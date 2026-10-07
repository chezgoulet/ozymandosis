// SPDX-License-Identifier: AGPL-3.0-only
// Operations monitor: watches the service and the machine around it and tells
// the operators before players do. Checks run every minute (one instance at a
// time); each alert is sent once, then again every six hours while it lasts,
// and marked resolved when it clears. Alerts go to ALERT_EMAIL and/or
// ALERT_WEBHOOK_URL (Discord or Slack incoming webhooks both work), and are
// listed in the admin console.
//
// External watchers still matter (a dead server cannot report itself): see
// docs/OPERATIONS.md for the uptime monitor and the backup dead man's switch.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Ctx } from '../context.js';
import { TurnHealth } from './turn.js';

export interface Alert { key: string; title: string; body: string }
const RESEND_H = 6, LOCK = 7_021_882;

export class Monitor {
  private errors: number[] = [];
  private requests = 0;
  private statusCount: Record<string, number> = {};
  private lag = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout | null = null;
  readonly started = Date.now();
  readonly turn: TurnHealth;
  constructor(private ctx: Ctx) { this.lag.enable(); this.turn = new TurnHealth(ctx.cfg.TURN_URLS, ctx.cfg.TURN_SECRET); }

  record(status: number) {
    this.requests++;
    const k = `${Math.floor(status / 100)}xx`; this.statusCount[k] = (this.statusCount[k] || 0) + 1;
    if (status >= 500) { const now = Date.now(); this.errors.push(now); while (this.errors.length && now - this.errors[0] > 15 * 60e3) this.errors.shift(); }
  }
  lagMs() { return { p50: this.lag.percentile(50) / 1e6, p99: this.lag.percentile(99) / 1e6, max: this.lag.max / 1e6 }; }

  // What is wrong right now.
  async check(): Promise<Alert[]> {
    const { cfg, db } = this.ctx, out: Alert[] = [], now = Date.now();
    const recent = this.errors.filter(t => now - t < 5 * 60e3).length;
    if (recent >= cfg.ALERT_5XX_PER_5MIN) out.push({ key: 'http.5xx', title: `${recent} server errors in 5 minutes`, body: 'The play service is failing requests. Check `docker compose logs play`.' });
    const lag = this.lagMs(); this.lag.reset();
    // D19: every online match goes through TURN, so a dead relay is no online play at all
    const turn = await this.turn.check(0);
    if (turn && !turn.ok) out.push({ key: 'turn.down', title: 'The TURN relay is not working: online matches cannot connect', body: `Probe: ${turn.detail}. Check \`docker compose logs turn\` (logging is off by design; restart it with \`docker compose restart turn\`), the firewall (3478 udp/tcp, 5349 tcp, 49160-49400 udp) and that TURN_SECRET matches.` });
    if (lag.p99 > 250) out.push({ key: 'eventloop', title: `The play service is stalling (p99 event-loop delay ${Math.round(lag.p99)} ms)`, body: 'Something is blocking the process: a slow query, a large payload, or CPU starvation on the host.' });
    try {
      const hb = await db.one<any>(`select at, ok, detail from ops_heartbeats where name = 'backup'`);
      const age = hb ? (now - new Date(hb.at).getTime()) / 3600e3 : Infinity;
      if (cfg.prod || hb) {
        if (!hb) out.push({ key: 'backup.none', title: 'No database backup has ever been recorded', body: 'The backup service is not running or cannot reach the database. See docs/OPERATIONS.md.' });
        else if (age > cfg.BACKUP_STALE_HOURS) out.push({ key: 'backup.stale', title: `The last database backup was ${Math.round(age)} hours ago`, body: 'Check `docker compose logs backup`.' });
        else if (!hb.ok) out.push({ key: 'backup.failed', title: 'The last database backup failed', body: `Detail: ${JSON.stringify(hb.detail)}. Check \`docker compose logs backup\`.` });
        const disk = Number(hb?.detail?.disk);
        if (disk >= cfg.ALERT_DISK_PERCENT) out.push({ key: 'disk.full', title: `The server disk is ${disk}% full`, body: 'Free space before Postgres stops accepting writes: old images (`docker image prune`), logs, local backups.' });
      }
      const regressed = await db.query<any>(`select id, title, last_version from issues where status = 'regressed' and last_seen > now() - interval '1 hour'`);
      for (const r of regressed) out.push({ key: 'crash.regressed:' + r.id, title: `A fixed crash is back: ${r.title}`, body: `Seen again in ${r.last_version || 'an unknown version'}. Admin console → Crashes & bugs.` });
      const spikes = await db.query<any>(`select id, title, count from issues where kind = 'crash' and status in ('open', 'regressed') and first_seen > now() - interval '1 day' and count >= $1`, [cfg.ALERT_CRASH_SPIKE]);
      for (const r of spikes) out.push({ key: 'crash.spike:' + r.id, title: `New crash hitting many players (${r.count} reports): ${r.title}`, body: 'Admin console → Crashes & bugs.' });
      const tax = await db.one(`select 1 from audit_log where action = 'billing.tax_unavailable' and at > now() - interval '1 day' limit 1`);
      if (tax) out.push({ key: 'billing.tax', title: 'Checkout is running without Stripe Tax', body: 'Activate Stripe Tax (Stripe dashboard → Tax) and add your registrations. Until then no tax is collected.' });
      const disputes = await db.one<any>(`select count(*)::int as n from matches where status = 'disputed' and settled_at > now() - interval '1 day'`);
      if (disputes && disputes.n >= cfg.ALERT_DISPUTES_PER_DAY) out.push({ key: 'matches.disputes', title: `${disputes.n} disputed match results today`, body: 'Admin console → Matches → Disputed. Many at once can mean a cheat is circulating, or a desync bug.' });
    } catch (e: any) {
      out.push({ key: 'db.down', title: 'The database is not answering', body: String(e.message).slice(0, 300) });
    }
    return out;
  }

  // Record, send (new or due again), and resolve what cleared.
  async run(): Promise<Alert[]> {
    const firing = await this.check();
    const due: Alert[] = [];
    try {
      await this.ctx.db.tx(async t => {
        const got = await t.one<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [LOCK]);
        if (!got?.ok) return;
        for (const a of firing) {
          const row = await t.one<any>(`insert into ops_alerts (key, title, body) values ($1, $2, $3)
            on conflict (key) do update set title = excluded.title, body = excluded.body, last_at = now(), count = ops_alerts.count + 1,
              resolved_at = null, first_at = case when ops_alerts.resolved_at is not null then now() else ops_alerts.first_at end,
              sent_at = case when ops_alerts.resolved_at is not null then null else ops_alerts.sent_at end
            returning sent_at`, [a.key, a.title, a.body]);
          if (!row?.sent_at || Date.now() - new Date(row.sent_at).getTime() > RESEND_H * 3600e3) due.push(a);
        }
        const keys = firing.map(a => a.key);
        await t.query(`update ops_alerts set resolved_at = now() where resolved_at is null and not (key = any($1::text[]))`, [keys]);
        if (due.length) await t.query(`update ops_alerts set sent_at = now() where key = any($1::text[])`, [due.map(a => a.key)]);
      });
    } catch { if (firing.some(a => a.key === 'db.down')) due.push(...firing.filter(a => a.key === 'db.down')); }
    if (due.length) await this.send(due);
    return firing;
  }

  async send(alerts: Alert[]) {
    const { cfg, mail, log } = this.ctx;
    const where = cfg.PUBLIC_URL.replace(/^https?:\/\//, '');
    const text = alerts.map(a => `• ${a.title}\n  ${a.body}`).join('\n');
    log.warn({ alerts: alerts.map(a => a.key) }, 'alert');
    for (const to of (cfg.ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean))
      await mail.send({ to, subject: `[Ozymandosis ${where}] ${alerts[0].title}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ''}`, text: `${text}\n\nAdmin console: ${cfg.PUBLIC_URL}/admin` }).catch(e => log.error({ err: { message: e.message } }, 'alert mail failed'));
    if (cfg.ALERT_WEBHOOK_URL) {
      const body = `**Ozymandosis (${where})**\n${text}`.slice(0, 1900);
      await fetch(cfg.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: body, text: body }), signal: AbortSignal.timeout(10e3) })
        .catch(e => log.error({ err: { message: e.message } }, 'alert webhook failed'));
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.run().catch(e => this.ctx.log.error({ err: { message: e.message } }, 'monitor failed')); }, 60e3);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.lag.disable(); }

  // Prometheus text format, for any scraper you point at /metrics (with METRICS_TOKEN).
  metrics(): string {
    const hub = this.ctx.hub.stats(), m = process.memoryUsage(), lag = this.lagMs();
    const lines = [
      '# TYPE ozy_up gauge', 'ozy_up 1',
      '# TYPE ozy_uptime_seconds gauge', `ozy_uptime_seconds ${Math.round((Date.now() - this.started) / 1000)}`,
      '# TYPE ozy_http_requests_total counter', ...Object.entries(this.statusCount).map(([k, v]) => `ozy_http_requests_total{status="${k}"} ${v}`),
      '# TYPE ozy_online_players gauge', `ozy_online_players ${hub.online}`,
      '# TYPE ozy_lobbies gauge', `ozy_lobbies ${hub.lobbies}`,
      '# TYPE ozy_matches_live gauge', `ozy_matches_live ${hub.matches}`,
      '# TYPE ozy_queued_players gauge', `ozy_queued_players ${hub.queued}`,
      '# TYPE ozy_memory_bytes gauge', `ozy_memory_bytes{kind="rss"} ${m.rss}`, `ozy_memory_bytes{kind="heap"} ${m.heapUsed}`,
      ...(this.turn.configured ? ['# TYPE ozy_turn_up gauge', `ozy_turn_up ${this.turn.peek()?.ok ? 1 : 0}`, '# TYPE ozy_turn_probe_ms gauge', `ozy_turn_probe_ms ${this.turn.peek()?.ms ?? -1}`] : []),
      '# TYPE ozy_event_loop_delay_ms gauge', `ozy_event_loop_delay_ms{q="p50"} ${lag.p50.toFixed(2)}`, `ozy_event_loop_delay_ms{q="p99"} ${lag.p99.toFixed(2)}`,
    ];
    return lines.join('\n') + '\n';
  }
}
