import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { newKey } from "../lib/keys.js";

export const ANNOTATION_TYPES = [
  "highlight", "note", "ai_summary", "ai_explain", "ai_translate", "ai_qa", "voice_digest",
] as const;

export interface AnnotationRow {
  id: string;
  item_id: string;
  type: (typeof ANNOTATION_TYPES)[number];
  page: number | null;
  position: string | null;
  content: string;
  color: string | null;
  created_at: string;
  sort_index: number;
}

const createSchema = z
  .object({
    type: z.enum(ANNOTATION_TYPES),
    content: z.string().min(1),
    page: z.number().int().nullable().optional(),
    position: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    content: z.string().min(1),
    color: z.string().nullable(),
  })
  .strict()
  .partial();

export function registerAnnotationRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/items/:id/annotations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!item) return reply.code(404).send({ error: "item not found" });
    return db.prepare(`
      SELECT * FROM annotations WHERE item_id = ?
      ORDER BY page, sort_index, created_at, id
    `).all(id) as AnnotationRow[];
  });

  app.post("/api/items/:id/annotations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid annotation", details: parsed.error.issues });
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!item) return reply.code(404).send({ error: "item not found" });
    const annId = newKey();
    const { type, content, page, position, color } = parsed.data;
    db.prepare(`
      INSERT INTO annotations (id, item_id, type, page, position, content, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(annId, id, type, page ?? null, position ?? null, content, color ?? null);
    return db.prepare("SELECT * FROM annotations WHERE id = ?").get(annId) as AnnotationRow;
  });

  app.patch("/api/annotations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid patch", details: parsed.success ? "empty" : parsed.error.issues });
    }
    const existing = db.prepare("SELECT id FROM annotations WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "annotation not found" });
    if (parsed.data.content !== undefined) {
      db.prepare("UPDATE annotations SET content = ? WHERE id = ?").run(parsed.data.content, id);
    }
    if (parsed.data.color !== undefined) {
      db.prepare("UPDATE annotations SET color = ? WHERE id = ?").run(parsed.data.color, id);
    }
    return db.prepare("SELECT * FROM annotations WHERE id = ?").get(id) as AnnotationRow;
  });

  app.delete("/api/annotations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = db.prepare("DELETE FROM annotations WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "annotation not found" });
    return reply.code(204).send();
  });

  app.get("/api/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!conversation) return reply.code(404).send({ error: "conversation not found" });
    const messages = db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id",
    ).all(id);
    return { conversation, messages };
  });
}
