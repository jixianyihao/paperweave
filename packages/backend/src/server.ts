import Fastify from "fastify";
import type Database from "better-sqlite3";
import { openDb } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";

export function buildServer(db: Database.Database = openDb()) {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db);
  return app;
}
