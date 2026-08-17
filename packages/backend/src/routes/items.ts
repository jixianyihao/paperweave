import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { patchItemSchema } from "../lib/validate.js";
import { toFtsQuery } from "../lib/fts.js";

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

const listQuerySchema = z
  .object({
    collection: z.string().min(1),
    tag: z.string().min(1),
    status: z.enum(["unread", "reading", "read"]),
    starred: z.enum(["0", "1"]),
    q: z.string().min(1),
  })
  .strict()
  .partial();

export function registerItemRoutes(app: FastifyInstance, db: Database.Database, deps: RouteDeps): void {
  app.get("/api/items", async (req, reply): Promise<ItemRow[] | void> => {
    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid query", details: parsed.error.issues });
    const { collection, tag, status, starred, q } = parsed.data;
    const joins: string[] = [];
    const wheres: string[] = [];
    const params: unknown[] = [];
    if (collection) {
      joins.push("JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = ?");
      params.push(collection);
    }
    if (tag) {
      joins.push("JOIN item_tags it ON it.item_id = i.id JOIN tags t ON t.id = it.tag_id AND t.name = ?");
      params.push(tag);
    }
    if (q) {
      const match = toFtsQuery(q);
      if (match) {
        joins.push("JOIN items_fts ON items_fts.rowid = i.rowid");
        wheres.push("items_fts MATCH ?");
        params.push(match);
      }
    }
    if (status) { wheres.push("i.reading_status = ?"); params.push(status); }
    if (starred) { wheres.push("i.starred = ?"); params.push(Number(starred)); }
    const sql = `
      SELECT DISTINCT i.* FROM items i
      ${joins.join(" ")}
      ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""}
      ORDER BY i.date_added DESC, i.id DESC
    `;
    return db.prepare(sql).all(...params) as ItemRow[];
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
