#!/usr/bin/env node
// stage-deps.cjs — copy the runtime dependency closure of the given packages
// into <outDir>/node_modules, dereferencing pnpm symlinks.
//
// Usage: node scripts/sea/stage-deps.cjs <outDir> <pkg> [...pkg]
//
// Root packages are resolved from packages/backend first, then from the
// @xenova/transformers package dir (onnxruntime-node and sharp are deps of
// transformers, not of the backend, so pnpm hides them from backend-rooted
// resolution). Declared dependencies are followed recursively from each
// package's own directory, skipping build-time-only packages.
const fs = require("node:fs");
const path = require("node:path");

const [outDir, ...roots] = process.argv.slice(2);
if (!outDir || roots.length === 0) {
  console.error("usage: stage-deps.cjs <outDir> <pkg> [...pkg]");
  process.exit(1);
}

const backendDir = path.join(process.cwd(), "packages/backend");
// Build/install-time-only packages: never required at runtime by sharp or
// onnxruntime-node (sharp's lib/agent.js is only used by its install script).
const SKIP = new Set([
  "node-addon-api",
  "prebuild-install",
  "simple-get",
  "tar-fs",
  "tunnel-agent",
  "onnxruntime-web", // bundled into the SEA (aliased to a stub)
  "@huggingface/jinja", // bundled into the SEA
]);

const resolveBase = (name, fromDir) =>
  fs.realpathSync(path.dirname(require.resolve(`${name}/package.json`, { paths: [fromDir] })));

// anchor for packages hidden from the backend root by pnpm
let transformersDir = "";
try {
  transformersDir = resolveBase("@xenova/transformers", backendDir);
} catch {
  /* transformers not installed — root resolution may still work */
}

const staged = new Set();
function stage(name, fromDir) {
  if (SKIP.has(name) || staged.has(name)) return;
  let src;
  try {
    src = resolveBase(name, fromDir);
  } catch {
    if (transformersDir) {
      try {
        src = resolveBase(name, transformersDir);
      } catch {
        /* fall through */
      }
    }
  }
  if (!src) throw new Error(`cannot resolve ${name}`);
  if (staged.has(src)) return;
  staged.add(name);
  staged.add(src);

  const dest = path.join(outDir, "node_modules", name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });

  const pj = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
  for (const dep of Object.keys(pj.dependencies || {})) {
    stage(dep, src);
  }
}

for (const root of roots) stage(root, backendDir);
console.log(`staged: ${[...staged].filter((s) => !s.startsWith("/")).join(" ")}`);
