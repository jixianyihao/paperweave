import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { newKey } from "../lib/keys.js";

const nameSchema = z.object({ name: z.string().trim().min(1) }).strict();

export function registerCollectionRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/collections", async () => {
    return db.prepare(`
      SELECT c.id, c.parent_id, c.name,
        (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
      FROM collections c ORDER BY c.name
    `).all();
  });

  app.post("/api/collections", async (req, reply) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid name" });
    const id = newKey();
    const parent = (req.body as { parent_id?: string })?.parent_id ?? null;
    db.prepare("INSERT INTO collections (id, parent_id, name) VALUES (?, ?, ?)").run(id, parent, parsed.data.name);
    return { id, parent_id: parent, name: parsed.data.name, item_count: 0 };
  });

  app.patch("/api/collections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid name" });
    const info = db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(parsed.data.name, id);
    if (info.changes === 0) return reply.code(404).send({ error: "collection not found" });
    return db.prepare("SELECT id, parent_id, name FROM collections WHERE id = ?").get(id);
  });

  app.delete("/api/collections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = db.prepare("DELETE FROM collections WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "collection not found" });
    return reply.code(204).send();
  });

  app.put("/api/collections/:id/items/:itemId", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const col = db.prepare("SELECT id FROM collections WHERE id = ?").get(id);
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
    if (!col || !item) return reply.code(404).send({ error: "collection or item not found" });
    db.prepare("INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)").run(id, itemId);
    return reply.code(204).send();
  });

  app.delete("/api/collections/:id/items/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    db.prepare("DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?").run(id, itemId);
    return { ok: true };
  });
}
