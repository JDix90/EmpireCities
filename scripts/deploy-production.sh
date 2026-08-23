#!/usr/bin/env bash
# Deploy Borderfall production stack (Docker Compose).
# Run from repository root on the VPS after configuring .env.production.
#
# Usage:
#   ./scripts/deploy-production.sh              # build + up
#   ./scripts/deploy-production.sh --no-build   # restart only (no image rebuild)
#   ./scripts/deploy-production.sh --seed       # also seed Postgres + maps (first deploy)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="docker/docker-compose.prod.yml"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Copy from .env.production.example and fill in secrets." >&2
  exit 1
fi

NO_BUILD=false
RUN_SEED=false
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    --seed) RUN_SEED=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "[deploy] Using env file: ${ENV_FILE}"

if [ "${NO_BUILD}" = true ]; then
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d
else
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build
fi

echo "[deploy] Waiting for backend readiness..."
for i in $(seq 1 30); do
  if docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T backend \
    node -e "require('http').get('http://127.0.0.1:3001/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "[deploy] Backend /ready OK"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[deploy] WARN: /ready not OK after 30 attempts — check logs" >&2
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" logs --tail=40 backend
    exit 1
  fi
  sleep 2
done

if [ "${RUN_SEED}" = true ]; then
  echo "[deploy] Seeding Postgres + maps (first-time)..."
  "${SCRIPT_DIR}/seed-production.sh"
fi

# shellcheck disable=SC1091
set -a && source "${ENV_FILE}" && set +a
HTTP_PORT="${HTTP_PORT:-80}"
if [[ -z "${FRONTEND_URL:-}" ]] || [[ "${FRONTEND_URL}" == http://localhost* ]] || [[ "${FRONTEND_URL}" == https://your-domain* ]]; then
  SMOKE_URL="http://127.0.0.1:${HTTP_PORT}"
else
  SMOKE_URL="${FRONTEND_URL%/}"
fi

echo "[deploy] Smoke test: ${SMOKE_URL}/health"
"${SCRIPT_DIR}/smoke-production.sh" "${SMOKE_URL}"

# ── Reclaim build garbage ────────────────────────────────────────────────────
# Every deploy above runs `up -d --build`, which leaves the previous image
# untagged and grows the BuildKit cache. Nothing ever collected either, and on
# one droplet ~12 deploys accumulated 47GB of build cache plus 44GB of dangling
# images — filling the disk completely. A full disk makes Redis reject every
# write (so the API 500s on every request) and stops sshd accepting logins, so
# this is not merely housekeeping.
#
# Runs only after the smoke test passes, so a rollback still has the previous
# image available if the deploy failed. `--filter until=` keeps recent images
# for exactly that reason. Volumes are NEVER pruned — they hold Postgres and
# Redis data.
PRUNE_KEEP_HOURS="${PRUNE_KEEP_HOURS:-168}"
if [ "${SKIP_PRUNE:-false}" = "true" ]; then
  echo "[deploy] SKIP_PRUNE=true — leaving unused images and build cache in place"
else
  echo "[deploy] Pruning images/build cache older than ${PRUNE_KEEP_HOURS}h..."
  docker image prune -af --filter "until=${PRUNE_KEEP_HOURS}h" 2>/dev/null \
    | tail -1 | sed 's/^/[deploy] images: /' || true
  docker builder prune -af --filter "until=${PRUNE_KEEP_HOURS}h" 2>/dev/null \
    | tail -1 | sed 's/^/[deploy] build cache: /' || true
  df -h / | awk 'NR==2 {print "[deploy] disk: "$3" used, "$4" available ("$5" full)"}'
fi

echo "[deploy] Done. Stack is up."
