import Fastify from "fastify";
import type Database from "better-sqlite3";

export function buildServer(_db?: Database.Database) {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  return app;
}
