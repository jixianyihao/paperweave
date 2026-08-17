import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { embedTexts, vectorToBlob, blobToVector, EMBEDDING_UNCONFIGURED } from "../src/lib/embedding.js";

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.PAPERWEAVE_BUILTIN_KEY;
  delete process.env.PAPERWEAVE_BUILTIN_BASE;
});
afterEach(() => { process.env = { ...savedEnv }; });

function fakeEmbeddingFetch(vectors: number[][], capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return new Response(JSON.stringify({
      data: body.input.map((_, i) => ({ embedding: vectors[i % vectors.length], index: i })),
      usage: { prompt_tokens: 42, total_tokens: 42 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("embedTexts", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("posts to {base}/embeddings and returns Float32Array vectors in input order", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1/";
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const capture: { url?: string; init?: RequestInit } = {};
    const result = await embedTexts(db, ["hello", "world"], { fetchImpl: fakeEmbeddingFetch([[1, 0], [0, 1]], capture) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.vectors[0])).toEqual([1, 0]);
    expect(Array.from(result.vectors[1])).toEqual([0, 1]);
    expect(capture.url).toBe("https://builtin.example/v1/embeddings");
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.input).toEqual(["hello", "world"]);
    expect(sent.model).toBeTruthy();
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer bk");
    const log = db.prepare("SELECT task, tokens_in FROM usage_log").all() as { task: string; tokens_in: number }[];
    expect(log).toEqual([{ task: "embedding", tokens_in: 42 }]);
    db.close();
  });

  it("returns a clear error when no embedding route is configured", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    let called = false;
    const noFetch = (async () => { called = true; throw new Error("network"); }) as unknown as typeof fetch;
    const result = await embedTexts(db, ["x"], { fetchImpl: noFetch });
    expect(result).toEqual({ ok: false, error: EMBEDDING_UNCONFIGURED });
    expect(called).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_log").get()).toEqual({ n: 0 });
    db.close();
  });

  it("returns an error when the embedding route resolves to an anthropic provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO providers (id, kind, label, api_key) VALUES ('p1', 'anthropic', 'Claude', 'sk')").run();
    db.prepare("INSERT INTO task_routes (task, provider_id) VALUES ('embedding', 'p1')").run();
    const result = await embedTexts(db, ["x"], { fetchImpl: (() => { throw new Error("network"); }) as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, error: EMBEDDING_UNCONFIGURED });
    db.close();
  });

  it("propagates upstream http errors without writing usage_log", async () => {
    process.env.PAPERWEAVE_BUILTIN_KEY = "bk";
    process.env.PAPERWEAVE_BUILTIN_BASE = "https://builtin.example/v1";
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const failing = (async () => new Response("boom", { status: 429 })) as unknown as typeof fetch;
    const result = await embedTexts(db, ["x"], { fetchImpl: failing });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/429/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_log").get()).toEqual({ n: 0 });
    db.close();
  });

  it("returns no vectors for empty input without calling fetch", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const result = await embedTexts(db, [], { fetchImpl: (() => { throw new Error("network"); }) as unknown as typeof fetch });
    expect(result).toEqual({ ok: true, vectors: [] });
    db.close();
  });
});

describe("vector blob round-trip", () => {
  it("preserves float32 values through Buffer serialization", () => {
    const v = new Float32Array([0.1, -2.5, 3.75]);
    const back = blobToVector(vectorToBlob(v));
    expect(back).toBeInstanceOf(Float32Array);
    expect(Array.from(back)).toEqual(Array.from(v));
  });
});
