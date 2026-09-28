// Data retention: expired credentials and old records are deleted on a schedule,
// so the database holds only what the service still needs (and the disk does not
// fill). The policy is published in the privacy notice; change both together.
//
// Runs hourly in every instance; a transaction-scoped advisory lock makes sure
// only one instance sweeps at a time.
import type { Ctx } from '../context.js';

export const RETENTION = {
  expiredSessionsGraceH: 0,        // sessions: gone once expired
  usedTokensDays: 1,               // email / hand-off / OAuth state tokens after use or expiry
  stripeEventsDays: 90,            // webhook idempotency (Stripe retries for 3 days)
  screenshotDays: 30,              // bug-report screenshots are the heaviest rows
  reportsDays: 180,                // individual crash/bug reports (issues keep their counts)
  closedIssuesDays: 365,           // resolved or ignored issues with no recent reports
  reportChatDays: 90,              // chat attached to a player report, after it is resolved
  playerReportsDays: 730,          // resolved player reports
  auditDays: 730,                  // staff action log
  unverifiedAccountDays: 30,       // email sign-ups never confirmed and never used
  endedAnnouncementsDays: 365,
  staleMatchHours: 24,             // matches that started but never reported an end
} as const;

const LOCK = 7_021_881; // arbitrary, stable advisory lock key

export async function sweep(ctx: Ctx): Promise<Record<string, number>> {
  const R = RETENTION, out: Record<string, number> = {};
  await ctx.db.tx(async t => {
    const got = await t.one<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [LOCK]);
    if (!got?.ok) return;
    const run = async (name: string, sql: string, params: unknown[] = []) => {
      const rows = await t.query(sql + ' returning 1', params);
      if (rows.length) out[name] = rows.length;
    };
    await run('sessions', `delete from sessions where expires_at < now() - make_interval(hours => $1)`, [R.expiredSessionsGraceH]);
    await run('email_tokens', `delete from email_tokens where expires_at < now() - make_interval(days => $1) or used_at < now() - make_interval(days => $1)`, [R.usedTokensDays]);
    await run('login_handoffs', `delete from login_handoffs where expires_at < now() - make_interval(days => $1)`, [R.usedTokensDays]);
    await run('oauth_states', `delete from oauth_states where expires_at < now()`);
    await run('stripe_events', `delete from stripe_events where received_at < now() - make_interval(days => $1)`, [R.stripeEventsDays]);
    await run('screenshots', `update reports set screenshot = null where screenshot is not null and created_at < now() - make_interval(days => $1)`, [R.screenshotDays]);
    await run('reports', `delete from reports where created_at < now() - make_interval(days => $1)`, [R.reportsDays]);
    await run('issues', `delete from issues i where status in ('resolved', 'ignored') and last_seen < now() - make_interval(days => $1) and not exists (select 1 from reports r where r.issue_id = i.id)`, [R.closedIssuesDays]);
    await run('report_chat', `update player_reports set chat = '[]'::jsonb where status <> 'open' and chat <> '[]'::jsonb and resolved_at < now() - make_interval(days => $1)`, [R.reportChatDays]);
    await run('player_reports', `delete from player_reports where status <> 'open' and resolved_at < now() - make_interval(days => $1)`, [R.playerReportsDays]);
    await run('audit_log', `delete from audit_log where at < now() - make_interval(days => $1)`, [R.auditDays]);
    await run('announcements', `delete from announcements where ends_at is not null and ends_at < now() - make_interval(days => $1)`, [R.endedAnnouncementsDays]);
    await run('stale_matches', `update matches set ended_at = started_at, duration_s = null where ended_at is null and started_at < now() - make_interval(hours => $1)`, [R.staleMatchHours]);
    // email sign-ups that never confirmed, never linked a provider, never paid and never played
    await run('unverified_users', `delete from users u where u.status = 'active' and u.role = 'player' and u.email is not null and not u.email_verified and u.created_at < now() - make_interval(days => $1)
      and u.matches = 0 and u.stripe_customer_id is null
      and not exists (select 1 from identities i where i.user_id = u.id)
      and not exists (select 1 from subscriptions s where s.user_id = u.id)
      and not exists (select 1 from promo_redemptions p where p.user_id = u.id)
      and not exists (select 1 from match_players m where m.user_id = u.id)`, [R.unverifiedAccountDays]);
  });
  return out;
}

export function startRetention(ctx: Ctx, everyMs = 3600e3): () => void {
  const tick = () => sweep(ctx)
    .then(n => { if (Object.keys(n).length) ctx.log.info({ swept: n }, 'retention'); })
    .catch(e => ctx.log.error({ err: { message: e.message } }, 'retention failed'));
  const first = setTimeout(tick, 60e3); first.unref();
  const timer = setInterval(tick, everyMs); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
