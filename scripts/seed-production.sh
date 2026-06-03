#!/usr/bin/env bash
# First-time production seed: achievements/cosmetics (Postgres) + era/community maps (Postgres JSONB).
# Safe to re-run — seed scripts upsert without wiping play counts.
#
# Usage (from repo root):
#   ./scripts/seed-production.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="docker/docker-compose.prod.yml"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

echo "[seed] Postgres achievements + cosmetics..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T backend \
  sh -c "cd /app/backend && node dist/db/postgres/seed.js"

echo "[seed] PostgreSQL era + community maps..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T backend \
  sh -c "cd /app/backend && pnpm run seed:maps"

echo "[seed] Done."
