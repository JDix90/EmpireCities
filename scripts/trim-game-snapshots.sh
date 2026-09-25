#!/usr/bin/env bash
# One-off cleanup of replay snapshots (game_states) on the production database.
#
# Until the server kept one snapshot per turn, every debounced save inserted a
# full copy of the game state — 4–5 per turn, each carrying the whole
# win-probability history — and finished games kept them for 30 days. That grew
# game_states to 58GB, 99% of the database, and the nightly backup stopped
# fitting on the disk. The server now keeps one snapshot per turn, plus each
# game's opening board, for 7 days after a game ends. This script brings the
# rows already written into line with that, then optionally hands the space
# back to the disk.
#
# Usage (on the VPS, from the repository root, after deploying that change):
#   ./scripts/trim-game-snapshots.sh                    # dry run: sizes and what would go
#   ./scripts/trim-game-snapshots.sh --apply            # delete, in small batches
#   ./scripts/trim-game-snapshots.sh --apply --vacuum   # then VACUUM FULL game_states
#
# It deletes only rows the updated server would also drop: every snapshot of a
# game that ended more than RETENTION_DAYS ago, and all but the newest snapshot
# of each turn (a game's first snapshot is always kept). It never touches
# another table. Safe to stop with Ctrl-C and to re-run.
#
# Deleting rows does not shrink the files on disk; Postgres keeps the space
# for new rows. --vacuum rewrites the table to return it, which LOCKS
# game_states until it finishes: snapshot saves and replay loads wait, and the
# server's may time out. Live games carry on (their state is in Redis). Run it
# at a quiet time; it refuses to start without room for the rewritten table.
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-borderfall_postgres_prod}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BATCH="${BATCH:-1000}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/borderfall}"
# --apply wants a backup at least this recent (hours).
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-24}"

APPLY=false
VACUUM=false
SKIP_BACKUP_CHECK=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --vacuum) VACUUM=true ;;
    --skip-backup-check) SKIP_BACKUP_CHECK=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "RETENTION_DAYS must be a whole number of days" >&2; exit 1 ;; esac
case "$BATCH" in ''|*[!0-9]*) echo "BATCH must be a whole number of rows" >&2; exit 1 ;; esac

# SQL on stdin, one statement per line; prints unaligned, tuples-only output.
psql_run() {
  docker exec -i "$CONTAINER" sh -c \
    'psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

if ! docker exec "$CONTAINER" sh -c 'pg_isready -q -U "$POSTGRES_USER"'; then
  echo "[trim] $CONTAINER is not accepting connections." >&2
  exit 1
fi

# The two kinds of row this removes. Kept in step with deleteExpiredGameStateSnapshots
# and SAVE_TURN_SNAPSHOT_SQL in the backend.
EXPIRED="g.status IN ('completed', 'abandoned')
  AND COALESCE(g.ended_at, g.created_at) < NOW() - make_interval(days => ${RETENTION_DAYS})"
RANKED="SELECT gs.ctid, gs.state_json, (${EXPIRED}) AS expired,
    row_number() OVER (PARTITION BY gs.game_id, gs.turn_number ORDER BY gs.saved_at DESC, gs.id DESC) AS newest_in_turn,
    row_number() OVER (PARTITION BY gs.game_id ORDER BY gs.saved_at ASC, gs.id ASC) AS oldest_in_game
  FROM game_states gs JOIN games g ON g.game_id = gs.game_id"

report() {
  psql_run <<SQL
SELECT 'on disk', pg_size_pretty(pg_total_relation_size('game_states')), '';
SELECT 'snapshots', count(*)::text, pg_size_pretty(coalesce(sum(pg_column_size(state_json)), 0)) FROM game_states;
WITH r AS (${RANKED})
SELECT 'expired (games ended over ${RETENTION_DAYS} days ago)', count(*)::text,
       pg_size_pretty(coalesce(sum(pg_column_size(state_json)), 0)) FROM r WHERE expired
UNION ALL
SELECT 'extra snapshots within a turn', count(*)::text,
       pg_size_pretty(coalesce(sum(pg_column_size(state_json)), 0)) FROM r
 WHERE NOT expired AND newest_in_turn > 1 AND oldest_in_game > 1
UNION ALL
SELECT 'kept', count(*)::text,
       pg_size_pretty(coalesce(sum(pg_column_size(state_json)), 0)) FROM r
 WHERE NOT expired AND (newest_in_turn = 1 OR oldest_in_game = 1);
SQL
}

print_report() {
  report | while IFS='|' read -r label rows size; do
    printf '[trim]   %-50s %12s %10s\n' "$label" "$rows" "$size"
  done
}

echo "[trim] game_states (retention ${RETENTION_DAYS} days, one snapshot per turn):"
print_report

if [ "$APPLY" != true ]; then
  if [ "$VACUUM" = true ]; then
    echo "[trim] --vacuum runs only together with --apply." >&2
    exit 1
  fi
  echo "[trim] Dry run: nothing was deleted. Re-run with --apply to delete."
  exit 0
fi

# ── A recent backup first ────────────────────────────────────────────────────
if [ "$SKIP_BACKUP_CHECK" != true ]; then
  newest="$(ls -1t "$BACKUP_DIR"/postgres_*.dump "$BACKUP_DIR"/manual_*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$newest" ]; then
    echo "[trim] ABORTED: no backup in $BACKUP_DIR. Take one first (or pass --skip-backup-check)." >&2
    exit 1
  fi
  age_hours=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
  if [ "$age_hours" -ge "$BACKUP_MAX_AGE_HOURS" ]; then
    echo "[trim] ABORTED: newest backup is ${age_hours}h old ($newest). Take a fresh one first." >&2
    exit 1
  fi
  echo "[trim] Backup: $(basename "$newest") (${age_hours}h old)"
