import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { ItemRow } from "./items.js";
import { toFtsQuery } from "../lib/fts.js";

export function registerSearchRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/search", async (req, reply) => {
    const { q } = req.query as { q?: string };
    if (q === undefined) return reply.code(400).send({ error: "q is required" });
    const match = toFtsQuery(q);
    if (!match) return { items: [] };
    const items = db.prepare(`
      SELECT items.* FROM items_fts
      JOIN items ON items.rowid = items_fts.rowid
      WHERE items_fts MATCH ?
      ORDER BY rank, items.id
      LIMIT 50
    `).all(match) as ItemRow[];
    return { items };
  });
}
