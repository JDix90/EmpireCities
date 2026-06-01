#!/usr/bin/env bash
# Build Borderfall Android release bundle (AAB) via Capacitor.
#
# Prerequisites: Android Studio, JDK 17+, production API on HTTPS.
#
# Usage:
#   export VITE_API_URL=https://play.your-domain.com
#   export VITE_SOCKET_URL=https://play.your-domain.com
#   export VITE_SENTRY_DSN=...   # optional
#   ./scripts/build-android-release.sh
#
# Then open Android Studio for signed AAB:
#   cd frontend && pnpm run cap:android
#   Build → Generate Signed Bundle / APK
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -z "${VITE_API_URL:-}" ] || [ -z "${VITE_SOCKET_URL:-}" ]; then
  echo "Set VITE_API_URL and VITE_SOCKET_URL to your production HTTPS origin." >&2
  echo "Example: export VITE_API_URL=https://play.your-domain.com" >&2
  exit 1
fi

cd "${REPO_ROOT}/frontend"

echo "[android] Building web assets with production API..."
pnpm run build

echo "[android] Syncing Capacitor (com.borderfall.app)..."
pnpm exec cap sync android

echo "[android] Web build synced. Open Android Studio to sign and export AAB:"
echo "  cd frontend && pnpm run cap:android"
echo ""
echo "Checklist before Play upload:"
echo "  - applicationId com.borderfall.app"
echo "  - Increment versionCode / versionName in android/app/build.gradle"
echo "  - Privacy: https://YOUR_DOMAIN/privacy"
echo "  - Terms: https://YOUR_DOMAIN/terms"
echo "  - See docs/STORE_RELEASE.md"
