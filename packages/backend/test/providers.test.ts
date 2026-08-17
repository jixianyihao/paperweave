import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

const savedEnv = { ...process.env };

async function setup(fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  const app = buildServer(db, { dataDir: dir, ...(fetchImpl ? { fetchImpl } : {}) });
  return { dir, db, app };
}

beforeEach(() => {
  delete process.env.PAPERWEAVE_BUILTIN_KEY;
  delete process.env.PAPERWEAVE_BUILTIN_BASE;
});

afterEach(() => { process.env = { ...savedEnv }; });

describe("providers CRUD", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("creates a provider and lists it without exposing api_key", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({
      method: "POST", url: "/api/providers",
      payload: { kind: "custom", label: "我的 DeepSeek", base_url: "https://api.deepseek.com/v1", api_key: "sk-secret", models: ["deepseek-chat"] },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body).toMatchObject({ kind: "custom", label: "我的 DeepSeek", base_url: "https://api.deepseek.com/v1", has_key: true, enabled: 1 });
    expect(JSON.parse(body.models)).toEqual(["deepseek-chat"]);
    expect(body).not.toHaveProperty("api_key");

    const list = await s.app.inject({ method: "GET", url: "/api/providers" });
    expect(list.statusCode).toBe(200);
    const providers = list.json() as Record<string, unknown>[];
    expect(providers).toHaveLength(1);
    expect(providers[0]).not.toHaveProperty("api_key");
    expect(providers[0].has_key).toBe(true);
    await s.app.close();
    s.db.close();
  });

  it("has_key is false when no key given", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA" } });
    expect(res.json().has_key).toBe(false);
    await s.app.close();
    s.db.close();
  });

  it("400s when custom provider lacks base_url", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "custom", label: "X" } });
    expect(res.statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("400s on unknown fields (zod strict)", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA", surprise: true } });
    expect(res.statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("patches label/models/enabled and clears the key with null", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA", api_key: "sk-1" } });
    const id = created.json().id as string;
    const patched = await s.app.inject({ method: "PATCH", url: `/api/providers/${id}`, payload: { label: "OA2", enabled: 0, api_key: null, models: ["gpt-4o"] } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ label: "OA2", enabled: 0, has_key: false });
    expect(JSON.parse(patched.json().models)).toEqual(["gpt-4o"]);
    expect(s.db.prepare("SELECT api_key FROM providers WHERE id = ?").get(id)).toEqual({ api_key: null });
    await s.app.close();
    s.db.close();
  });

  it("patch 400s on empty body and 404s on missing provider", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA" } });
    const id = created.json().id as string;
    expect((await s.app.inject({ method: "PATCH", url: `/api/providers/${id}`, payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: `/api/providers/${id}`, payload: { kind: "custom" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: "/api/providers/nope", payload: { label: "x" } })).statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });

  it("deletes a provider and clears task_routes referencing it", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA" } });
    const id = created.json().id as string;
    s.db.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('summarize', ?)").run(id);
    expect((await s.app.inject({ method: "DELETE", url: `/api/providers/${id}` })).statusCode).toBe(204);
    expect((await s.app.inject({ method: "DELETE", url: `/api/providers/${id}` })).statusCode).toBe(404);
    expect(s.db.prepare("SELECT provider_id FROM task_routes WHERE task = 'summarize'").get()).toEqual({ provider_id: null });
    await s.app.close();
    s.db.close();
  });
});

