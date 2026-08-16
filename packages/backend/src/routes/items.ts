import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { patchItemSchema } from "../lib/validate.js";

export interface ItemRow {
  id: string;
  title: string;
  creators: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  abstract: string | null;
  file_path: string | null;
  reading_status: "unread" | "reading" | "read";
  metadata_status: "pending" | "complete" | "failed";
  starred: number;
  date_added: string;
  date_modified: string;
}

export interface RouteDeps {
  dataDir: string;
}

const UPDATABLE = ["title", "year", "venue", "abstract", "reading_status", "starred"] as const;

export function registerItemRoutes(app: FastifyInstance, db: Database.Database, deps: RouteDeps): void {
  app.get("/api/items", async (): Promise<ItemRow[]> => {
    return db.prepare("SELECT * FROM items ORDER BY date_added DESC, id DESC").all() as ItemRow[];
  });

  app.get("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!row) return reply.code(404).send({ error: "item not found" });
    return row;
  });

  app.patch("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchItemSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid patch", details: parsed.success ? "empty" : parsed.error.issues });
    }
    const existing = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "item not found" });
    const sets = UPDATABLE.filter((f) => f in parsed.data).map((f) => `${f} = ?`);
    const values = UPDATABLE.filter((f) => f in parsed.data).map((f) => (parsed.data as Record<string, unknown>)[f]);
    db.prepare(`UPDATE items SET ${sets.join(", ")}, date_modified = datetime('now') WHERE id = ?`).run(...values, id);
    return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  });

  app.delete("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT file_path FROM items WHERE id = ?").get(id) as { file_path: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: "item not found" });
    if (row.file_path) {
      const abs = join(deps.dataDir, row.file_path);
      if (existsSync(abs)) unlinkSync(abs);
    }
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
