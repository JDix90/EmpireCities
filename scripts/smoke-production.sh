#!/usr/bin/env bash
# Smoke test: public /health (and optionally /ready) through nginx or direct API.
# Usage: ./scripts/smoke-production.sh [BASE_URL]
# Examples:
#   ./scripts/smoke-production.sh http://localhost
#   ./scripts/smoke-production.sh https://play.example.com
set -euo pipefail
BASE="${1:-http://localhost}"
BASE="${BASE%/}"

echo "GET ${BASE}/health"
curl -sfS "${BASE}/health" | head -c 400 || {
  echo "FAILED: ${BASE}/health" >&2
  exit 1
}
echo

echo "GET ${BASE}/ready (via nginx proxy if same-origin stack)"
if curl -sfS "${BASE}/ready" | head -c 400; then
  echo
else
  echo "WARN: ${BASE}/ready failed — backend or databases may not be ready" >&2
  exit 1
fi

echo "OK"
