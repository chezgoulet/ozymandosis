#!/bin/sh
# Daily pg_dump of the play database; keeps the newest 14.
set -eu
while true; do
  f="/backups/ozy-$(date -u +%Y%m%d-%H%M).sql.gz"
  if pg_dump -h db -U ozy ozy | gzip > "$f.tmp"; then mv "$f.tmp" "$f"; echo "backup $f"; else rm -f "$f.tmp"; echo "backup failed"; fi
  ls -1t /backups/ozy-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
  sleep 86400
done
