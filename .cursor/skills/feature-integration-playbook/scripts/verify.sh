#!/usr/bin/env bash
# Feature Integration Playbook — Phase 5 one-shot verifier.
#
# Runs the minimum set of gates that must pass before a feature is considered
# verified: backend typecheck, frontend typecheck, lint, backend tests.
# Aborts on the first failure and prints a clear summary.
#
# Usage (from repo root):
#   bash .cursor/skills/feature-integration-playbook/scripts/verify.sh
#
# Exit codes:
#   0 = all gates passed
#   1 = a gate failed (see stderr for details and step number)
#   2 = environment problem (wrong cwd, missing pnpm, etc.)

set -u

# Locate repo root relative to this script, so it works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

if [ ! -f "${REPO_ROOT}/package.json" ]; then
  echo "[verify] ERROR: could not locate repo root from ${SCRIPT_DIR}" >&2
  exit 2
fi

cd "${REPO_ROOT}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[verify] ERROR: pnpm not found on PATH" >&2
  exit 2
fi

# Color helpers (degrade gracefully if not a TTY).
if [ -t 1 ]; then
  C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YELLOW='\033[0;33m'; C_RESET='\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_RESET=''
fi

step() {
  local n="$1"; local label="$2"
  printf "\n${C_YELLOW}[verify %s/4]${C_RESET} %s\n" "${n}" "${label}"
}

run_step() {
  local n="$1"; local label="$2"; shift 2
  step "${n}" "${label}"
  if ! "$@"; then
    printf "\n${C_RED}[verify] FAILED at step %s: %s${C_RESET}\n" "${n}" "${label}" >&2
    printf "${C_RED}[verify] aborting remaining checks.${C_RESET}\n" >&2
    exit 1
  fi
}

STARTED_AT=$(date +%s)

run_step 1 "backend typecheck (tsc --noEmit)" \
  pnpm -C backend exec tsc --noEmit

run_step 2 "frontend typecheck (tsc --noEmit)" \
  pnpm -C frontend exec tsc --noEmit

run_step 3 "lint (pnpm run lint)" \
  pnpm run lint

run_step 4 "backend tests (pnpm run test:backend)" \
  pnpm run test:backend

ELAPSED=$(( $(date +%s) - STARTED_AT ))
printf "\n${C_GREEN}[verify] ALL GATES PASSED in %ss.${C_RESET}\n" "${ELAPSED}"
echo "[verify] Next: run the tiered browser smoke test (T1/T2/T3) per SKILL.md Phase 5."
