import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { importPdf } from "../lib/importfile.js";
import { importIdentifier } from "../lib/importidentifier.js";
import { importRisBib, detectFormat } from "../lib/risbib.js";
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

  const identifierSchema = z.object({ input: z.string().trim().min(1) }).strict();

  app.post("/api/import/identifier", async (req, reply) => {
    const parsed = identifierSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "input required" });
    const result = await importIdentifier(db, deps.dataDir, parsed.data.input, deps.fetchImpl);
    if (!result) return reply.code(400).send({ error: "unrecognized identifier or metadata lookup failed" });
    return result;
  });

  // RIS / BibTeX 迁移导入（spec §3.2）：JSON body 携带纯文本内容，批量建条目
  const risSchema = z.object({ content: z.string().min(1).max(10 * 1024 * 1024) }).strict();

  app.post("/api/import/ris", async (req, reply) => {
    const parsed = risSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "content required", details: parsed.error.issues });
    if (!detectFormat(parsed.data.content)) return reply.code(400).send({ error: "unrecognized RIS/BibTeX content" });
    return importRisBib(db, parsed.data.content);
  });
}
