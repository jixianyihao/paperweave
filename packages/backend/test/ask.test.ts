import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { EMBEDDING_UNCONFIGURED } from "../src/lib/embedding.js";

const savedEnv = { ...process.env };
const samplePdf = join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf");

beforeEach(() => {
  delete process.env.PAPERWEAVE_BUILTIN_KEY;
  delete process.env.PAPERWEAVE_BUILTIN_BASE;
});
afterEach(() => { process.env = { ...savedEnv }; });

function sseBody(deltas: string[], usage?: { in: number; out: number }): string {
  const frames = deltas.map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}`).join("\n\n");
  const usageFrame = usage ? `\n\ndata: {"choices":[],"usage":{"prompt_tokens":${usage.in},"completion_tokens":${usage.out}}}` : "";
  return `${frames}${usageFrame}\n\ndata: [DONE]\n\n`;
}

function vowelEmbed(texts: string[]): number[][] {
  return texts.map((t) => {
    const s = t.toLowerCase();
    return ["a", "e", "i", "o", "u"].map((v) => s.split(v).length - 1);
  });
}

interface Capture { embedInputs: string[][]; chatBodies: { messages: { role: string; content: string }[] }[] }

// fake fetch：/embeddings 返回元音计数向量；/chat/completions 引用 prompt 中第一个 [Pn] 标记
function fakeAskFetch(capture: Capture): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      capture.embedInputs.push(body.input);
      return new Response(JSON.stringify({
        data: vowelEmbed(body.input).map((embedding, index) => ({ embedding, index })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body)) as Capture["chatBodies"][number];
    capture.chatBodies.push(body);
    const m = body.messages.at(-1)!.content.match(/\[P(\d+)\]/);
    const page = m ? m[1] : "1";
    return new Response(sseBody(["依据原文", `[P${page}]`, "可得出结论。"], { in: 50, out: 9 }), {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

function parseSse(text: string): Record<string, unknown>[] {
  return text.split("\n\n").filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, "")) as Record<string, unknown>);
}

async function setup(fetchImpl?: typeof fetch, opts: { withPdf?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  const filePath = opts.withPdf === false ? null : "files/itm00001.pdf";
  db.prepare("INSERT INTO items (id, title, abstract, file_path) VALUES ('itm00001', 'Attention Paper', 'We propose the Transformer.', ?)").run(filePath);
  if (filePath) copyFileSync(samplePdf, join(dir, filePath));
  const app = buildServer(db, { dataDir: dir, ...(fetchImpl ? { fetchImpl } : {}) });
  return { dir, db, app };
}

describe("POST /api/items/:id/ask", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("builds chunks lazily, streams the answer, parses citations, and persists everything", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = { embedInputs: [], chatBodies: [] };
    const s = await setup(fakeAskFetch(capture));
    dir = s.dir;

    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "什么是注意力机制？" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = parseSse(res.body);
    expect(frames[0]).toEqual({ delta: "依据原文" });
    expect(String(frames[1].delta)).toMatch(/^\[P\d+\]$/);
    expect(frames[2]).toEqual({ delta: "可得出结论。" });
    const done = frames.at(-1)!;
    expect(done.done).toBe(true);
    expect(done.tokens_in).toBe(50);
    expect(done.tokens_out).toBe(9);
    expect(typeof done.message_id).toBe("string");
    const citations = done.citations as { page: number; quote: string }[];
    expect(citations).toHaveLength(1);
    expect(citations[0].page).toBeGreaterThanOrEqual(1);
    expect(citations[0].quote.length).toBeGreaterThan(0);

    // chunks 懒构建并带 embedding
    const chunks = s.db.prepare("SELECT page, chunk_index, text, embedding FROM chunks WHERE item_id = 'itm00001' ORDER BY page, chunk_index").all() as { page: number; chunk_index: number; text: string; embedding: Buffer | null }[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding !== null)).toBe(true);
    expect(chunks.some((c) => c.text.includes("Attention"))).toBe(true);

    // 检索 top-8 注入 prompt，带引用指令
    const chat = capture.chatBodies[0];
    expect(chat.messages[0].content).toContain("[P");
    const userMsg = chat.messages.at(-1)!.content;
    expect(userMsg).toContain("Question: 什么是注意力机制？");
    expect(userMsg).toContain(`[P${citations[0].page}]`);

    // conversations/messages 落库，citations JSON 一致
    const conv = s.db.prepare("SELECT * FROM conversations WHERE item_id = 'itm00001'").get() as { id: string; annotation_id: string | null };
    expect(conv.annotation_id).toBeNull();
    const msgs = s.db.prepare("SELECT role, content, citations FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conv.id) as { role: string; content: string; citations: string | null }[];
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: "user", content: "什么是注意力机制？", citations: null });
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("依据原文[P" + citations[0].page + "]可得出结论。");
    expect(JSON.parse(msgs[1].citations!)).toEqual(citations);

    // usage_log：embedding（建块+问题）+ qa
    const tasks = s.db.prepare("SELECT task FROM usage_log ORDER BY id").all() as { task: string }[];
    expect(tasks).toEqual([{ task: "embedding" }, { task: "embedding" }, { task: "qa" }]);
    await s.app.close();
    s.db.close();
  });

  it("reuses existing chunks on the second ask (no re-extract, question-only embedding)", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = { embedInputs: [], chatBodies: [] };
    const s = await setup(fakeAskFetch(capture));
    dir = s.dir;
    await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q1" } });
    expect(capture.embedInputs).toHaveLength(2); // 建块一批 + 问题
    const nChunks = (s.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
    await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q2" } });
    expect(capture.embedInputs).toHaveLength(3); // 仅问题
    expect(capture.embedInputs[2]).toEqual(["q2"]);
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n).toBe(nChunks);
    // 两次 ask 各建一个 conversation
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE item_id = 'itm00001'").get() as { n: number }).n).toBe(2);
    await s.app.close();
    s.db.close();
  });

  it("backfills embeddings when chunks exist without them but a route is now configured", async () => {
    const s = await setup();
    dir = s.dir;
    // 先未配置：chunks 建成 NULL embedding，ask 报错
    const res1 = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    expect(parseSse(res1.body)).toEqual([{ error: EMBEDDING_UNCONFIGURED }]);
    const nullBefore = s.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NULL").get() as { n: number };
    expect(nullBefore.n).toBeGreaterThan(0);
    // 配置后：ask 回填 embedding 并正常作答
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = { embedInputs: [], chatBodies: [] };
    const s2app = buildServer(s.db, { dataDir: s.dir, fetchImpl: fakeAskFetch(capture) });
    const res2 = await s2app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    expect(parseSse(res2.body).at(-1)).toMatchObject({ done: true });
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NULL").get() as { n: number }).n).toBe(0);
    await s2app.close();
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when embedding is unconfigured and stores NULL embeddings", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body)).toEqual([{ error: EMBEDDING_UNCONFIGURED }]);
    const chunks = s.db.prepare("SELECT embedding FROM chunks WHERE item_id = 'itm00001'").all() as { embedding: Buffer | null }[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n).toBe(0);
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM usage_log").get() as { n: number }).n).toBe(0);
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when the item has no pdf", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(fakeAskFetch({ embedInputs: [], chatBodies: [] }), { withPdf: false });
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    const frames = parseSse(res.body);
    expect(frames).toHaveLength(1);
    expect(String(frames[0].error)).toContain("PDF");
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when the pdf has no extractable text", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const dir0 = mkdtempSync(join(tmpdir(), "pw-test-"));
    dir = dir0;
    const db = openDb(dir0);
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00001', 't', 'files/itm00001.pdf')").run();
    writeFileSync(join(dir0, "files/itm00001.pdf"), readFileSync(samplePdf).subarray(0, 64));
    const app = buildServer(db, { dataDir: dir0, fetchImpl: fakeAskFetch({ embedInputs: [], chatBodies: [] }) });
    const res = await app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    const frames = parseSse(res.body);
    expect(frames).toHaveLength(1);
    expect(String(frames[0].error)).toContain("文本");
    expect((db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n).toBe(0);
    await app.close();
    db.close();
  });

  it("404s on unknown item, 400s on invalid body", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/items/ghost/ask", payload: { question: "q" } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q", extra: 1 } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("builds chunks only once when two first asks race", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = { embedInputs: [], chatBodies: [] };
    const s = await setup(fakeAskFetch(capture));
    dir = s.dir;
    const [r1, r2] = await Promise.all([
      s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q1" } }),
      s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q2" } }),
    ]);
    expect(parseSse(r1.body).at(-1)).toMatchObject({ done: true });
    expect(parseSse(r2.body).at(-1)).toMatchObject({ done: true });
    // 无双倍插入：每个 (page, chunk_index) 唯一
    const total = (s.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE item_id = 'itm00001'").get() as { n: number }).n;
    const distinct = (s.db.prepare("SELECT COUNT(DISTINCT page || '-' || chunk_index) AS n FROM chunks WHERE item_id = 'itm00001'").get() as { n: number }).n;
    expect(total).toBeGreaterThan(0);
    expect(total).toBe(distinct);
    await s.app.close();
    s.db.close();
  });

  it("surfaces the real upstream error when embedding fails transiently, keeping NULL chunks for retry", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const failing = (async (url: unknown) => {
      if (String(url).endsWith("/embeddings")) return new Response("rate limited", { status: 429 });
      throw new Error("chat should not be reached");
    }) as unknown as typeof fetch;
    const s = await setup(failing);
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    const frames = parseSse(res.body);
    expect(frames).toHaveLength(1);
    expect(String(frames[0].error)).toMatch(/429/);
    expect(String(frames[0].error)).not.toContain("未配置");
    // chunks 保留（embedding 为 NULL）以便重试
    const chunks = s.db.prepare("SELECT embedding FROM chunks WHERE item_id = 'itm00001'").all() as { embedding: Buffer | null }[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
    // 上游恢复后重试成功并回填
    const capture: Capture = { embedInputs: [], chatBodies: [] };
    const app2 = buildServer(s.db, { dataDir: s.dir, fetchImpl: fakeAskFetch(capture) });
    const res2 = await app2.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    expect(parseSse(res2.body).at(-1)).toMatchObject({ done: true });
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NULL").get() as { n: number }).n).toBe(0);
    await app2.close();
    await s.app.close();
    s.db.close();
  });

  it("streams an error frame when the qa model is unconfigured but embeddings work", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(fakeAskFetch({ embedInputs: [], chatBodies: [] }));
    dir = s.dir;
    // qa 路由到 disabled provider
    s.db.prepare("INSERT INTO providers (id, kind, label, enabled) VALUES ('p1', 'openai', 'Off', 0)").run();
    s.db.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('qa', 'p1')").run();
    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/ask", payload: { question: "q" } });
    const frames = parseSse(res.body);
    expect(String(frames.at(-1)!.error)).toContain("disabled");
    await s.app.close();
    s.db.close();
  });
});
