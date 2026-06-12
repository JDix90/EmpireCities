#!/usr/bin/env bash
# Documentation drift checker — verifies the load-bearing claims in the
# "current" docs against the code they describe. Run from the repo root:
#   bash scripts/check-docs.sh
# Exits non-zero on any failure. See docs/README.md → "Keeping docs accurate".
set -uo pipefail

fail=0
note() { printf '%s\n' "$*"; }
err()  { printf 'FAIL: %s\n' "$*"; fail=1; }

# 1. Retired phrasing sweep: the pre-Redis-migration state model must not be
#    described as current anywhere (ARCHITECTURE.md's "what changed" callout
#    deliberately quotes it once, so it is excluded).
stale=$(grep -rniE "in-memory game state|in memory with Postgres|held in memory" \
  README.md DEPLOYMENT.md AGENTS.md docs/*.md 2>/dev/null \
  | grep -v 'docs/ARCHITECTURE.md' || true)
if [ -n "$stale" ]; then
  err "retired 'in-memory game state' phrasing found:"
  printf '%s\n' "$stale"
else
  note "ok: no retired state-model phrasing outside the ARCHITECTURE callout"
fi

# 2. Backend env vars documented in CONFIGURATION.md exist in code.
missing_env=0
for var in $(grep -ohE '`[A-Z][A-Z0-9_]{3,}`' docs/CONFIGURATION.md | tr -d '`' | sort -u); do
  case "$var" in
    NODE_ENV|VITE_*) continue ;; # NODE_ENV is implicit; VITE_ checked below
  esac
  if ! grep -rq "process\.env\.$var" backend/src 2>/dev/null; then
    # Allow names that are flag keys or compose-only (documented as such)
    case "$var" in
      POSTGRES_*|REDIS_*|JWT_*|SMTP_*) err "documented env var not found in backend/src: $var"; missing_env=1 ;;
      *) : ;; # tolerated: tables also name flags/ports that aren't env reads
    esac
  fi
done
[ "$missing_env" -eq 0 ] && note "ok: core documented env vars exist in backend/src"

# 3. Frontend VITE_ vars documented vs used.
for var in $(grep -rohE '\bVITE_[A-Z0-9_]+' frontend/src | sort -u); do
  if ! grep -q "$var" docs/CONFIGURATION.md; then
    err "VITE var used in code but missing from docs/CONFIGURATION.md: $var"
  fi
done
note "ok: frontend VITE_ var check complete"

# 4. Migration count claim in ARCHITECTURE.md matches reality.
actual=$(ls database/migrations | grep -c '\.sql$')
if ! grep -q "$actual migrations" docs/ARCHITECTURE.md; then
  err "docs/ARCHITECTURE.md migration count != actual ($actual .sql files)"
else
  note "ok: migration count matches ($actual)"
fi

# 5. Relative markdown links in the maintained docs resolve.
for doc in docs/README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/INTEGRATIONS.md; do
  dir=$(dirname "$doc")
  while IFS= read -r link; do
    target="${link%%#*}"
    [ -z "$target" ] && continue
    if [ ! -e "$dir/$target" ]; then
      err "$doc links to missing file: $target"
    fi
  done < <(grep -oE '\]\(([^)#]+\.md[^)]*)\)' "$doc" | sed -E 's/\]\(//; s/\)$//' | grep -v '^http')
done
note "ok: link check complete"

if [ "$fail" -ne 0 ]; then
  echo "check-docs: FAILED — fix the doc (or the code claim) in the same PR."
  exit 1
fi
echo "check-docs: all checks passed."
