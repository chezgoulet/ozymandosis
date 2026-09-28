#!/bin/sh
# Restore (or just test) an encrypted backup, inside the backup container. The age
# private key comes on stdin (AGE_KEY=-) so it never touches the server's disk or
# its process list; run this from your own computer:
#   ssh deploy@server 'cd ~/ozymandosis && docker compose -f deploy/docker-compose.yml exec -T -e AGE_KEY=- backup \
#       restore.sh --check /backups/ozy-....dump.age' < ozymandosis-backup.key
# --check restores into a scratch database, counts rows in the main tables, and drops it:
# run it monthly, a backup nobody has restored is only a hope.
# --replace restores over the live database (stop the play service first; it asks to confirm).
set -eu
mode="${1:-}"; file="${2:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "usage: restore.sh --check|--replace <file.dump.age>"; exit 2; }
: "${AGE_KEY:?pass the age private key on stdin with AGE_KEY=- (or in AGE_KEY)}"
if [ "$AGE_KEY" = "-" ]; then AGE_KEY="$(cat)"; fi
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-ozy}"
dump="$(mktemp)"; trap 'rm -f "$dump"' EXIT
printf '%s\n' "$AGE_KEY" | age -d -i - -o "$dump" "$file"
case "$mode" in
  --check)
    db="ozy_restore_check"
    psql -d postgres -qc "drop database if exists $db" -c "create database $db"
    pg_restore -d "$db" --no-owner "$dump"
    psql -d "$db" -tAc "select 'users ' || count(*) from users union all select 'matches ' || count(*) from matches union all select 'migrations ' || count(*) from schema_migrations"
    psql -d postgres -qc "drop database $db"
    echo "restore check passed: $file";;
  --replace)
    # stdin carries the key, so the confirmation is an explicit variable
    [ "${CONFIRM:-}" = RESTORE ] || { echo "This replaces the live database with $file. Run again with -e CONFIRM=RESTORE to go ahead."; exit 1; }
    pg_restore -d "${PGDATABASE:-ozy}" --clean --if-exists --no-owner "$dump"
    echo "restored $file";;
  *) echo "usage: restore.sh --check|--replace <file.dump.age>"; exit 2;;
esac
