import Fastify from "fastify";
import type Database from "better-sqlite3";
import { openDb, resolveDataDir } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";

export interface ServerOptions {
  dataDir?: string;
}

export function buildServer(db: Database.Database = openDb(), opts: ServerOptions = {}) {
  const dataDir = opts.dataDir ?? resolveDataDir();
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db, { dataDir });
  registerCollectionRoutes(app, db);
  registerTagRoutes(app, db);
  return app;
}
