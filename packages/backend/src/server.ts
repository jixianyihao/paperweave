import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import { openDb, resolveDataDir } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerAnnotationRoutes } from "./routes/annotations.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerAskRoutes } from "./routes/ask.js";
import { registerVoiceRoutes } from "./routes/voice.js";
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
  registerItemRoutes(app, db, { dataDir, fetchImpl });
  registerCollectionRoutes(app, db);
  registerTagRoutes(app, db);
  registerImportRoutes(app, db, { dataDir, fetchImpl });
  registerSearchRoutes(app, db);
  registerAnnotationRoutes(app, db, { fetchImpl });
  registerProviderRoutes(app, db, { fetchImpl });
  registerAiRoutes(app, db, { fetchImpl });
  registerAskRoutes(app, db, { dataDir, fetchImpl });
  registerVoiceRoutes(app, db, { fetchImpl });
  return app;
}
