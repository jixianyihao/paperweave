// SEA shim for @napi-rs/canvas (pdfjs Node polyfill source) — same pattern as better-sqlite3-shim.cjs
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");

const home = resolve(process.env.PAPERWEAVE_BACKEND_HOME || __dirname);
const req = createRequire(join(home, "paperweave-backend.cjs"));
module.exports = req("@napi-rs/canvas");
