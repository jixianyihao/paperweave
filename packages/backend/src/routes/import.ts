import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { importPdf } from "../lib/importfile.js";
import type { FetchLike } from "../lib/metadata.js";

export interface ImportDeps {
  dataDir: string;
  fetchImpl: FetchLike;
}

export function registerImportRoutes(app: FastifyInstance, db: Database.Database, deps: ImportDeps): void {
  app.post("/api/import/file", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "missing file field" });
    const filename = data.filename ?? "upload.pdf";
    if (!/\.pdf$/i.test(filename) && data.mimetype !== "application/pdf") {
      return reply.code(400).send({ error: "only PDF uploads are supported" });
    }
    const buf = await data.toBuffer();
    const result = await importPdf(db, deps.dataDir, new Uint8Array(buf), filename, deps.fetchImpl);
    return result;
  });
}
