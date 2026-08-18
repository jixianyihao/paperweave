// SEA wrapper entry for the PaperWeave backend sidecar.
//
// packages/backend has no CORS plugin and stream P must not modify backend
// sources. The desktop webview origin (http://tauri.localhost) is cross-origin
// to the sidecar (http://127.0.0.1:<port>), so this wrapper injects permissive
// CORS headers at the Node http layer and answers OPTIONS preflights before
// they reach Fastify. The backend binds 127.0.0.1 only, so exposure is limited
// to processes on this machine.
//
// Long-term the backend should own this (e.g. @fastify/cors registered when a
// PAPERWEAVE_DESKTOP=1 env is set) — see stream-p report.

import http from "node:http";

const ALLOW_HEADERS = "Content-Type, Authorization";
const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

const origWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function patchedWriteHead(
  this: http.ServerResponse,
  ...args: unknown[]
) {
  if (!this.headersSent) {
    this.setHeader("Access-Control-Allow-Origin", "*");
    this.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
    this.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
  }
  return origWriteHead.apply(this, args as [number]);
};

const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function patchedEmit(
  this: http.Server,
  event: string,
  ...args: unknown[]
) {
  if (event === "request") {
    const req = args[0] as http.IncomingMessage;
    const res = args[1] as http.ServerResponse;
    if (req?.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }
  }
  return origEmit.call(this, event, ...args);
};

import("../../packages/backend/src/index.js").catch((e) => {
  console.error("[paperweave-backend] fatal during startup:", e);
  process.exit(1);
});