describe("POST /api/providers/:id/test", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns ok:true when the provider answers a 1-token ping", async () => {
    const fetchImpl = (async () => new Response('{"choices":[{"message":{"content":"p"}}]}', { status: 200 })) as unknown as typeof fetch;
    const s = await setup(fetchImpl);
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "custom", label: "DS", base_url: "https://api.deepseek.com/v1", api_key: "sk", models: ["deepseek-chat"] } });
    const res = await s.app.inject({ method: "POST", url: `/api/providers/${created.json().id}/test` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await s.app.close();
    s.db.close();
  });

  it("returns ok:false with error on upstream failure", async () => {
    const fetchImpl = (async () => new Response("invalid key", { status: 401 })) as unknown as typeof fetch;
    const s = await setup(fetchImpl);
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA", api_key: "bad" } });
    const res = await s.app.inject({ method: "POST", url: `/api/providers/${created.json().id}/test` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toMatch(/401/);
    await s.app.close();
    s.db.close();
  });

  it("returns ok:false with the unconfigured error for builtin without env", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "builtin", label: "内置" } });
    const res = await s.app.inject({ method: "POST", url: `/api/providers/${created.json().id}/test` });
    expect(res.json()).toEqual({ ok: false, error: "未配置模型，请在设置中添加服务商" });
    await s.app.close();
    s.db.close();
  });

  it("404s on missing provider", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "POST", url: "/api/providers/nope/test" })).statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });
});

describe("task routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("GET returns all six tasks defaulting to null/null", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "GET", url: "/api/task-routes" });
    expect(res.statusCode).toBe(200);
    const routes = res.json() as { task: string; provider_id: string | null; model: string | null }[];
    expect(routes).toHaveLength(6);
    expect(routes.map((r) => r.task)).toEqual(["translate", "summarize", "explain", "qa", "voice", "embedding"]);
    for (const r of routes) expect(r).toMatchObject({ provider_id: null, model: null });
    await s.app.close();
    s.db.close();
  });

  it("PATCH upserts a route", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/providers", payload: { kind: "openai", label: "OA" } });
    const pid = created.json().id as string;
    const res = await s.app.inject({ method: "PATCH", url: "/api/task-routes", payload: { task: "summarize", provider_id: pid, model: "gpt-4o" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ task: "summarize", provider_id: pid, model: "gpt-4o" });
    const again = await s.app.inject({ method: "PATCH", url: "/api/task-routes", payload: { task: "summarize", provider_id: null, model: null } });
    expect(again.json()).toEqual({ task: "summarize", provider_id: null, model: null });
    const list = (await s.app.inject({ method: "GET", url: "/api/task-routes" })).json() as { task: string; provider_id: string | null }[];
    expect(list.find((r) => r.task === "summarize")?.provider_id).toBeNull();
    await s.app.close();
    s.db.close();
  });

  it("PATCH 400s on bad task, unknown provider, unknown fields", async () => {
    const s = await setup();
    dir = s.dir;
    expect((await s.app.inject({ method: "PATCH", url: "/api/task-routes", payload: { task: "nope", provider_id: null, model: null } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: "/api/task-routes", payload: { task: "qa", provider_id: "ghost", model: null } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: "/api/task-routes", payload: { task: "qa", provider_id: null, model: null, x: 1 } })).statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });
});

describe("GET /api/usage", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("aggregates today/month totals and per-task breakdown", async () => {
    const s = await setup();
    dir = s.dir;
    const ins = s.db.prepare("INSERT INTO usage_log (task, provider_id, model, tokens_in, tokens_out, created_at) VALUES (?, NULL, 'm', ?, ?, ?)");
    ins.run("summarize", 100, 50, new Date().toISOString().slice(0, 19).replace("T", " "));
    ins.run("summarize", 200, 100, new Date().toISOString().slice(0, 19).replace("T", " "));
    ins.run("qa", 10, 5, new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 19).replace("T", " "));
    const res = await s.app.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { today_tokens: number; month_tokens: number; by_task: { task: string; tokens: number }[] };
    expect(body.today_tokens).toBe(450);
    expect(body.month_tokens).toBe(450);
    expect(body.by_task).toEqual([{ task: "summarize", tokens: 450 }]);
    await s.app.close();
    s.db.close();
  });

  it("returns zeros on empty log", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "GET", url: "/api/usage" });
    expect(res.json()).toEqual({ today_tokens: 0, month_tokens: 0, by_task: [] });
    await s.app.close();
    s.db.close();
  });
});
