#!/usr/bin/env bash
# Deploy a revision to this server, with a backup first and an automatic rollback
# if the new play service does not come up healthy.
#   deploy/deploy.sh               deploy origin/main
#   deploy/deploy.sh v1.2.0        deploy a tag or commit
# Migrations run when the service starts and only move forward, so every
# migration must keep the previous release working (add columns, never drop in
# the same release that stops using them).
set -euo pipefail
cd "$(dirname "$0")/.."
REV="${1:-origin/main}"
DC=(docker compose -f deploy/docker-compose.yml --env-file deploy/.env)

git fetch --tags --quiet origin
NEW="$(git rev-parse --short "$REV^{commit}")"
OLD="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' ozymandosis-play-1 2>/dev/null || true)"
echo "deploying $NEW (running: ${OLD:-none})"

"${DC[@]}" exec -T backup backup.sh once || { echo "pre-deploy backup failed; not deploying"; exit 1; }

git checkout --quiet --detach "$NEW"
IMAGE_TAG="$NEW" "${DC[@]}" build --build-arg REVISION="$NEW" play web
IMAGE_TAG="$NEW" "${DC[@]}" up -d play web

healthy() { for _ in $(seq 1 45); do [ "$(docker inspect -f '{{.State.Health.Status}}' ozymandosis-play-1 2>/dev/null)" = healthy ] && return 0; sleep 2; done; return 1; }
if healthy; then
  echo "$NEW is live"; echo "$NEW" > deploy/.deployed
  docker image prune -f --filter "until=720h" >/dev/null
else
  echo "$NEW did not become healthy: rolling back to ${OLD:-nothing}"
  "${DC[@]}" logs --tail 80 play || true
  if [ -n "$OLD" ]; then git checkout --quiet --detach "$OLD"; IMAGE_TAG="$OLD" "${DC[@]}" up -d play web; fi
  exit 1
fi
