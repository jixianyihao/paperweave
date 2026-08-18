// SEA shim: same createRequire pattern as better-sqlite3-shim.cjs.
// @xenova/transformers does `import * as ONNX_NODE from 'onnxruntime-node'`,
// which esbuild lowers to require("onnxruntime-node") in the CJS bundle.
// SEA require() is builtins-only, so redirect to the real package staged at
// <PAPERWEAVE_BACKEND_HOME>/node_modules/onnxruntime-node (which carries
// bin/napi-v3/<platform>/<arch>/onnxruntime_binding.node).
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");

const home = resolve(process.env.PAPERWEAVE_BACKEND_HOME || __dirname);
const req = createRequire(join(home, "paperweave-backend.cjs"));
module.exports = req("onnxruntime-node");
