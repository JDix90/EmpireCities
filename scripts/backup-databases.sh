#!/usr/bin/env bash
# PostgreSQL backup script — run as daily cron on the production VPS.
#
# Usage:
#   ./scripts/backup-databases.sh
#   BACKUP_DIR=/var/backups/borderfall ./scripts/backup-databases.sh
#
# Safety properties (all learned from a real incident in which this script
# silently destroyed every restore point):
#
#   1. It refuses to start without enough free disk. Previously `pg_dump` was
#      redirected straight at a file with no space check, so once the disk hit
#      100% the daily job wrote 0-byte dumps.
#   2. It writes to a .part file and only publishes it after verifying the dump
#      is non-empty AND readable by `pg_restore -l`. A truncated dump never
#      takes a valid backup's place.
#   3. It prunes by age ONLY after a successful run, and never drops the last
#      remaining valid backup. Before, pruning ran unconditionally — so two
#      weeks of 0-byte dumps aged out every good backup that came before them.
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
PG_USER="${POSTGRES_USER:-chronouser}"
PG_DB="${POSTGRES_DB:-borderfall}"

# Headroom required beyond the estimated dump size, so a backup can never be
# the thing that fills the disk (a full disk takes Redis and sshd down with it).
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting at $TIMESTAMP"
echo "[backup] Postgres container: ${POSTGRES_CONTAINER} (db=${PG_DB} user=${PG_USER})"

if ! docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; then
  echo "[backup] FATAL: ${POSTGRES_CONTAINER} is not accepting connections as '${PG_USER}'." >&2
  echo "[backup] Check POSTGRES_USER — note it only takes effect when the data volume is" >&2
  echo "[backup] first initialised, so it can disagree with the roles that actually exist." >&2
  exit 1
fi

# ── Pre-flight: is there room? ───────────────────────────────────────────────
# pg_database_size is the uncompressed on-disk size; a custom-format dump is
# gzip-compressed and normally far smaller, so requiring 1x the database size
# plus MIN_FREE_MB is comfortably conservative.
DB_BYTES=$(docker exec "${POSTGRES_CONTAINER}" \
  psql -U "${PG_USER}" -d "${PG_DB}" -tAc "SELECT pg_database_size('${PG_DB}')" 2>/dev/null || echo 0)
DB_MB=$(( DB_BYTES / 1024 / 1024 ))
AVAIL_MB=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
NEED_MB=$(( DB_MB + MIN_FREE_MB ))

echo "[backup] Database ~${DB_MB}MB; ${AVAIL_MB}MB free in ${BACKUP_DIR}; need ~${NEED_MB}MB"

if [ "$AVAIL_MB" -lt "$NEED_MB" ]; then
  echo "[backup] FATAL: not enough free disk. Free space or lower BACKUP_MIN_FREE_MB." >&2
  echo "[backup] Refusing to run — a partial dump would masquerade as a backup." >&2
  exit 1
fi

# ── Dump to a .part file ─────────────────────────────────────────────────────
TARGET="$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
PARTIAL="${TARGET}.part"
# Any failure from here on leaves no half-written file behind.
trap 'rm -f "$PARTIAL"' EXIT

if ! docker exec "${POSTGRES_CONTAINER}" pg_dump \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  --format=custom \
  > "$PARTIAL"; then
  echo "[backup] FATAL: pg_dump failed; no backup written." >&2
  exit 1
fi

# ── Verify before publishing ─────────────────────────────────────────────────
if [ ! -s "$PARTIAL" ]; then
  echo "[backup] FATAL: dump is empty (0 bytes); discarding." >&2
  exit 1
fi

if ! docker exec -i "${POSTGRES_CONTAINER}" pg_restore -l >/dev/null 2>&1 < "$PARTIAL"; then
  echo "[backup] FATAL: dump is not readable by pg_restore (truncated/corrupt); discarding." >&2
  exit 1
fi

mv "$PARTIAL" "$TARGET"
trap - EXIT
echo "[backup] Verified dump: $(du -h "$TARGET" | cut -f1) -> $TARGET"

# ── Prune, but never the last good backup ────────────────────────────────────
# Only reached after a verified dump exists, so there is always at least one
# valid backup to keep.
PRUNED=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'postgres_*.dump' \
  -mtime +"$RETENTION_DAYS" ! -newer "$TARGET" -print -delete | wc -l)
echo "[backup] Pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days"

REMAINING=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'postgres_*.dump' | wc -l)
echo "[backup] ${REMAINING} backup(s) retained"
echo "[backup] Done"
