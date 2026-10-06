# Operating Ozymandosis

Runbooks for the live service. Setup is in [DEPLOY.md](DEPLOY.md). Everything here assumes you are in `~/ozymandosis` on the server as the `deploy` user, with

```
alias dc='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'
alias cli='dc exec play node apps/play/dist/cli.js'
```

## Releases

`deploy/deploy.sh [tag|commit]` (or the **deploy** workflow in GitHub Actions):

1. takes a backup (`backup.sh once`) and stops if it fails;
2. builds images tagged with the commit;
3. starts the new play service and site;
4. waits up to 90 s for the play service to report healthy;
5. if it does not, prints its logs and restarts the previous release.

Production is a **manual, deliberate act** — `gh workflow run deploy.yml -f ref=<tag>`, or `deploy.sh` on the server. Nothing deploys on a push.

There is no staging environment in the pipeline. When a change has to be proved against a real server, a test box is spun up on demand and destroyed afterwards ([DEPLOY.md](DEPLOY.md#a-staging-box-when-you-need-one)); CI neither creates it nor knows it exists.

The gate on the workflow is a two-name actor allowlist rather than GitHub's required-reviewer rule: that rule is not available for a private repository on this plan (the API refuses it), so the accounts that may deploy are named in the workflow file itself.

**Migrations only move forward**, and a rollback runs the previous code against the new schema. So every migration must keep the previous release working: add columns and tables freely; rename or drop only in a later release, after nothing reads the old shape.

**Client versions.** Store builds lag the web. The peer protocol (`E.PROTOCOL` in `js/net/net.js`) keeps incompatible builds out of each other's matches; raise **Minimum client version** in the admin console (Live config) only when an old client is harmful, since it locks those players out of online play until their store updates.

## Watching from outside

The service alerts on what it can see (below). These watch what it cannot:

| Watch | How | Alert when |
|---|---|---|
| Site up | Uptime monitor (Better Stack, UptimeRobot, …) on `https://ozymandosis.com/` | down 2 minutes |
| Service up | Uptime monitor on `https://play.ozymandosis.com/healthz` (checks the database too) | down 2 minutes |
| TURN up | Uptime monitor on `https://play.ozymandosis.com/healthz/turn` (a real authenticated TURN allocation, made by the service: proves coturn is up, reachable and shares `TURN_SECRET`), plus a TCP port monitor on `turn.ozymandosis.com:3478` as a second opinion | down 2 minutes. **Since D19 every online match is relayed: TURN down means no online play at all.** |
| Certificates | The uptime monitors' TLS expiry check | under 14 days (Caddy renews at 30) |
| Backups | healthchecks.io (or similar) check; its URL in `BACKUP_PING_URL`, period 6 h, grace 2 h | a backup is late or failed |
| The machine | Linode Cloud Manager → the Linode → Settings → alert thresholds (CPU, disk I/O, network, transfer quota) | defaults are fine; set transfer to 80% |

## Alerts from the service

Checked every minute and sent to `ALERT_EMAIL` and/or `ALERT_WEBHOOK_URL` (a Discord or Slack incoming webhook), once, then every six hours while they last. **Admin console → Operations** lists them, with **Run checks now**.

| Alert | Means | Do |
|---|---|---|
| Server errors | 20+ failed requests in 5 minutes | `dc logs --since 15m play`; roll back with `deploy.sh <previous tag>` if a release caused it |
| Stalling | event-loop delay p99 over 250 ms | usually CPU starvation (check the Linode graphs) or a slow query |
| Database not answering | the service cannot reach Postgres | `dc ps`, `dc logs db`; disk full is the usual cause |
| Backups late / failed / off-site failed | no successful backup in 13 hours | `dc logs backup`; for off-site, check the Object Storage key and bucket |
| Disk over 85% | the host disk is filling | `docker image prune -a --filter until=720h`, `docker builder prune`, old local backups |
| Crash back / crash spike | a resolved crash reappeared, or a new crash reached 25 reports in a day | Admin console → Crashes & bugs |
| Checkout without tax | Stripe Tax is not active | Stripe → Tax: activate it and add registrations |
| TURN relay not working | the service's own allocation probe failed (no answer, or credentials refused) | online matches cannot connect. `dc logs turn` is empty by design: `dc restart turn`; check the firewall (3478 udp/tcp, 5349 tcp, 49160–49400 udp) and that `TURN_SECRET` is the same in both services. `/metrics` has `ozy_turn_up` |
| Disputed results | 10+ disputed match results today | Admin console → Matches → Disputed; many at once suggests a circulating cheat or a desync bug |

Container logs rotate (5 × 10 MB each), so they never fill the disk. The play service's logs never contain emails, IPs or tokens.

`/metrics` serves Prometheus metrics to requests carrying `METRICS_TOKEN`, if you later point a scraper (Grafana Cloud agent, Prometheus) at it.

## Backups

Every 6 hours the backup service dumps the database (custom format), checks the dump is readable, encrypts it to your age public key, keeps the newest 8 on the server, copies it to Object Storage, deletes off-site copies older than 90 days, records a heartbeat (the service alerts if it stops) and pings `BACKUP_PING_URL`. Linode's own Backups add-on snapshots the whole disk underneath.

**Test a restore every month.** A backup nobody has restored is a hope, not a backup. From your own computer (the private key travels over SSH on stdin and never touches the server's disk):

```
ssh deploy@<server> 'cd ~/ozymandosis && docker compose -f deploy/docker-compose.yml exec -T -e AGE_KEY=- backup \
  restore.sh --check /backups/<newest>.dump.age' < ozymandosis-backup.key
```

It restores into a scratch database, counts rows, and drops it.

**Restore for real** (after data loss): stop the play service (`dc stop play`), run the same command with `-e CONFIRM=RESTORE` and `--replace` instead of `--check`, then `dc start play`.

From Object Storage: `dc exec backup rclone copy linode:ozymandosis-backups/db/<file> /backups/` first.

**A new machine** from nothing: DEPLOY.md steps 1–5 with the same `deploy/.env` (from your password manager), restore the newest backup as above, then move DNS.

## Keys

| Key | Rotate | How |
|---|---|---|
| Match ticket signing key | yearly, or if the server may be compromised | `cli keys:rotate`. The new key signs within five minutes; the old one keeps verifying tickets already issued for a day. |
| `SECRET_KEY` (encrypts two-factor secrets and signing keys, keys log pseudonyms) | if it may have leaked | 1. put the old value in `SECRET_KEY_PREVIOUS` and a new `openssl rand -base64 32` in `SECRET_KEY`; 2. `deploy.sh`; 3. `cli secrets:rewrap` (it says when nothing is left); 4. remove `SECRET_KEY_PREVIOUS` and deploy again. |
| `TURN_SECRET` | if it may have leaked | change it in `.env`, `dc up -d turn play`. Players mid-match keep their relay until it expires (12 h). |
| `POSTGRES_PASSWORD` | if it may have leaked | `dc exec db psql -U ozy -c "alter user ozy password '…'"`, update `.env`, `dc up -d play backup`. |
| Stripe keys, webhook secret | if they may have leaked | roll them in the Stripe dashboard, update `.env`, deploy. |
| Backup age key | if the private key may have leaked | new `age-keygen`, new `BACKUP_AGE_RECIPIENT`; old backups stay readable with the old key until they expire. |

After any leak: `cli` has no "log everyone out", but the admin console can revoke a player's sessions, and rotating `SECRET_KEY` does not invalidate sessions (they are hashed tokens, not signed ones). To end every session: `dc exec db psql -U ozy -c "delete from sessions"`.

## TURN certificates

coturn uses Caddy's certificate for `turn.<domain>`. `deploy/turn.sh` watches it hourly and reloads coturn (SIGUSR2) when Caddy renews it, so nothing expires silently. `dc logs turn | grep turn:` shows each reload.

## Incidents

1. **Say so.** Admin console → Announcements (pushes to every running client); for longer work, Live config → Maintenance (online play pauses; matches already running continue peer to peer).
2. **Stop the bleeding.** Roll back (`deploy.sh <previous tag>`), or turn off the feature in Live config.
3. **Keep evidence.** `dc logs --since 2h play > incident.log` before restarting anything.
4. **Personal data?** If a breach may expose personal data, the privacy policy's contact and your counsel decide notification (GDPR: 72 hours to the supervisory authority).
5. **Write it down.** What happened, why, what changes. Add an alert or test so it cannot happen quietly again.

## Privacy housekeeping

The service deletes expired sessions and tokens, old reports and screenshots, and unconfirmed sign-ups on its own (the periods are in the privacy page and `apps/play/src/lib/retention.ts`; change both together). Data export and account deletion are self-service in the account portal.
