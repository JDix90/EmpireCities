#!/usr/bin/env bash
# Database backup script — run as daily cron on the production VPS.
# Usage: BACKUP_DIR=/var/backups/erasofempire ./scripts/backup-databases.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/erasofempire}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting at $TIMESTAMP"

# PostgreSQL
docker exec erasofempire_postgres pg_dump \
  -U "${POSTGRES_USER:-chronouser}" \
  -d "${POSTGRES_DB:-erasofempire}" \
  --format=custom \
  > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
echo "[backup] Postgres dump complete"

# MongoDB
docker exec erasofempire_mongo mongodump \
  --username="${MONGO_USER:-chronouser}" \
  --password="${MONGO_PASSWORD:-chronopass}" \
  --authenticationDatabase=admin \
  --db="${MONGO_DB:-erasofempire_maps}" \
  --archive \
  > "$BACKUP_DIR/mongo_${TIMESTAMP}.archive"
echo "[backup] MongoDB dump complete"

# Prune old backups
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Pruned backups older than $RETENTION_DAYS days"
echo "[backup] Done"
