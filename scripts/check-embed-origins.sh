#!/usr/bin/env bash
# Prove the EMBED_ORIGINS the backend will actually run matches the portal
# registry (docker/portals.json).
#
# This exists because the registry only guarantees that things IN THE REPO
# agree with each other: nginx's frame-ancestors, the generated client policy
# and the documented sample value all come from one source and a CI drift test
# keeps them in step. It guarantees nothing about the value on the server,
# which is set by hand, and that is exactly where the drift happened.
#
# On 2026-09-20 the Newgrounds launch deployed and looked entirely successful:
# containers up, site serving, correct CSP carrying all 28 origins, a new
# bundle hash proving the image rebuilt. The frame would have rendered on
# Newgrounds and the game would have played. But .env.production still held a
# hand-maintained value from before the registry existed, so the backend did
# not recognise uploads.ungrounded.net, the refresh cookie stayed SameSite=Lax,
# and the browser withheld it inside the portal iframe. Every reload would have
# minted a brand-new guest account. Nothing errored anywhere. The only symptom
# was a guest username quietly changing, and it took cookie probes against
# production to find it.
#
# That is the worst shape of bug this stack can produce, and it is cheap to
# catch: compare two sets of strings before anything is swapped.
#
# WHERE THE EXPECTED VALUE COMES FROM: the `# EMBED_ORIGINS=` line in
# .env.production.example. That line is written by backend/scripts/syncPortals.ts
# from the registry, and backend/src/config/portalRegistry.test.ts fails CI if
# it drifts — so it is a trustworthy stand-in for the registry, and reading it
# needs nothing but grep. The droplet has no node_modules, so running the
# generator there is not an option.
#
# Usage:
#   check-embed-origins.sh --from-file .env.production
#   check-embed-origins.sh --value "$(... exec -T backend printenv EMBED_ORIGINS)" \
#                          --label "running backend"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
SAMPLE="${REPO_ROOT}/.env.production.example"

MODE=""; SRC=""; LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-file) MODE="file";  SRC="${2:-}"; shift 2 ;;
    --value)     MODE="value"; SRC="${2:-}"; shift 2 ;;
    --label)     LABEL="${2:-}"; shift 2 ;;
    *) echo "check-embed-origins: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "check-embed-origins: need --from-file or --value" >&2; exit 2; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# One origin per line, trimmed, blanks dropped, de-duplicated. Never unquoted:
# the value contains `*` and the shell would glob it against the filesystem.
# `|| true` is load-bearing: grep exits 1 when it selects nothing, which under
# `set -euo pipefail` would kill the script instead of yielding an empty list —
# and an empty list is a case this check has to report on, not die on.
split_origins() { tr ',' '\n' <<<"${1:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort -u || true; }

if ! grep -q '^# EMBED_ORIGINS=' "$SAMPLE" 2>/dev/null; then
  echo "check-embed-origins: cannot read the generated sample line from $SAMPLE." >&2
  echo "  Run: pnpm -C backend exec tsx scripts/syncPortals.ts" >&2
  exit 2
fi
EXPECTED="$(grep '^# EMBED_ORIGINS=' "$SAMPLE" | tail -1 | sed 's/^# EMBED_ORIGINS=//')"

if [ "$MODE" = "file" ]; then
  LABEL="${LABEL:-$SRC}"
  [ -f "$SRC" ] || { echo "check-embed-origins: no such env file: $SRC" >&2; exit 2; }
  # docker compose --env-file lets a later definition win, so read the LAST one.
  # A forgotten duplicate silently overriding an edit is a real failure mode.
  COUNT="$(grep -c '^[[:space:]]*EMBED_ORIGINS=' "$SRC" || true)"
  if [ "$COUNT" -gt 1 ]; then
    echo "check-embed-origins: WARNING — $SRC has $COUNT EMBED_ORIGINS lines."
    echo "  The last one wins, so an earlier edit is being silently overridden."
  fi
  # `|| true` again: no EMBED_ORIGINS line at all is a state to report, not die on.
  ACTUAL="$(grep '^[[:space:]]*EMBED_ORIGINS=' "$SRC" | tail -1 | sed 's/^[[:space:]]*EMBED_ORIGINS=//' | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/' || true)"
else
  LABEL="${LABEL:-supplied value}"
  ACTUAL="$SRC"
fi

split_origins "$EXPECTED" > "$WORK/expected"
split_origins "$ACTUAL"   > "$WORK/actual"

# Empty is a legitimate state: it turns portal embedding OFF entirely. Loud,
# but not a failure, or a deliberate "portals off" deploy could never ship.
if [ ! -s "$WORK/actual" ]; then
  echo "check-embed-origins: WARNING — EMBED_ORIGINS is empty or unset ($LABEL)."
  echo "  Portal embedding is OFF: every portal frame will fall back, and any"
  echo "  session inside one dies on reload. Intentional? Then ignore this."
  exit 0
fi

MISSING="$(comm -13 "$WORK/actual" "$WORK/expected")"
EXTRA="$(comm -23 "$WORK/actual" "$WORK/expected")"

if [ -n "$EXTRA" ]; then
  echo "check-embed-origins: note — $LABEL carries origins the registry does not:"
  sed 's/^/    + /' <<<"$EXTRA"
  echo "  Harmless, but they are unmanaged. Put them in docker/portals.json if"
  echo "  they are real, or drop them."
fi

if [ -n "$MISSING" ]; then
  echo "check-embed-origins: FAILED — $LABEL is missing origins the registry requires:" >&2
  sed 's/^/    - /' <<<"$MISSING" >&2
  echo >&2
  echo "  These portals would FAIL SILENTLY: nginx lets the frame render and the" >&2
  echo "  game plays, but the refresh cookie stays SameSite=Lax, so the browser" >&2
  echo "  withholds it inside the iframe and every reload mints a new guest." >&2
  echo "  Nothing errors. See docs/PORTALS.md." >&2
  echo >&2
  echo "  The value to set (printed by scripts/syncPortals.ts):" >&2
  echo >&2
  echo "EMBED_ORIGINS=${EXPECTED}" >&2
  exit 1
fi

echo "check-embed-origins: ok — $LABEL matches the registry ($(wc -l < "$WORK/expected" | tr -d ' ') origins)"
