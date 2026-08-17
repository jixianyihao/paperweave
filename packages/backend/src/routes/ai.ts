import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { newKey } from "../lib/keys.js";
import { startSse } from "../lib/sse.js";
import { streamTask, type AiTask } from "../lib/llm/router.js";
import {
  summarizeMessages, explainMessages, translateMessages,
  type PaperContext,
} from "../lib/llm/prompts.js";
import type { ChatMessage } from "../lib/llm/common.js";
import type { FetchLike } from "../lib/metadata.js";
import type { ItemRow } from "./items.js";

export interface AiDeps {
  fetchImpl: FetchLike;
}

const baseFields = {
  text: z.string().min(1),
  itemId: z.string().min(1).optional(),
  page: z.number().int().nullable().optional(),
};

const summarizeSchema = z.object({ ...baseFields, level: z.enum(["brief", "bullets"]).optional() }).strict();
const explainSchema = z.object({ ...baseFields, level: z.enum(["eli5", "undergrad", "grad", "expert"]).optional() }).strict();
const translateSchema = z.object({ ...baseFields, targetLang: z.enum(["zh", "en"]).optional() }).strict();

const ANNOTATION_TYPE = {
  summarize: "ai_summary",
  explain: "ai_explain",
  translate: "ai_translate",
} as const;

export function registerAiRoutes(app: FastifyInstance, db: Database.Database, deps: AiDeps): void {
  // 通用流程：解析 item 上下文 → SSE 流式 → 落 annotation（有 itemId 时）→ done 帧
  async function run(
    reply: FastifyReply,
    input: { text: string; itemId?: string; page?: number | null },
    task: keyof typeof ANNOTATION_TYPE & AiTask,
    messages: ChatMessage[],
    item: ItemRow | null,
  ) {
    const sse = startSse(reply);
    let acc = "";
    const result = await streamTask(db, task, messages, {
      fetchImpl: deps.fetchImpl,
      onDelta: (d) => { acc += d; sse.send({ delta: d }); },
    });
    if (!result.ok) {
      sse.send({ error: result.error });
      sse.end();
      return;
    }
    let annotationId: string | undefined;
    if (item) {
      annotationId = newKey();
      db.prepare("INSERT INTO annotations (id, item_id, type, page, content) VALUES (?, ?, ?, ?, ?)")
        .run(annotationId, item.id, ANNOTATION_TYPE[task], input.page ?? null, acc);
    }
    sse.send({
      done: true,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      ...(annotationId ? { annotation_id: annotationId } : {}),
    });
    sse.end();
  }

  function loadItem(itemId?: string): ItemRow | null | undefined {
    if (!itemId) return null;
    return db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ItemRow | undefined;
  }

  function ctxOf(item: ItemRow | null): PaperContext | undefined {
    return item ? { title: item.title, abstract: item.abstract } : undefined;
  }

  app.post("/api/ai/summarize", async (req, reply) => {
    const parsed = summarizeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    const item = loadItem(parsed.data.itemId);
    if (item === undefined) return reply.code(400).send({ error: "item not found" });
    const messages = summarizeMessages(parsed.data.text, parsed.data.level ?? "brief", ctxOf(item));
    await run(reply, parsed.data, "summarize", messages, item);
  });

  app.post("/api/ai/explain", async (req, reply) => {
    const parsed = explainSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    const item = loadItem(parsed.data.itemId);
    if (item === undefined) return reply.code(400).send({ error: "item not found" });
    const messages = explainMessages(parsed.data.text, parsed.data.level ?? "undergrad", ctxOf(item));
    await run(reply, parsed.data, "explain", messages, item);
  });

  app.post("/api/ai/translate", async (req, reply) => {
    const parsed = translateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    const item = loadItem(parsed.data.itemId);
    if (item === undefined) return reply.code(400).send({ error: "item not found" });
    const messages = translateMessages(parsed.data.text, parsed.data.targetLang ?? "zh", ctxOf(item));
    await run(reply, parsed.data, "translate", messages, item);
  });
}
