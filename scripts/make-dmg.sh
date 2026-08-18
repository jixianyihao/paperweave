#!/usr/bin/env bash
# make-dmg.sh — package the built PaperWeave.app into a distributable .dmg
# with hdiutil only (no Finder AppleScript prettification, which requires
# interactive TCC automation permission and fails in headless/CI contexts).
set -euo pipefail
cd "$(dirname "$0")/.."

APP="apps/desktop/src-tauri/target/release/bundle/macos/PaperWeave.app"
OUT_DIR="apps/desktop/src-tauri/target/release/bundle/dmg"
DMG="$OUT_DIR/PaperWeave_0.1.0_aarch64.dmg"
STAGE="$(mktemp -d)/dmg-root"

[ -d "$APP" ] || { echo "ERROR: $APP not found — run pnpm -F @paperweave/desktop build first"; exit 1; }

mkdir -p "$STAGE" "$OUT_DIR"
rm -f "$DMG"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create -volname "PaperWeave" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

echo "DMG: $DMG ($(du -h "$DMG" | cut -f1))"
