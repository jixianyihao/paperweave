#!/usr/bin/env bash
# build-desktop.sh — one-shot PaperWeave desktop pipeline:
#   reader assets → web frontend → backend SEA sidecar → icons → tauri build (.dmg)
#
# Usage: bash scripts/build-desktop.sh [--skip-reader]
# Notes:
#   - First run needs network: git submodule (vendor/zotero-reader) + cargo crates.
#     If behind a proxy: https_proxy=http://127.0.0.1:7897 bash scripts/build-desktop.sh
#   - Icons: apps/desktop/icon-src.png is committed; regenerate with
#     `swift scripts/sea/render-icon.swift apps/desktop/icon-src.png` then
#     `(cd apps/desktop && pnpm tauri icon icon-src.png)`.
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_READER=0
[ "${1:-}" = "--skip-reader" ] && SKIP_READER=1

# 1. reader assets (apps/web/public/reader)
if [ "$SKIP_READER" = "0" ]; then
  if [ -f apps/web/public/reader/reader.html ] && [ -f apps/web/public/reader/bootstrap.js ]; then
    echo "== reader assets present, skipping (use scripts/build-reader.sh to force)"
  else
    echo "== building reader assets"
    bash scripts/build-reader.sh
  fi
fi
[ -f apps/web/public/reader/reader.html ] || { echo "ERROR: reader assets missing"; exit 1; }

# 2. web frontend (apps/web/dist)
echo "== building web frontend"
pnpm -F @paperweave/web build

# 3. backend SEA sidecar + runtime resources
echo "== building backend SEA sidecar"
bash scripts/build-backend-sea.sh

# 4. icons must exist (generated once via `pnpm tauri icon`, committed)
for f in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  [ -f "apps/desktop/src-tauri/icons/$f" ] || { echo "ERROR: icons/$f missing — run (cd apps/desktop && pnpm tauri icon icon-src.png)"; exit 1; }
done

# 5. tauri build → per-OS bundles
echo "== building tauri app"
pnpm -F @paperweave/desktop build

# 6. macOS 额外打 DMG（ad-hoc 签名）
if [ "$(uname -s)" = "Darwin" ]; then
  echo "== packaging DMG (macOS)"
  bash scripts/make-dmg.sh
fi

echo "== done. Artifacts:"
find apps/desktop/src-tauri/target/release/bundle -maxdepth 3 \( -name "*.dmg" -o -name "*.app" -o -name "*.msi" -o -name "*.exe" -o -name "*.AppImage" -o -name "*.deb" \) -exec du -sh {} \; 2>/dev/null || true
