import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { resolveRoute, streamTask, BUILTIN_UNCONFIGURED, AI_TASKS } from "../src/lib/llm/router.js";
import { summarizeMessages, explainMessages, translateMessages, qaMessages } from "../src/lib/llm/prompts.js";

describe("llm router", () => {
  let dir = "";
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.PAPERWEAVE_BUILTIN_KEY;
    delete process.env.PAPERWEAVE_BUILTIN_BASE;
    delete process.env.PAPERWEAVE_BUILTIN_MODEL;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  function db() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    return openDb(dir);
  }

  it("returns a clear error when builtin is unconfigured", () => {
    const d = db();
    const res = resolveRoute(d, "summarize");
    expect(res).toEqual({ ok: false, error: BUILTIN_UNCONFIGURED });
    d.close();
  });

  it("resolves builtin from env vars as openai-compatible", () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const d = db();
    const res = resolveRoute(d, "qa");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.llm).toMatchObject({ client: "openai", baseUrl: "https://builtin.example/v1", apiKey: "bk", providerId: null });
    }
    d.close();
  });

  it("prefers the task_routes provider over builtin", () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const d = db();
    d.prepare("INSERT INTO providers (id, kind, label, base_url, api_key, models) VALUES ('p1', 'custom', 'DeepSeek', 'https://api.deepseek.com/v1', 'sk-ds', '[\"deepseek-chat\"]')").run();
    d.prepare("INSERT INTO task_routes (task, provider_id, model) VALUES ('summarize', 'p1', NULL)").run();
    const res = resolveRoute(d, "summarize");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.llm).toMatchObject({ client: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", providerId: "p1" });
    }
    d.close();
  });

  it("route model overrides provider models list", () => {
    const d = db();
    d.prepare("INSERT INTO providers (id, kind, label, api_key, models) VALUES ('p2', 'openai', 'OA', 'sk', '[\"gpt-4o\"]')").run();
    d.prepare("INSERT INTO task_routes (task, provider_id, model) VALUES ('translate', 'p2', 'gpt-4o-mini')").run();
    const res = resolveRoute(d, "translate");
    expect(res.ok && res.llm.model).toBe("gpt-4o-mini");
    d.close();
  });

  it("errors on disabled provider and unknown provider reference", () => {
    const d = db();
    d.prepare("INSERT INTO providers (id, kind, label, api_key, enabled) VALUES ('p3', 'openai', 'Off', 'sk', 0)").run();
    d.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('explain', 'p3')").run();
    expect(resolveRoute(d, "explain").ok).toBe(false);
    d.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('voice', 'ghost')").run();
    expect(resolveRoute(d, "voice").ok).toBe(false);
    d.close();
  });

  it("resolves anthropic providers to the anthropic client", () => {
    const d = db();
    d.prepare("INSERT INTO providers (id, kind, label, api_key) VALUES ('p4', 'anthropic', 'Claude', 'sk-ant')").run();
    d.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('qa', 'p4')").run();
    const res = resolveRoute(d, "qa");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.llm.client).toBe("anthropic");
      expect(res.llm.baseUrl).toBe("https://api.anthropic.com");
    }
    d.close();
  });

  it("streamTask streams deltas and writes usage_log", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const d = db();
    const sse = [
      'data: {"choices":[{"delta":{"content":"答"}}]}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const fetchImpl = (async () => new Response(sse, { status: 200 })) as unknown as typeof fetch;
    const deltas: string[] = [];
    const res = await streamTask(d, "summarize", [{ role: "user", content: "hi" }], { fetchImpl, onDelta: (x) => deltas.push(x) });
    expect(res).toMatchObject({ ok: true, tokensIn: 3, tokensOut: 5 });
    expect(deltas).toEqual(["答"]);
    const log = d.prepare("SELECT * FROM usage_log").all() as { task: string; tokens_in: number; tokens_out: number }[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ task: "summarize", tokens_in: 3, tokens_out: 5 });
    d.close();
  });

  it("streamTask returns the unconfigured error without calling fetch", async () => {
    const d = db();
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response(); }) as unknown as typeof fetch;
    const res = await streamTask(d, "explain", [{ role: "user", content: "hi" }], { fetchImpl, onDelta: () => {} });
    expect(res).toEqual({ ok: false, error: BUILTIN_UNCONFIGURED });
    expect(called).toBe(false);
    d.close();
  });

  it("streamTask surfaces upstream errors as { ok: false }", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const d = db();
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const res = await streamTask(d, "translate", [{ role: "user", content: "hi" }], { fetchImpl, onDelta: () => {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/500/);
    d.close();
  });

  it("AI_TASKS covers the six contract tasks", () => {
    expect([...AI_TASKS].sort()).toEqual(["embedding", "explain", "qa", "summarize", "translate", "voice"]);
  });
});

describe("prompt templates", () => {
  it("summarize brief asks for one sentence, bullets asks for key points", () => {
    const brief = summarizeMessages("Passage.", "brief");
    expect(brief[0].content).toMatch(/one single sentence/i);
    const bullets = summarizeMessages("Passage.", "bullets");
    expect(bullets[0].content).toMatch(/bullet/i);
    expect(bullets[1].content).toContain("Passage.");
  });

  it("explain has four difficulty levels", () => {
    for (const level of ["eli5", "undergrad", "grad", "expert"] as const) {
      const msgs = explainMessages("Passage.", level);
      expect(msgs[0].role).toBe("system");
      expect(msgs[1].content).toContain("Passage.");
    }
    expect(explainMessages("x", "eli5")[0].content).not.toBe(explainMessages("x", "expert")[0].content);
  });

  it("translate targets zh or en", () => {
    expect(translateMessages("Hello", "zh")[0].content).toMatch(/Chinese/);
    expect(translateMessages("你好", "en")[0].content).toMatch(/English/);
  });

  it("injects paper title and abstract as context when provided", () => {
    const msgs = summarizeMessages("Passage.", "brief", { title: "Attention Is All You Need", abstract: "We propose..." });
    expect(msgs[1].content).toContain("Attention Is All You Need");
    expect(msgs[1].content).toContain("We propose...");
  });

  it("qaMessages carries the selected passage and history", () => {
    const msgs = qaMessages("selected text", [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
    expect(msgs[1].content).toContain("selected text");
    expect(msgs.slice(-2).map((m) => m.content)).toEqual(["q1", "a1"]);
  });
});
