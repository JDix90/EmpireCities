#!/usr/bin/env bash
# Build Borderfall iOS release via Capacitor + Xcode archive.
#
# Prerequisites: macOS, Xcode, CocoaPods, production API on HTTPS.
#
# Usage:
#   export VITE_API_URL=https://play.your-domain.com
#   export VITE_SOCKET_URL=https://play.your-domain.com
#   export VITE_SENTRY_DSN=...   # optional
#   ./scripts/build-ios-release.sh
#
# Then in Xcode: Product → Archive → Distribute App → App Store Connect
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "iOS builds require macOS with Xcode." >&2
  exit 1
fi

if [ -z "${VITE_API_URL:-}" ] || [ -z "${VITE_SOCKET_URL:-}" ]; then
  echo "Set VITE_API_URL and VITE_SOCKET_URL to your production HTTPS origin." >&2
  exit 1
fi

cd "${REPO_ROOT}/frontend"

echo "[ios] Building web assets with production API..."
pnpm run build

echo "[ios] Syncing Capacitor (com.borderfall.app)..."
pnpm exec cap sync ios

if [ -d ios/App ]; then
  echo "[ios] Running pod install..."
  (cd ios/App && pod install)
fi

echo "[ios] Opening Xcode..."
pnpm run cap:ios

echo ""
echo "Checklist before App Store upload:"
echo "  - Bundle ID com.borderfall.app"
echo "  - MARKETING_VERSION / CURRENT_PROJECT_VERSION bumped"
echo "  - App icons replaced in AppIcon.appiconset"
echo "  - Privacy: https://YOUR_DOMAIN/privacy"
echo "  - Terms: https://YOUR_DOMAIN/terms"
echo "  - TestFlight internal test before App Review"
echo "  - See docs/STORE_RELEASE.md"
