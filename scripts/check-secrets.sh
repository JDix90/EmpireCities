#!/usr/bin/env bash
# Committed-credential scanner — fails if a live-looking secret is present in
# any file git tracks. Run from the repo root:
#   bash scripts/check-secrets.sh
# Exits non-zero on any hit. Added after a real Resend API key shipped inside
# .env.production.example and was harvested for phishing; the point is to catch
# the next one before it reaches a push.
#
# Scope: the tracked working tree, not git history. Rewriting history does not
# un-leak a key — revoke and rotate at the provider instead.
set -uo pipefail

fail=0
note() { printf '%s\n' "$*"; }
err()  { printf 'FAIL: %s\n' "$*"; fail=1; }

# This scanner necessarily contains every pattern it looks for, and the lockfile
# is a large blob of integrity hashes that never holds credentials.
list=$(mktemp)
trap 'rm -f "$list"' EXIT
git ls-files -z -- . \
  ':(exclude)scripts/check-secrets.sh' \
  ':(exclude)pnpm-lock.yaml' > "$list"

# ERE only, and no `\b` — BSD grep on macOS does not support it, so word
# boundaries are spelled out as an explicit non-identifier prefix. Without it
# `re_...` matches inside ordinary identifiers like `pre_attack_damage_ready`.
NOT_IDENT='(^|[^A-Za-z0-9_])'

scan() {
  local label="$1" pattern="$2" hits
  hits=$(xargs -0 grep -nIHE "$pattern" < "$list" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    err "$label"
    printf '%s\n' "$hits" | sed 's/^/    /'
  fi
}

scan "Resend API key"          "${NOT_IDENT}re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}"
scan "OpenAI/Anthropic-style key" "${NOT_IDENT}sk-(ant-)?[A-Za-z0-9_-]{20,}"
scan "GitHub token"            "${NOT_IDENT}gh[pousr]_[A-Za-z0-9]{36}"
scan "Slack token"             "${NOT_IDENT}xox[baprs]-[A-Za-z0-9-]{10,}"
scan "AWS access key id"       "${NOT_IDENT}AKIA[0-9A-Z]{16}([^0-9A-Z]|$)"
scan "Google API key"          "${NOT_IDENT}AIza[0-9A-Za-z_-]{35}"
scan "SendGrid API key"        "${NOT_IDENT}SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"
scan "Stripe secret key"       "${NOT_IDENT}[sr]k_(live|test)_[A-Za-z0-9]{20,}"
scan "Twilio account sid"      "${NOT_IDENT}AC[0-9a-f]{32}([^0-9a-f]|$)"
scan "private key block"       '^-+BEGIN [A-Z ]*PRIVATE KEY-+'
scan "Firebase service account key" '"private_key"[[:space:]]*:[[:space:]]*"-+BEGIN'
# A Sentry DSN's public key is not strictly a secret, but a populated one means
# a real project got pasted where a placeholder belongs.
scan "populated Sentry DSN"    'https://[0-9a-f]{32}@[A-Za-z0-9.-]*ingest\.sentry\.io'

# Real env files must never be tracked — only the *.example templates.
tracked_env=$(git ls-files | grep -E '(^|/)\.env(\.|$)' | grep -vE '\.example$' || true)
if [ -n "$tracked_env" ]; then
  err "real env file(s) tracked by git (only .env*.example belongs in the repo):"
  printf '%s\n' "$tracked_env" | sed 's/^/    /'
fi

if [ "$fail" -ne 0 ]; then
  cat <<'EOF'
check-secrets: FAILED.
Remove the credential from the file, then REVOKE AND ROTATE it at the provider —
anything that reached a push must be assumed compromised, and deleting the line
(or rewriting history) does not un-leak it.
EOF
  exit 1
fi
echo "check-secrets: no committed credentials found."
