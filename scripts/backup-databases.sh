#!/usr/bin/env bash
# PostgreSQL backup script — run as daily cron on the production VPS.
#
# Usage:
#   ./scripts/backup-databases.sh
#   BACKUP_DIR=/var/backups/borderfall ./scripts/backup-databases.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${REPO_ROOT}/.env.production" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env.production"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/borderfall}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-14}"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-borderfall_postgres_prod}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting at $TIMESTAMP"
echo "[backup] Postgres container: ${POSTGRES_CONTAINER}"

docker exec "${POSTGRES_CONTAINER}" pg_dump \
  -U "${POSTGRES_USER:-chronouser}" \
  -d "${POSTGRES_DB:-borderfall}" \
  --format=custom \
  > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
echo "[backup] Postgres dump complete ($(du -h "$BACKUP_DIR/postgres_${TIMESTAMP}.dump" | cut -f1))"

find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Pruned backups older than ${RETENTION_DAYS} days"
echo "[backup] Done"
