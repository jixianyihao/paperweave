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
#    - native deps (better-sqlite3, onnxruntime-node, sharp) aliased to
#      createRequire shims (SEA require() is builtins-only); real packages
#      staged into resources in step 5
#    - onnxruntime-web aliased to an empty stub: transformers imports it
#      alongside onnxruntime-node but only uses it in browsers
#    - import.meta.dirname redirected to PAPERWEAVE_BACKEND_HOME at runtime
"$ESBUILD" scripts/sea/entry.ts \
  --bundle --platform=node --format=cjs --target=node20 \
  --alias:better-sqlite3=./scripts/sea/better-sqlite3-shim.cjs \
  --alias:onnxruntime-node=./scripts/sea/onnxruntime-node-shim.cjs \
  --alias:onnxruntime-web=./scripts/sea/onnxruntime-web-stub.cjs \
  --alias:sharp=./scripts/sea/sharp-shim.cjs \
  --alias:@napi-rs/canvas=./scripts/sea/napi-canvas-shim.cjs \
  "--define:import.meta.dirname=globalThis.__PW_DIRNAME__" \
  "--define:import.meta.url=globalThis.__PW_IMPORT_META_URL__" \
  "--banner:js=globalThis.__PW_DIRNAME__ = process.env.PAPERWEAVE_BACKEND_HOME || __dirname; globalThis.__PW_IMPORT_META_URL__ = require(\"node:url\").pathToFileURL(require(\"node:path\").resolve(globalThis.__PW_DIRNAME__, \"paperweave-backend.cjs\")).href;" \
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
OS="$(uname -s)"
NODE_BIN="$(command -v node)"
EXE_SUFFIX=""
case "$TRIPLE" in *windows*) EXE_SUFFIX=".exe";; esac
case "$OS" in MINGW*|MSYS*|CYGWIN*) [ -z "$EXE_SUFFIX" ] && EXE_SUFFIX=".exe";; esac
cp "$NODE_BIN" "$WORK/paperweave-backend${EXE_SUFFIX}"
if [ "$OS" = "Darwin" ]; then
  codesign --remove-signature "$WORK/paperweave-backend${EXE_SUFFIX}" || true
fi
SEA_OPTS=()
if [ "$OS" = "Darwin" ]; then
  SEA_OPTS=(--macho-segment-name NODE_SEA)
fi
"$POSTJECT" "$WORK/paperweave-backend${EXE_SUFFIX}" NODE_SEA_BLOB "$WORK/backend.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  ${MACOS_SEA_OPTS:+"$MACOS_SEA_OPTS"} ${SEA_OPTS:+"${SEA_OPTS[@]}"}
if [ "$OS" = "Darwin" ]; then
  codesign --sign - "$WORK/paperweave-backend${EXE_SUFFIX}"   # ad-hoc; re-signed by tauri build
fi

# 4. place sidecar binary where tauri externalBin expects it
mkdir -p apps/desktop/src-tauri/binaries
cp "$WORK/paperweave-backend${EXE_SUFFIX}" "${OUT_BIN}${EXE_SUFFIX}"
chmod +x "${OUT_BIN}${EXE_SUFFIX}" 2>/dev/null || true

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
# stage onnxruntime-node + sharp + @napi-rs/canvas（pdfjs polyfill）
# + pdfjs-dist（SEA 下 worker 文件按文件路径加载）
# + @napi-rs/canvas-darwin-arm64（canvas 的平台原生绑定）
node scripts/sea/stage-deps.cjs "$RES_DIR/backend" onnxruntime-node sharp @napi-rs/canvas pdfjs-dist @napi-rs/canvas-darwin-arm64
# bindings only needs its entry; drop prebuild noise
rm -rf "$RES_DIR/backend/node_modules/better-sqlite3/obj" \
       "$RES_DIR/backend/node_modules/better-sqlite3/obj.target" \
       "$RES_DIR/backend/node_modules/better-sqlite3/src" \
       "$RES_DIR/backend/node_modules/better-sqlite3/deps" \
       "$RES_DIR/backend/node_modules/better-sqlite3/prebuilds" 2>/dev/null || true
# keep only the host platform's onnxruntime binding (tarball ships all six)
HOST_OS="$(node -p 'process.platform')"
HOST_ARCH="$(node -p 'process.arch')"
ORT_BIN="$RES_DIR/backend/node_modules/onnxruntime-node/bin/napi-v3"
if [ -d "$ORT_BIN" ]; then
  for os_dir in "$ORT_BIN"/*; do
    [ "$(basename "$os_dir")" = "$HOST_OS" ] || rm -rf "$os_dir"
  done
  for arch_dir in "$ORT_BIN/$HOST_OS"/*; do
    [ -d "$arch_dir" ] || continue
    [ "$(basename "$arch_dir")" = "$HOST_ARCH" ] || rm -rf "$arch_dir"
  done
fi

echo "SEA sidecar: $OUT_BIN ($(du -h "$OUT_BIN" | cut -f1))"
echo "resources:   $RES_DIR/backend/node_modules, $RES_DIR/migrations"
