#!/usr/bin/env bash
# Redis migration staging gate — wraps validateRedisStaging.ts with env checks.
#
# Usage:
#   ./scripts/validate-redis-staging.sh
#   ./scripts/validate-redis-staging.sh --manage-backend --phase restart
#   ./scripts/validate-redis-staging.sh --multi-instance
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! curl -sfS "${STAGING_BASE_URL:-http://localhost:3001}/health" >/dev/null 2>&1; then
  echo "Backend not reachable at ${STAGING_BASE_URL:-http://localhost:3001}" >&2
  echo "Start with: pnpm run dev:backend  (or docker prod stack)" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q borderfall_redis; then
  echo "WARN: borderfall_redis container not detected — ensure Redis is running" >&2
fi

exec pnpm -C backend exec tsx scripts/staging/validateRedisStaging.ts "$@"
