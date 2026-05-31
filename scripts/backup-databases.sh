#!/usr/bin/env bash
# Database backup script — run as daily cron on the production VPS.
# Usage: BACKUP_DIR=/var/backups/borderfall ./scripts/backup-databases.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/borderfall}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting at $TIMESTAMP"

# PostgreSQL
docker exec borderfall_postgres pg_dump \
  -U "${POSTGRES_USER:-chronouser}" \
  -d "${POSTGRES_DB:-borderfall}" \
  --format=custom \
  > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
echo "[backup] Postgres dump complete"

# MongoDB
docker exec borderfall_mongo mongodump \
  --username="${MONGO_USER:-chronouser}" \
  --password="${MONGO_PASSWORD:-chronopass}" \
  --authenticationDatabase=admin \
  --db="${MONGO_DB:-borderfall_maps}" \
  --archive \
  > "$BACKUP_DIR/mongo_${TIMESTAMP}.archive"
echo "[backup] MongoDB dump complete"

# Prune old backups
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Pruned backups older than $RETENTION_DAYS days"
echo "[backup] Done"
