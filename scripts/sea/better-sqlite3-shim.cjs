// SEA shim: the embedded CJS script inside a Node single-executable may only
// require() builtin modules. Native deps must be loaded via module.createRequire
// anchored at a REAL directory on disk that carries node_modules.
// PAPERWEAVE_BACKEND_HOME points at <app-resources>/backend, which contains
// node_modules/{better-sqlite3,bindings,file-uri-to-path}.
const { createRequire } = require("node:module");
const { join } = require("node:path");

const home = process.env.PAPERWEAVE_BACKEND_HOME || __dirname;
const req = createRequire(join(home, "paperweave-backend.cjs"));
module.exports = req("better-sqlite3");
