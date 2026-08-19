import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

const savedEnv = { ...process.env };

function sseBody(deltas: string[], usage?: { in: number; out: number }): string {
  const frames = deltas.map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}`).join("\n\n");
  const usageFrame = usage ? `\n\ndata: {"choices":[],"usage":{"prompt_tokens":${usage.in},"completion_tokens":${usage.out}}}` : "";
  return `${frames}${usageFrame}\n\ndata: [DONE]\n\n`;
}

function fakeLlmFetch(body: string, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

function parseSse(text: string): Record<string, unknown>[] {
  return text.split("\n\n").filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, "")) as Record<string, unknown>);
}

beforeEach(() => {
  delete process.env.PAPERWEAVE_BUILTIN_KEY;
  delete process.env.PAPERWEAVE_BUILTIN_BASE;
});
afterEach(() => { process.env = { ...savedEnv }; });

async function setup(fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  db.prepare("INSERT INTO items (id, title, abstract) VALUES ('itm00001', 'Attention Paper', 'We propose the Transformer.')").run();
  const app = buildServer(db, { dataDir: dir, ...(fetchImpl ? { fetchImpl } : {}) });
  return { dir, db, app };
}

describe("POST /api/annotations/:id/messages", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("streams the assistant reply via SSE and persists both messages", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(fakeLlmFetch(sseBody(["它是", "一种架构"], { in: 12, out: 6 })));
    dir = s.dir;
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'highlight', 'The Transformer')").run();
    const res = await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: { content: "这是什么？" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = parseSse(res.body);
    expect(frames.slice(0, 2)).toEqual([{ delta: "它是" }, { delta: "一种架构" }]);
    expect(frames.at(-1)).toMatchObject({ done: true, tokens_in: 12, tokens_out: 6 });

    const conv = s.db.prepare("SELECT * FROM conversations WHERE annotation_id = 'ann1'").get() as { id: string; item_id: string };
    expect(conv.item_id).toBe("itm00001");
    const msgs = s.db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conv.id) as { role: string; content: string }[];
    expect(msgs).toEqual([{ role: "user", content: "这是什么？" }, { role: "assistant", content: "它是一种架构" }]);
    await s.app.close();
    s.db.close();
  });

  it("reuses the existing conversation and passes history to the llm", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: { url?: string; init?: RequestInit } = {};
    const s = await setup(fakeLlmFetch(sseBody(["ok"]), capture));
    dir = s.dir;
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'highlight', 'hl text')").run();
    await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: { content: "first" } });
    await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: { content: "second" } });
    const convs = s.db.prepare("SELECT id FROM conversations WHERE annotation_id = 'ann1'").all();
    expect(convs).toHaveLength(1);
    const body = JSON.parse(String(capture.init?.body));
    const contents = body.messages.map((m: { content: string }) => m.content);
    expect(contents).toContain("first");
    expect(contents).toContain("second");
    expect(contents[contents.length - 1]).toBe("second");
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when no model is configured (and still stores the user message)", async () => {
    const s = await setup();
    dir = s.dir;
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'note', 'note text')").run();
    const res = await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: { content: "hi" } });
    expect(res.statusCode).toBe(200);
    const frames = parseSse(res.body);
    expect(frames).toEqual([{ error: "未配置模型，请在设置中添加服务商" }]);
    const userMsgs = s.db.prepare("SELECT role FROM messages").all() as { role: string }[];
    expect(userMsgs.map((m) => m.role)).toEqual(["user"]);
    await s.app.close();
    s.db.close();
  });

  it("404s on missing annotation, 400s on invalid body", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/annotations/nope/messages", payload: { content: "x" } })).statusCode).toBe(404);
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'note', 'n')").run();
    expect((await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/annotations/ann1/messages", payload: { content: "x", extra: 1 } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });
});

describe("POST /api/ai/summarize|explain|translate", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("summarize streams deltas, writes usage_log, and stores an ai_summary annotation when itemId given", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: { url?: string; init?: RequestInit } = {};
    const s = await setup(fakeLlmFetch(sseBody(["一句话总结"], { in: 100, out: 20 }), capture));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "Long passage...", level: "brief", itemId: "itm00001", page: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = parseSse(res.body);
    expect(frames[0]).toEqual({ delta: "一句话总结" });
    expect(frames.at(-1)).toMatchObject({ done: true, tokens_in: 100, tokens_out: 20 });
    expect(frames.at(-1)).toHaveProperty("annotation_id");

    const anns = s.db.prepare("SELECT * FROM annotations WHERE item_id = 'itm00001'").all() as { type: string; content: string; page: number }[];
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({ type: "ai_summary", content: "一句话总结", page: 3 });

    const log = s.db.prepare("SELECT task FROM usage_log").all() as { task: string }[];
    expect(log).toEqual([{ task: "summarize" }]);

    // prompt 注入了论文标题/摘要上下文
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.messages[1].content).toContain("Attention Paper");
    expect(sent.messages[1].content).toContain("We propose the Transformer.");
    await s.app.close();
    s.db.close();
  });

  it("explain passes the difficulty level into the prompt and stores ai_explain", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: { url?: string; init?: RequestInit } = {};
    const s = await setup(fakeLlmFetch(sseBody(["easy"], { in: 1, out: 1 }), capture));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/explain", payload: { text: "Hard passage", level: "eli5", itemId: "itm00001" } });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.messages[0].content).toMatch(/five-year-old/);
    const ann = s.db.prepare("SELECT type, content FROM annotations WHERE item_id = 'itm00001'").get() as { type: string; content: string };
    expect(ann).toEqual({ type: "ai_explain", content: "easy" });
    await s.app.close();
    s.db.close();
  });

  it("translate targets Chinese by default and stores ai_translate", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: { url?: string; init?: RequestInit } = {};
    const s = await setup(fakeLlmFetch(sseBody(["翻译结果"], { in: 5, out: 5 }), capture));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/translate", payload: { text: "Some english", itemId: "itm00001" } });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.messages[0].content).toMatch(/Chinese/);
    expect(s.db.prepare("SELECT type FROM annotations WHERE item_id = 'itm00001'").get()).toEqual({ type: "ai_translate" });
    await s.app.close();
    s.db.close();
  });

  it("works without itemId (no annotation created)", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(fakeLlmFetch(sseBody(["x"], { in: 1, out: 1 })));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "passage" } });
    expect(res.statusCode).toBe(200);
    const frames = parseSse(res.body);
    expect(frames.at(-1)).toMatchObject({ done: true });
    expect(frames.at(-1)).not.toHaveProperty("annotation_id");
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM annotations").get()).toEqual({ n: 0 });
    await s.app.close();
    s.db.close();
  });

  it("explain-image builds a multimodal message and stores ai_explain", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: { url?: string; init?: RequestInit } = {};
    const s = await setup(fakeLlmFetch(sseBody(["图中是模型架构"], { in: 5, out: 6 }), capture));
    dir = s.dir;
    const res = await s.app.inject({
      method: "POST",
      url: "/api/ai/explain-image",
      payload: { image: "data:image/png;base64,iVBORw0KGgo=", level: "grad", itemId: "itm00001", page: 4 },
    });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(String(capture.init?.body));
    const userContent = sent.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0].type).toBe("text");
    expect(userContent[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } });
    expect(String(sent.messages[0].content)).toMatch(/figure, table, or formula/);
    const ann = s.db.prepare("SELECT type, content, page FROM annotations WHERE item_id = 'itm00001'").get() as { type: string; content: string; page: number };
    expect(ann).toEqual({ type: "ai_explain", content: "图中是模型架构", page: 4 });
    await s.app.close();
    s.db.close();
  });

  it("explain-image 400s on non-image data or missing image", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/ai/explain-image", payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/explain-image", payload: { image: "https://x.com/a.png" } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("400s on invalid body, unknown fields, bad level, unknown itemId", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "t", level: "detailed" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "t", nope: 1 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "t", itemId: "ghost" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/explain", payload: { text: "t", level: "phd" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/ai/translate", payload: { text: "t", targetLang: "fr" } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when no model is configured", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "passage" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(parseSse(res.body)).toEqual([{ error: "未配置模型，请在设置中添加服务商" }]);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM usage_log").get()).toEqual({ n: 0 });
    await s.app.close();
    s.db.close();
  });

  it("sends an error frame when the upstream fails mid-request", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const failing = (async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;
    const s = await setup(failing);
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/ai/translate", payload: { text: "t" } });
    const frames = parseSse(res.body);
    expect(frames).toHaveLength(1);
    expect(String(frames[0].error)).toMatch(/502/);
    await s.app.close();
    s.db.close();
  });
});
