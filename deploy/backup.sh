#!/bin/sh
# Encrypted, verified, off-site backups of the play database.
#   backup.sh          run forever: a backup every BACKUP_INTERVAL_S (6 h)
#   backup.sh once     one backup now (deploy.sh runs this before every deploy)
# Each run: pg_dump -Fc → pg_restore --list (the dump is readable) → age-encrypt
# to BACKUP_AGE_RECIPIENT → keep the newest BACKUP_KEEP_LOCAL here → copy to
# BACKUP_REMOTE (rclone) and delete remote copies older than BACKUP_REMOTE_DAYS →
# record a heartbeat in the database (the service alerts when backups stop) and
# ping BACKUP_PING_URL (an external dead man's switch, e.g. healthchecks.io).
set -eu
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to your age public key (age1...)}"
INTERVAL="${BACKUP_INTERVAL_S:-21600}"; KEEP="${BACKUP_KEEP_LOCAL:-8}"; DAYS="${BACKUP_REMOTE_DAYS:-90}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-ozy}" PGDATABASE="${PGDATABASE:-ozy}"

heartbeat() { # ok detail-json
  psql -qtAc "insert into ops_heartbeats (name, at, ok, detail) values ('backup', now(), $1, '$2'::jsonb)
    on conflict (name) do update set at = excluded.at, ok = excluded.ok, detail = excluded.detail" >/dev/null 2>&1 || echo "backup: could not record heartbeat"
}
ping() { [ -n "${BACKUP_PING_URL:-}" ] && wget -qO- -T 20 "$BACKUP_PING_URL$1" >/dev/null 2>&1 || true; }

run() {
  ts="$(date -u +%Y%m%d-%H%M%S)"; out="/backups/ozy-$ts.dump.age"; tmp="$(mktemp)"
  trap 'rm -f "$tmp" "$out.part"' EXIT
  if ! pg_dump -Fc -Z 6 -f "$tmp"; then echo "backup: pg_dump failed"; heartbeat false '{"step":"dump"}'; ping /fail; return 1; fi
  if ! pg_restore --list "$tmp" >/dev/null; then echo "backup: dump unreadable"; heartbeat false '{"step":"verify"}'; ping /fail; return 1; fi
  age -r "$BACKUP_AGE_RECIPIENT" -o "$out.part" "$tmp" && mv "$out.part" "$out"
  bytes="$(wc -c < "$out" | tr -d ' ')"
  remote=null
  if [ -n "${BACKUP_REMOTE:-}" ]; then
    if rclone copyto --s3-no-check-bucket "$out" "$BACKUP_REMOTE/$(basename "$out")"; then
      remote=true
      rclone delete --min-age "${DAYS}d" --include 'ozy-*.dump.age' "$BACKUP_REMOTE" || true
    else remote=false; echo "backup: off-site copy failed"; fi
  fi
  ls -1t /backups/ozy-*.dump.age 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  ls -1t /backups/ozy-*.sql.gz 2>/dev/null | xargs -r rm -f # plaintext dumps from older versions
  disk="$(df -P /backups | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
  ok=true; [ "$remote" = false ] && ok=false
  heartbeat "$ok" "{\"file\":\"$(basename "$out")\",\"bytes\":$bytes,\"remote\":$remote,\"disk\":${disk:-null}}"
  if [ "$ok" = true ]; then ping ""; else ping /fail; fi
  echo "backup: $(basename "$out") ($bytes bytes, off-site: $remote, disk ${disk}%)"
  rm -f "$tmp"; trap - EXIT
}

if [ "${1:-}" = once ]; then run; exit $?; fi
until pg_isready -q; do sleep 2; done
while true; do run || true; sleep "$INTERVAL"; done
