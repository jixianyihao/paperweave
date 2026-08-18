#!/usr/bin/env node
// Resolve a package dir through pnpm's symlinked layout.
// Usage: node scripts/sea/resolve-pkg.js <pkg> — prints the package directory.
const path = require("node:path");
const fs = require("node:fs");
const pkg = process.argv[2];
const root = process.cwd();
// transitive deps (bindings, file-uri-to-path) live in the REAL .pnpm dir of
// their parent package, so resolve better-sqlite3 first and realpath it
let bsDir = "";
try {
  bsDir = fs.realpathSync(
    path.dirname(require.resolve("better-sqlite3/package.json", { paths: [path.join(root, "packages/backend")] })),
  );
} catch {
  /* better-sqlite3 itself unresolved */
}
const bases = [path.join(root, "packages/backend"), bsDir, bsDir && path.join(bsDir, "..")].filter(Boolean);
for (const b of bases) {
  try {
    console.log(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [b] })));
    process.exit(0);
  } catch {
    /* try next base */
  }
}
console.error(`cannot resolve ${pkg}`);
process.exit(1);
