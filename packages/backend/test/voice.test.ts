import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { voiceInstructions } from "../src/lib/voice.js";

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.PAPERWEAVE_BUILTIN_KEY;
  delete process.env.PAPERWEAVE_BUILTIN_BASE;
});
afterEach(() => { process.env = { ...savedEnv }; });

interface Capture { url?: string; init?: RequestInit }

function sessionFetch(responseBody: unknown, capture?: Capture, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    return new Response(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function setup(fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), "pw-voice-"));
  const db = openDb(dir);
  db.prepare("INSERT INTO items (id, title, abstract) VALUES ('itm00001', 'Attention Paper', 'We propose the Transformer.')").run();
  const app = buildServer(db, { dataDir: dir, ...(fetchImpl ? { fetchImpl } : {}) });
  return { dir, db, app };
}

describe("voiceInstructions", () => {
  it("injects paper title/abstract, page, and selected text into the system context", () => {
    const s = voiceInstructions({ title: "Attention Paper", abstract: "We propose the Transformer.", page: 3, selectedText: "multi-head attention" });
    expect(s).toContain("Attention Paper");
    expect(s).toContain("We propose the Transformer.");
    expect(s).toContain("3");
    expect(s).toContain("multi-head attention");
  });

  it("works with no context at all", () => {
    const s = voiceInstructions({});
    expect(s.length).toBeGreaterThan(0);
  });
});

describe("POST /api/voice/session", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("mints an ephemeral token via the builtin route and returns url + model", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = {};
    const s = await setup(sessionFetch({ client_secret: { value: "ek_abc" } }, capture));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      client_secret: "ek_abc",
      url: "https://builtin.example/v1/realtime",
      model: "gpt-4o-mini",
    });
    // 后端代理协商：api_key 只在服务端使用，调 {base}/realtime/sessions
    expect(capture.url).toBe("https://builtin.example/v1/realtime/sessions");
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer bk");
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.model).toBe("gpt-4o-mini");
    expect(typeof sent.instructions).toBe("string");
    expect(res.body).not.toContain("bk\"");
    await s.app.close();
    s.db.close();
  });

  it("injects the open paper context (title/abstract/selectedText/page) into instructions", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const capture: Capture = {};
    const s = await setup(sessionFetch({ client_secret: { value: "ek_ctx" } }, capture));
    dir = s.dir;
    const res = await s.app.inject({
      method: "POST",
      url: "/api/voice/session",
      payload: { itemId: "itm00001", page: 2, selectedText: "scaled dot-product attention" },
    });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.instructions).toContain("Attention Paper");
    expect(sent.instructions).toContain("We propose the Transformer.");
    expect(sent.instructions).toContain("scaled dot-product attention");
    await s.app.close();
    s.db.close();
  });

  it("accepts a legacy plain-string client_secret shape", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(sessionFetch({ client_secret: "ek_legacy" }));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ client_secret: "ek_legacy" });
    await s.app.close();
    s.db.close();
  });

  it("uses the task-routed provider (base_url, key, model) when voice is routed", async () => {
    const capture: Capture = {};
    const s = await setup(sessionFetch({ client_secret: { value: "ek_prov" } }, capture));
    dir = s.dir;
    s.db.prepare("INSERT INTO providers (id, kind, label, base_url, api_key, models) VALUES ('prov0001', 'openai', 'My OpenAI', 'https://api.openai.com/v1', 'sk-live', '[\"gpt-4o-realtime-preview\"]')").run();
    s.db.prepare("INSERT INTO task_routes (task, provider_id, model) VALUES ('voice', 'prov0001', NULL)").run();
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      client_secret: "ek_prov",
      url: "https://api.openai.com/v1/realtime",
      model: "gpt-4o-realtime-preview",
    });
    expect(capture.url).toBe("https://api.openai.com/v1/realtime/sessions");
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer sk-live");
    await s.app.close();
    s.db.close();
  });

  it("400s with 未配置语音服务商 when no voice route is configured", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "未配置语音服务商" });
    await s.app.close();
    s.db.close();
  });

  it("400s when the voice route points at a non-OpenAI-compatible provider", async () => {
    const s = await setup();
    dir = s.dir;
    s.db.prepare("INSERT INTO providers (id, kind, label, api_key) VALUES ('prov0001', 'anthropic', 'Claude', 'sk-ant')").run();
    s.db.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('voice', 'prov0001')").run();
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().error)).toMatch(/OpenAI 兼容/);
    await s.app.close();
    s.db.close();
  });

  it("502s when the upstream session negotiation fails", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(sessionFetch({ error: "upstream boom" }, undefined, 500));
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/session", payload: {} });
    expect(res.statusCode).toBe(502);
    expect(String(res.json().error)).toMatch(/500/);
    await s.app.close();
    s.db.close();
  });

  it("400s on extra fields and unknown itemId", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup(sessionFetch({ client_secret: { value: "ek_x" } }));
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/voice/session", payload: { nope: 1 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/session", payload: { itemId: "ghost" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/session", payload: { page: 1.5 } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });
});

describe("POST /api/voice/usage", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("records session duration into usage_log with task=voice", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: 95 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const row = s.db.prepare("SELECT task, model, seconds FROM usage_log").get() as { task: string; model: string; seconds: number };
    expect(row).toEqual({ task: "voice", model: "gpt-4o-mini", seconds: 95 });
    await s.app.close();
    s.db.close();
  });

  it("still records usage when no voice route is configured (provider/model null)", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: 12 } });
    expect(res.statusCode).toBe(200);
    const row = s.db.prepare("SELECT task, provider_id, model, seconds FROM usage_log").get() as { task: string; provider_id: string | null; model: string | null; seconds: number };
    expect(row).toEqual({ task: "voice", provider_id: null, model: null, seconds: 12 });
    await s.app.close();
    s.db.close();
  });

  it("400s on missing, non-positive, or extra fields", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: 0 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: -3 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: 1.5 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: "/api/voice/usage", payload: { seconds: 10, extra: 1 } })).statusCode).toBe(400);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM usage_log").get()).toEqual({ n: 0 });
    await s.app.close();
    s.db.close();
  });
});
