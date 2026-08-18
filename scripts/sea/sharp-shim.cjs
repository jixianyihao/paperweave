// SEA shim: same createRequire pattern as better-sqlite3-shim.cjs.
// @xenova/transformers v2 imports sharp eagerly at module top level
// (src/utils/image.js: `import sharp from 'sharp'`), so the native package
// must load even though the embedding path never processes images.
// Redirect to the real package staged at
// <PAPERWEAVE_BACKEND_HOME>/node_modules/sharp (build/Release/*.node + vendor/).
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");

const home = resolve(process.env.PAPERWEAVE_BACKEND_HOME || __dirname);
const req = createRequire(join(home, "paperweave-backend.cjs"));
module.exports = req("sharp");
