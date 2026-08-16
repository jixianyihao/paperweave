import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import { openDb, resolveDataDir } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerImportRoutes } from "./routes/import.js";
import type { FetchLike } from "./lib/metadata.js";

export interface ServerOptions {
  dataDir?: string;
  fetchImpl?: FetchLike;
}

export function buildServer(db: Database.Database = openDb(), opts: ServerOptions = {}) {
  const dataDir = opts.dataDir ?? resolveDataDir();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const app = Fastify({ logger: false });
  void app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db, { dataDir });
  registerCollectionRoutes(app, db);
  registerTagRoutes(app, db);
  registerImportRoutes(app, db, { dataDir, fetchImpl });
  return app;
}
