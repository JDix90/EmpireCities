#!/usr/bin/env bash
# Package the itch.io launcher shell for upload. See README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${HERE}/dist"
OUT="${OUT_DIR}/borderfall-itch.zip"

command -v zip >/dev/null 2>&1 || { echo "zip is not installed" >&2; exit 1; }

# index.html must sit at the ARCHIVE ROOT — itch looks for it there and will
# not find it one directory down.
mkdir -p "${OUT_DIR}"
rm -f "${OUT}"
( cd "${HERE}" && zip -q "${OUT}" index.html )

echo "built ${OUT}"
unzip -l "${OUT}"
