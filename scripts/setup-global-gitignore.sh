#!/usr/bin/env bash
# Install a machine-wide git ignore file so env files and credential material
# cannot be accidentally `git add`-ed in ANY repository on this machine, not
# just this one. Run once per machine (safe to re-run — it is idempotent):
#
#   bash scripts/setup-global-gitignore.sh
#
# It writes a managed block into your global excludes file (default
# ~/.gitignore_global) and points `core.excludesFile` at it. An existing
# excludes file is respected: only the block between the markers is rewritten,
# everything else in the file is left alone.
#
# SCOPE — read this before trusting it:
#   This stops you from committing a file whose NAME looks like a secret store.
#   It does nothing about a secret pasted INSIDE a file that is supposed to be
#   committed — a README, a *.example template, a test fixture, a compose file.
#   That is exactly how this repo leaked a Resend API key (inside
#   .env.production.example, a tracked file). Content scanning is the control
#   for that: `scripts/check-secrets.sh` here, and GitHub push protection.
#
# Override for a legitimately committed match: `git add -f <path>`.
set -euo pipefail

BEGIN_MARK='# >>> managed: secret-safety ignore block >>>'
END_MARK='# <<< managed: secret-safety ignore block <<<'

# Respect an excludes file the user already configured; otherwise pick the
# conventional default.
target=$(git config --global --get core.excludesFile || true)
if [ -z "$target" ]; then
  target="$HOME/.gitignore_global"
fi
# Expand a leading ~ (git stores it literally; the shell will not expand it here).
case "$target" in
  '~/'*) target="$HOME/${target#'~/'}" ;;
esac

mkdir -p "$(dirname "$target")"
[ -f "$target" ] || : > "$target"

# Strip any previous managed block so re-running updates in place rather than
# stacking duplicates.
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
awk -v s="$BEGIN_MARK" -v e="$END_MARK" '
  $0 == s { skip = 1; next }
  $0 == e { skip = 0; next }
  skip != 1 { print }
' "$target" > "$tmp"
cp "$tmp" "$target"

cat >> "$target" <<EOF
$BEGIN_MARK
# Managed by scripts/setup-global-gitignore.sh — edits inside this block are
# overwritten on re-run. Put your own rules outside it.

# Env files, every variant, at any depth.
.env
.env.*
# Keep the templates that are meant to be committed. These must contain
# placeholders only — an ignore rule cannot protect a tracked file.
!.env*.example
!.env*.sample
!.env*.template

# Private keys and credential bundles.
*.pem
*.p12
*.pfx
*.keystore
*.jks
id_rsa
id_dsa
id_ecdsa
id_ed25519
.netrc
.pgpass
.htpasswd

# Cloud / service credential files.
credentials.json
secrets.json
service-account*.json
*-service-account.json
gha-creds-*.json
$END_MARK
EOF

git config --global core.excludesFile "$target"

echo "Global git excludes file: $target"
echo
echo "Verifying (each line should report the rule that ignores it):"
for probe in .env .env.local .env.production .env.staging.local id_rsa service-account.json; do
  printf '  %-24s ' "$probe"
  if git check-ignore -v --no-index "$probe" 2>/dev/null | awk -F'\t' '{print $1}'; then
    :
  else
    echo "NOT IGNORED — check $target"
  fi
done
printf '  %-24s ' '.env.production.example'
if git check-ignore -q --no-index '.env.production.example' 2>/dev/null; then
  echo 'WRONGLY IGNORED — templates must stay committable'
else
  echo 'not ignored (correct — templates stay committable)'
fi
