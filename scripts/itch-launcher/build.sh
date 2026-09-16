#!/usr/bin/env bash
# Package the itch.io launcher shell for upload. See README.md.
#
# Run this wherever you will upload FROM — the zip goes into a browser, so
# that is usually a laptop, not the server.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${HERE}/dist"
OUT="${OUT_DIR}/borderfall-itch.zip"

mkdir -p "${OUT_DIR}"
rm -f "${OUT}"

# index.html must sit at the ARCHIVE ROOT — itch looks for it there and will
# not find it one directory down.
if command -v zip >/dev/null 2>&1; then
  ( cd "${HERE}" && zip -q "${OUT}" index.html )
elif command -v python3 >/dev/null 2>&1; then
  # Ubuntu server images frequently ship without `zip`; python3 is always
  # there, and zipfile writes exactly the same archive.
  python3 - "${HERE}" "${OUT}" <<'PY'
import os, sys, zipfile
here, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(here, 'index.html'), 'index.html')
PY
else
  echo "build.sh needs either 'zip' or 'python3' and found neither." >&2
  echo "  macOS: zip is built in.  Debian/Ubuntu: sudo apt-get install -y zip" >&2
  exit 1
fi

echo "built ${OUT}"
python3 - "${OUT}" <<'PY' 2>/dev/null || unzip -l "${OUT}"
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    for i in z.infolist():
        print(f"  {i.file_size:>7}  {i.filename}")
PY
