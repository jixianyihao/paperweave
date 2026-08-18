import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { newKey } from "../lib/keys.js";
import { startSse } from "../lib/sse.js";
import { streamTask } from "../lib/llm/router.js";
import { extractPages, chunkPages } from "../lib/chunking.js";
import { embedTexts, vectorToBlob, blobToVector } from "../lib/embedding.js";
import { topK, fullTextQaMessages, parseCitations } from "../lib/ask.js";
import type { FetchLike } from "../lib/metadata.js";
import type { ItemRow } from "./items.js";

export interface AskDeps {
  dataDir: string;
  fetchImpl: FetchLike;
}

const askSchema = z.object({ question: z.string().min(1) }).strict();

const TOP_K = 8;

interface ChunkRow {
  id: string;
  item_id: string;
  page: number;
  chunk_index: number;
  text: string;
  embedding: Buffer | null;
}

function loadChunks(db: Database.Database, itemId: string): ChunkRow[] {
  return db.prepare("SELECT * FROM chunks WHERE item_id = ? ORDER BY page, chunk_index").all(itemId) as ChunkRow[];
}

// 懒构建：首次 ask 时抽取全文 → 切块（embedding 一律先置 NULL，由路由层统一嵌入/回填）
async function ensureChunks(
  db: Database.Database,
  item: ItemRow,
  deps: AskDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE item_id = ?").get(item.id) as { n: number };
  if (n > 0) return { ok: true };
  if (!item.file_path || item.file_path !== `files/${item.id}.pdf`) {
    return { ok: false, error: "item 没有 PDF 文件，全文问答不可用" };
  }
  const abs = join(deps.dataDir, item.file_path);
  if (!existsSync(abs)) return { ok: false, error: "item 没有 PDF 文件，全文问答不可用" };
  const pages = await extractPages(new Uint8Array(readFileSync(abs)));
  const drafts = chunkPages(pages);
  if (drafts.length === 0) return { ok: false, error: "无法从 PDF 提取文本，全文问答不可用" };
  const insert = db.prepare("INSERT INTO chunks (id, item_id, page, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, NULL)");
  // better-sqlite3 事务同步执行：事务内复查 COUNT，杜绝并发首次 ask 双倍插入
  db.transaction(() => {
    const again = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE item_id = ?").get(item.id) as { n: number };
    if (again.n > 0) return;
    drafts.forEach((d) => { insert.run(newKey(), item.id, d.page, d.chunkIndex, d.text); });
  })();
  return { ok: true };
}

export function registerAskRoutes(app: FastifyInstance, db: Database.Database, deps: AskDeps): void {
  app.post("/api/items/:id/ask", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", details: parsed.error.issues });
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!item) return reply.code(404).send({ error: "item not found" });
    const { question } = parsed.data;

    const sse = startSse(reply);
    const built = await ensureChunks(db, item, deps);
    if (!built.ok) {
      sse.send({ error: built.error });
      sse.end();
      return;
    }

    // chunks 已有但 embedding 为 NULL：尝试嵌入/回填；失败按原因发错误帧（保留 NULL 块以便重试）
    let rows = loadChunks(db, id);
    if (rows.some((r) => r.embedding === null)) {
      const embedded = await embedTexts(db, rows.map((r) => r.text), { fetchImpl: deps.fetchImpl });
      if (!embedded.ok) {
        sse.send({ error: embedded.error });
        sse.end();
        return;
      }
      const update = db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?");
      db.transaction(() => {
        rows.forEach((r, i) => { update.run(vectorToBlob(embedded.vectors[i]), r.id); });
      })();
      rows = loadChunks(db, id);
    }

    const qEmbed = await embedTexts(db, [question], { fetchImpl: deps.fetchImpl });
    if (!qEmbed.ok) {
      sse.send({ error: qEmbed.error });
      sse.end();
      return;
    }

    const chunks = rows.map((r) => ({ page: r.page, text: r.text, embedding: blobToVector(r.embedding!) }));
    const top = topK(chunks, qEmbed.vectors[0], TOP_K);

    // 检索成功后才落 conversation + user message
    const convId = newKey();
    db.prepare("INSERT INTO conversations (id, annotation_id, item_id) VALUES (?, NULL, ?)").run(convId, id);
    db.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)")
      .run(newKey(), convId, question);

    let acc = "";
    const result = await streamTask(db, "qa", fullTextQaMessages(question, top), {
      fetchImpl: deps.fetchImpl,
      onDelta: (d) => { acc += d; sse.send({ delta: d }); },
      onThinking: (d) => { sse.send({ thinking: d }); },
    });
    if (!result.ok) {
      sse.send({ error: result.error });
      sse.end();
      return;
    }

    const citations = parseCitations(acc, top);
    const messageId = newKey();
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, citations) VALUES (?, ?, 'assistant', ?, ?)")
      .run(messageId, convId, acc, JSON.stringify(citations));
    sse.send({
      done: true,
      message_id: messageId,
      citations,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
    });
    sse.end();
  });
}
