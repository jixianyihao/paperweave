#!/usr/bin/env bash
# build-backend-sea.sh — compile packages/backend into a single-file Node SEA binary
# for Tauri sidecar bundling.
#
# Why SEA (and not bun --compile): better-sqlite3's native binding fails to
# dlopen under the Bun runtime (oven-sh/bun#4290). SEA embeds the bundled JS
# into a copy of the node binary; the native module + SQL migrations stay on
# disk as Tauri resources and are located via PAPERWEAVE_BACKEND_HOME.
#
# Outputs (relative to repo root):
#   apps/desktop/src-tauri/binaries/paperweave-backend-<target-triple>[.exe]
#   apps/desktop/src-tauri/resources/backend/node_modules/...   (native deps)
#   apps/desktop/src-tauri/resources/migrations/*.sql           (db migrations)
set -euo pipefail
cd "$(dirname "$0")/.."

TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT_BIN="apps/desktop/src-tauri/binaries/paperweave-backend-${TRIPLE}"
RES_DIR="apps/desktop/src-tauri/resources"
WORK=".sea-build"
ESBUILD="apps/desktop/node_modules/.bin/esbuild"
POSTJECT="apps/desktop/node_modules/.bin/postject"

command -v node >/dev/null || { echo "node required to build SEA (build-time only)"; exit 1; }
[ -x "$ESBUILD" ] || { echo "esbuild missing — run pnpm install"; exit 1; }
[ -x "$POSTJECT" ] || { echo "postject missing — run pnpm install"; exit 1; }

rm -rf "$WORK"
mkdir -p "$WORK"

# 1. bundle backend to a single CJS file
#    - better-sqlite3 aliased to a createRequire shim (SEA require() is builtins-only)
#    - import.meta.dirname redirected to PAPERWEAVE_BACKEND_HOME at runtime
"$ESBUILD" scripts/sea/entry.ts \
  --bundle --platform=node --format=cjs --target=node20 \
  --alias:better-sqlite3=./scripts/sea/better-sqlite3-shim.cjs \
  "--define:import.meta.dirname=globalThis.__PW_DIRNAME__" \
  "--banner:js=globalThis.__PW_DIRNAME__ = process.env.PAPERWEAVE_BACKEND_HOME || __dirname;" \
  --outfile="$WORK/backend.cjs"

# 2. SEA prep blob
cat > "$WORK/sea-config.json" <<EOF
{
  "main": "${WORK}/backend.cjs",
  "output": "${WORK}/backend.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
EOF
node --experimental-sea-config "$WORK/sea-config.json"

# 3. copy the node runtime binary and inject the blob
NODE_BIN="$(command -v node)"
cp "$NODE_BIN" "$WORK/paperweave-backend"
if [ "$(uname)" = "Darwin" ]; then
  codesign --remove-signature "$WORK/paperweave-backend" || true
fi
"$POSTJECT" "$WORK/paperweave-backend" NODE_SEA_BLOB "$WORK/backend.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  ${MACOS_SEA_OPTS:---macho-segment-name NODE_SEA}
if [ "$(uname)" = "Darwin" ]; then
  codesign --sign - "$WORK/paperweave-backend"   # ad-hoc; re-signed by tauri build
fi

# 4. place sidecar binary where tauri externalBin expects it
mkdir -p apps/desktop/src-tauri/binaries
cp "$WORK/paperweave-backend" "$OUT_BIN"
chmod +x "$OUT_BIN"

# 5. stage runtime resources: native node_modules + migrations
#    layout inside the .app:  Resources/backend/node_modules/...
#                             Resources/migrations/*.sql
#    backend resolves migrations as join(PAPERWEAVE_BACKEND_HOME, "..", "migrations")
rm -rf "$RES_DIR/backend" "$RES_DIR/migrations"
mkdir -p "$RES_DIR/backend/node_modules" "$RES_DIR/migrations"
cp packages/backend/migrations/*.sql "$RES_DIR/migrations/"
for pkg in better-sqlite3 bindings file-uri-to-path; do
  src="$(node scripts/sea/resolve-pkg.cjs "$pkg")" || exit 1
  cp -RL "$src" "$RES_DIR/backend/node_modules/${pkg}"
done
# bindings only needs its entry; drop prebuild noise
rm -rf "$RES_DIR/backend/node_modules/better-sqlite3/obj" \
       "$RES_DIR/backend/node_modules/better-sqlite3/obj.target" \
       "$RES_DIR/backend/node_modules/better-sqlite3/src" \
       "$RES_DIR/backend/node_modules/better-sqlite3/deps" \
       "$RES_DIR/backend/node_modules/better-sqlite3/prebuilds" 2>/dev/null || true

echo "SEA sidecar: $OUT_BIN ($(du -h "$OUT_BIN" | cut -f1))"
echo "resources:   $RES_DIR/backend/node_modules, $RES_DIR/migrations"
