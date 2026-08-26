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
#   3. It prunes by COUNT (keep the newest RETENTION_COUNT dumps, default 1),
#      and only after this run's dump has been verified — so the previous dump
#      is deleted only once its replacement provably restores, and pruning can
#      never leave zero backups. Age-based retention was abandoned after it
#      filled the disk twice: N days of ~29GB dumps is a promise a 116GB disk
#      cannot keep, and separately, unconditional pruning once aged out every
#      good backup behind two weeks of 0-byte ones.
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

# ── Prune: keep only the newest RETENTION_COUNT dumps ────────────────────────
# Count-based, not age-based, on purpose: a dump of the pre-drain database is
# ~29GB, so "N days of dumps" is a promise the disk cannot keep — age-based
# retention is exactly how the nightly cron filled the disk to 100% twice.
# Keeping a fixed COUNT makes the cycle sustainable at any dump size: write
# the new dump, verify it restores (pg_restore -l above), and only then delete
# its predecessor. We only reach this line after THIS run's dump is verified
# and published, so the newest backup is always a known-good one and pruning
# can never leave zero backups behind.
#
# Ad-hoc `manual_*.dump` files are deliberately left alone — someone made
# those by hand for a reason; clean them up by hand.
RETENTION_COUNT="${RETENTION_COUNT:-1}"
PRUNED=0
while IFS= read -r old_dump; do
  rm -f -- "$old_dump"
  PRUNED=$((PRUNED + 1))
done < <(ls -1t "$BACKUP_DIR"/postgres_*.dump 2>/dev/null | tail -n +$((RETENTION_COUNT + 1)))
echo "[backup] Pruned ${PRUNED} older dump(s); keeping the newest ${RETENTION_COUNT}"
echo "[backup] Done"
