import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { newKey } from "../lib/keys.js";
import { AI_TASKS, resolveProvider, pingLlm, type ProviderRow } from "../lib/llm/router.js";
import type { FetchLike } from "../lib/metadata.js";

export interface ProvidersDeps {
  fetchImpl: FetchLike;
}

const PROVIDER_KINDS = ["builtin", "anthropic", "openai", "custom"] as const;

const createSchema = z
  .object({
    kind: z.enum(PROVIDER_KINDS),
    label: z.string().trim().min(1),
    base_url: z.string().url().nullable().optional(),
    api_key: z.string().min(1).nullable().optional(),
    models: z.array(z.string().min(1)).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    label: z.string().trim().min(1),
    base_url: z.string().url().nullable(),
    api_key: z.string().min(1).nullable(),
    models: z.array(z.string().min(1)),
    enabled: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .partial();

// 响应永不包含 api_key，只有 has_key
function toPublic(row: ProviderRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    base_url: row.base_url,
    has_key: Boolean(row.api_key),
    models: row.models,
    enabled: row.enabled,
  };
}

export function registerProviderRoutes(app: FastifyInstance, db: Database.Database, deps: ProvidersDeps): void {
  app.get("/api/providers", async () => {
    const rows = db.prepare("SELECT * FROM providers ORDER BY label, id").all() as ProviderRow[];
    return rows.map(toPublic);
  });

  app.post("/api/providers", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid provider", details: parsed.error.issues });
    const { kind, label, base_url, api_key, models } = parsed.data;
    if (kind === "custom" && !base_url) return reply.code(400).send({ error: "custom provider requires base_url" });
    const id = newKey();
    db.prepare("INSERT INTO providers (id, kind, label, base_url, api_key, models) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, kind, label, base_url ?? null, api_key ?? null, JSON.stringify(models ?? []));
    return toPublic(db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow);
  });

  app.patch("/api/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid patch", details: parsed.success ? "empty" : parsed.error.issues });
    }
    const existing = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!existing) return reply.code(404).send({ error: "provider not found" });
    const d = parsed.data;
    if (existing.kind === "custom" && d.base_url === null) {
      return reply.code(400).send({ error: "custom provider requires base_url" });
    }
    if (d.label !== undefined) db.prepare("UPDATE providers SET label = ? WHERE id = ?").run(d.label, id);
    if (d.base_url !== undefined) db.prepare("UPDATE providers SET base_url = ? WHERE id = ?").run(d.base_url, id);
    if (d.api_key !== undefined) db.prepare("UPDATE providers SET api_key = ? WHERE id = ?").run(d.api_key, id);
    if (d.models !== undefined) db.prepare("UPDATE providers SET models = ? WHERE id = ?").run(JSON.stringify(d.models), id);
    if (d.enabled !== undefined) db.prepare("UPDATE providers SET enabled = ? WHERE id = ?").run(d.enabled, id);
    return toPublic(db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow);
  });

  app.delete("/api/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "provider not found" });
    db.prepare("UPDATE task_routes SET provider_id = NULL WHERE provider_id = ?").run(id);
    return reply.code(204).send();
  });

  app.post("/api/providers/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!provider) return reply.code(404).send({ error: "provider not found" });
    const resolved = resolveProvider(provider);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    try {
      await pingLlm(resolved.llm, deps.fetchImpl);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/task-routes", async () => {
    const rows = db.prepare("SELECT task, provider_id, model FROM task_routes").all() as
      { task: string; provider_id: string | null; model: string | null }[];
    const byTask = new Map(rows.map((r) => [r.task, r]));
    return AI_TASKS.map((task) => ({
      task,
      provider_id: byTask.get(task)?.provider_id ?? null,
      model: byTask.get(task)?.model ?? null,
    }));
  });

  const patchRouteSchema = z
    .object({
      task: z.enum(AI_TASKS),
      provider_id: z.string().min(1).nullable(),
      model: z.string().min(1).nullable(),
    })
    .strict();

  app.patch("/api/task-routes", async (req, reply) => {
    const parsed = patchRouteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid task route", details: parsed.error.issues });
    const { task, provider_id, model } = parsed.data;
    if (provider_id !== null) {
      const provider = db.prepare("SELECT id FROM providers WHERE id = ?").get(provider_id);
      if (!provider) return reply.code(400).send({ error: "provider not found" });
    }
    db.prepare(`
      INSERT INTO task_routes (task, provider_id, model) VALUES (?, ?, ?)
      ON CONFLICT(task) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model
    `).run(task, provider_id, model);
    return { task, provider_id, model };
  });

  app.get("/api/usage", async () => {
    const total = (where: string) => (db.prepare(`
      SELECT COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) AS tokens
      FROM usage_log WHERE ${where}
    `).get() as { tokens: number }).tokens;
    const byTask = db.prepare(`
      SELECT task, SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) AS tokens
      FROM usage_log
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      GROUP BY task ORDER BY task
    `).all() as { task: string; tokens: number }[];
    return {
      today_tokens: total("date(created_at) = date('now')"),
      month_tokens: total("strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"),
      by_task: byTask,
    };
  });
}