fi

# ── Delete in batches ────────────────────────────────────────────────────────
# Small batches keep each transaction short; the server's own saves and reads
# on game_states keep working between them.
delete_batches() {
  local label="$1" where="$2" total=0 deleted
  while :; do
    deleted="$(psql_run <<SQL
WITH doomed AS (
  SELECT ctid FROM (${RANKED}) r WHERE ${where} LIMIT ${BATCH}
), gone AS (
  DELETE FROM game_states WHERE ctid IN (SELECT ctid FROM doomed) RETURNING 1
)
SELECT count(*) FROM gone;
SQL
)"
    total=$((total + deleted))
    echo "[trim]   ${label}: ${total} deleted"
    [ "$deleted" -lt "$BATCH" ] && break
  done
}

echo "[trim] Deleting snapshots of games that ended over ${RETENTION_DAYS} days ago..."
delete_batches "expired" "expired"
echo "[trim] Deleting extra snapshots within a turn..."
delete_batches "within a turn" "NOT expired AND newest_in_turn > 1 AND oldest_in_game > 1"

echo "[trim] After deleting:"
print_report

if [ "$VACUUM" != true ]; then
  echo "[trim] Done. The freed space is reused for new snapshots; run again with"
  echo "[trim] --apply --vacuum at a quiet time to hand it back to the disk."
  exit 0
fi

# ── VACUUM FULL: give the space back ─────────────────────────────────────────
# The rewrite writes a new copy of the table (and WAL for it) before dropping
# the old one, so it needs roughly twice the live size free, plus a margin.
DATA_DIR="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' "$CONTAINER")"
if [ -z "$DATA_DIR" ]; then
  echo "[trim] ABORTED: could not find the host path of the Postgres data volume." >&2
  exit 1
fi
live_mb="$(psql_run <<'SQL'
SELECT ((coalesce(sum(pg_column_size(state_json)), 0) + pg_indexes_size('game_states')) / 1048576)::bigint FROM game_states;
SQL
)"
free_mb="$(df -Pm "$DATA_DIR" | awk 'NR==2 {print $4}')"
need_mb=$(( live_mb * 2 + 2048 ))
echo "[trim] VACUUM FULL needs ~${need_mb}MB free; ${free_mb}MB free on the Postgres volume."
if [ "$free_mb" -lt "$need_mb" ]; then
  echo "[trim] ABORTED: not enough free disk for the rewrite. Nothing was locked." >&2
  exit 1
fi

before="$(df -h "$DATA_DIR" | awk 'NR==2 {print $3" used, "$4" free"}')"
echo "[trim] Rewriting game_states (locks the table until done)..."
started=$(date +%s)
psql_run <<'SQL'
SET statement_timeout = 0;
VACUUM (FULL, ANALYZE) game_states;
SQL
echo "[trim] VACUUM FULL took $(( $(date +%s) - started ))s"
echo "[trim] Disk before: ${before}"
echo "[trim] Disk after:  $(df -h "$DATA_DIR" | awk 'NR==2 {print $3" used, "$4" free"}')"
print_report
echo "[trim] Done."
