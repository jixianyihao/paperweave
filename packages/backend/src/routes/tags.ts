import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export function registerTagRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/tags", async () => {
    return db.prepare(`
      SELECT t.name, COUNT(it.item_id) AS item_count
      FROM tags t JOIN item_tags it ON it.tag_id = t.id
      GROUP BY t.id ORDER BY t.name
    `).all();
  });

  app.put("/api/items/:id/tags/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!item) return reply.code(404).send({ error: "item not found" });
    db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
    const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number };
    db.prepare("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)").run(id, tag.id);
    return reply.code(204).send();
  });

  app.delete("/api/items/:id/tags/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    db.prepare("DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)").run(id, name);
    db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)").run();
    return reply.code(204).send();
  });
}
