#!/usr/bin/env bash
# Prove a backup restores. Fetch the newest dump, restore it into a throwaway
# Postgres container with no network, and compare its row counts with the live
# database. The live database is only ever read (row counts), never written.
#
# Usage, on the droplet from the repo folder:
#   ./scripts/backup-restore-check.sh          # the newest off-site copy (Spaces)
#   ./scripts/backup-restore-check.sh --local  # the newest dump on this droplet
#
# A backup that has never been restored is a hope, not a backup: the dumps
# are verified with `pg_restore -l` when they are made, which proves the file
# is readable, not that the database comes back. This proves the second.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${REPO_ROOT}/.env.production" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env.production"
  set +a
fi
# shellcheck source=scripts/backup-s3-lib.sh
source "${SCRIPT_DIR}/backup-s3-lib.sh"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/borderfall}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-borderfall_postgres_prod}"
PG_USER="${POSTGRES_USER:-chronouser}"
PG_DB="${POSTGRES_DB:-borderfall}"
CHECK_CONTAINER="${RESTORE_CHECK_CONTAINER:-borderfall_restore_check}"
CHECK_IMAGE="${RESTORE_CHECK_IMAGE:-postgres:16-alpine}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"
# Tables whose counts are compared; a missing table reads n/a on that side.
TABLES=(users games game_states maps analytics_events)

SOURCE="offsite"
case "${1:-}" in
  "") ;;
  --local) SOURCE="local" ;;
  *) echo "Usage: $0 [--local]" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR"
WORK_DIR="$(mktemp -d "${BACKUP_DIR}/restore-check.XXXXXX")"
cleanup() {
  docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ── Which dump ───────────────────────────────────────────────────────────────
if [ "$SOURCE" = "local" ]; then
  DUMP="$(ls -1t "$BACKUP_DIR"/postgres_*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$DUMP" ]; then
    echo "[restore-check] FATAL: no postgres_*.dump in ${BACKUP_DIR}" >&2
    exit 1
  fi
else
  s3_require_settings
  NEWEST="$(s3_list_dumps "$BACKUP_DIR" | tail -1)"
  if [ -z "$NEWEST" ]; then
    echo "[restore-check] FATAL: no dumps under s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/" >&2
    exit 1
  fi
  echo "[restore-check] Downloading s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/${NEWEST}"
  aws_cli "$BACKUP_DIR" s3 cp "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/${NEWEST}" \
    "/backups/$(basename "$WORK_DIR")/${NEWEST}" --only-show-errors
  DUMP="${WORK_DIR}/${NEWEST}"
fi
echo "[restore-check] Dump: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1), ${SOURCE})"

# ── Room for a second copy of the database? ──────────────────────────────────
live_count() {
  docker exec "$POSTGRES_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null || echo "n/a"
}
DB_BYTES="$(live_count "SELECT pg_database_size('${PG_DB}')")"
[[ "$DB_BYTES" =~ ^[0-9]+$ ]] || DB_BYTES=0
DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
AVAIL_MB=$(df -Pm "$DOCKER_ROOT" | awk 'NR==2 {print $4}')
NEED_MB=$(( DB_BYTES / 1024 / 1024 + MIN_FREE_MB ))
if [ "$AVAIL_MB" -lt "$NEED_MB" ]; then
  echo "[restore-check] FATAL: ${AVAIL_MB}MB free under ${DOCKER_ROOT}, need ~${NEED_MB}MB for the restored copy." >&2
  exit 1
fi

# ── Restore into a throwaway Postgres ────────────────────────────────────────
docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$CHECK_CONTAINER" --network none \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_DB="$PG_DB" -e POSTGRES_PASSWORD=restore-check \
  "$CHECK_IMAGE" >/dev/null

# The image starts a temporary server to initialise, then restarts for real;
# wait for initialisation to finish before trusting pg_isready.
for _ in $(seq 1 60); do
  if docker logs "$CHECK_CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete" \
    && docker exec "$CHECK_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$CHECK_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  echo "[restore-check] FATAL: the throwaway Postgres did not start within 60s." >&2
  exit 1
fi

echo "[restore-check] Restoring into ${CHECK_CONTAINER} (no network)..."
if ! docker exec -i "$CHECK_CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB" \
  --no-owner --no-privileges --exit-on-error < "$DUMP"; then
  echo "[restore-check] FAIL: pg_restore could not restore $(basename "$DUMP")." >&2
  exit 1
fi

restored_count() {
  docker exec "$CHECK_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null || echo "n/a"
}
TABLE_COUNT="$(restored_count "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
echo "[restore-check] Restored ${TABLE_COUNT} tables. Row counts, restored and live (live may have moved on since the dump):"
printf '[restore-check]   %-18s %12s %12s\n' "table" "restored" "live"
for t in "${TABLES[@]}"; do
  printf '[restore-check]   %-18s %12s %12s\n' "$t" \
    "$(restored_count "SELECT count(*) FROM ${t}")" "$(live_count "SELECT count(*) FROM ${t}")"
done

if ! [[ "$TABLE_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "[restore-check] FAIL: the restore produced no tables." >&2
  exit 1
fi
echo "[restore-check] PASS: $(basename "$DUMP") restores."
