import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { createVoiceSession, recordVoiceUsage, type VoiceDeps } from "../lib/voice.js";
import type { ItemRow } from "./items.js";

const sessionSchema = z.object({
  itemId: z.string().min(1).optional(),
  page: z.number().int().positive().nullable().optional(),
  selectedText: z.string().min(1).max(4000).optional(),
}).strict();

const usageSchema = z.object({
  seconds: z.number().int().positive().max(24 * 3600),
}).strict();

export function registerVoiceRoutes(app: FastifyInstance, db: Database.Database, deps: VoiceDeps): void {
  app.post("/api/voice/session", async (req, reply) => {
    const parsed = sessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    const { itemId, page, selectedText } = parsed.data;
    let ctx: { title?: string; abstract?: string | null } = {};
    if (itemId) {
      const item = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ItemRow | undefined;
      if (!item) return reply.code(400).send({ error: "item not found" });
      ctx = { title: item.title, abstract: item.abstract };
    }
    const result = await createVoiceSession(db, { ...ctx, page, selectedText }, deps);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { client_secret: result.client_secret, url: result.url, model: result.model };
  });

  app.post("/api/voice/usage", async (req, reply) => {
    const parsed = usageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    recordVoiceUsage(db, parsed.data.seconds, deps.env);
    return { ok: true };
  });
}
