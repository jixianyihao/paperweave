import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, apiFetch, disableMockMode, enableMockMode, isMockMode } from "./client";
import { resetMockData } from "./mock";
import type { Item } from "./types";

beforeEach(() => {
  resetMockData();
  disableMockMode();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  disableMockMode();
  localStorage.clear();
});

describe("apiFetch 真实后端路径", () => {
  test("成功时返回 JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: "x1" }]), { status: 200 })),
    );
    const items = await apiFetch<{ id: string }[]>("/api/items");
    expect(items).toEqual([{ id: "x1" }]);
    expect(fetch).toHaveBeenCalledWith("/api/items", undefined);
  });

  test("HTTP 错误抛 ApiError，不回退 mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "item not found" }), { status: 404 })),
    );
    const err = await apiFetch("/api/items/nope").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("item not found");
  });

  test("网络失败自动回退 mock 数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const items = await apiFetch<Item[]>("/api/items");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("title");
  });
});

describe("mock 模式开关", () => {
  test("enableMockMode 后走 mock，并持久化 localStorage", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    enableMockMode();
    expect(isMockMode()).toBe(true);
    expect(localStorage.getItem("pw-mock")).toBe("1");
    const items = await apiFetch<Item[]>("/api/items");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(items.length).toBeGreaterThan(0);
    disableMockMode();
    expect(isMockMode()).toBe(false);
    expect(localStorage.getItem("pw-mock")).toBeNull();
  });

  test("localStorage 置位时自动进入 mock 模式", () => {
    localStorage.setItem("pw-mock", "1");
    expect(isMockMode()).toBe(true);
  });

  test("URL ?mock=1 进入 mock 模式", () => {
    const original = window.location.href;
    window.history.replaceState({}, "", "/?mock=1");
    expect(isMockMode()).toBe(true);
    window.history.replaceState({}, "", original);
  });
});

describe("mock 路由行为", () => {
  beforeEach(() => enableMockMode());

  test("GET /api/items 支持 status/starred/tag/collection 过滤", async () => {
    const unread = await apiFetch<Item[]>("/api/items?status=unread");
    expect(unread.every((i) => i.reading_status === "unread")).toBe(true);
    const starred = await apiFetch<Item[]>("/api/items?starred=1");
    expect(starred.every((i) => i.starred === 1)).toBe(true);
    const tagged = await apiFetch<Item[]>("/api/items?tag=nlp");
    expect(tagged.length).toBe(3);
    const inCol = await apiFetch<Item[]>("/api/items?collection=col00002");
    expect(inCol.map((i) => i.id)).toEqual(["bert0002"]);
  });

  test("GET /api/search?q= 返回匹配条目", async () => {
    const res = await apiFetch<{ items: Item[] }>("/api/search?q=attention");
    expect(res.items.some((i) => i.id === "attn0001")).toBe(true);
  });

  test("POST refetch-metadata：无 doi/arxiv 时 400，有则 complete", async () => {
    // fail0004 无 doi/arxiv → 400
    const err = await apiFetch("/api/items/fail0004/refetch-metadata", { method: "POST" }).catch((e) => e);
    expect((err as ApiError).status).toBe(400);
    // meta0005 有 doi → complete
    const ok = await apiFetch<{ item: Item; metadata_status: string }>(
      "/api/items/meta0005/refetch-metadata",
      { method: "POST" },
    );
    expect(ok.metadata_status).toBe("complete");
  });

  test("POST /api/import/identifier 识别新 DOI 与重复条目", async () => {
    const fresh = await apiFetch<{ item: Item; pdf_downloaded: boolean; duplicate: boolean }>(
      "/api/import/identifier",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "10.9999/new.paper" }) },
    );
    expect(fresh.duplicate).toBe(false);
    expect(fresh.pdf_downloaded).toBe(true);
    const dup = await apiFetch<{ duplicate: boolean }>("/api/import/identifier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "10.48550/arXiv.2005.14165" }),
    });
    expect(dup.duplicate).toBe(true);
  });

  test("providers CRUD + task-routes", async () => {
    const created = await apiFetch<{ id: string; has_key: boolean }>("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "openai", label: "测试 OpenAI", api_key: "sk-x", models: ["gpt-4o"] }),
    });
    expect(created.has_key).toBe(true);
    const list = await apiFetch<unknown[]>("/api/providers");
    expect(list.length).toBe(3);
    await apiFetch(`/api/providers/${created.id}`, { method: "DELETE" });
    expect((await apiFetch<unknown[]>("/api/providers")).length).toBe(2);

    const route = await apiFetch<{ task: string; provider_id: string | null }>("/api/task-routes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "summarize", provider_id: "prov0001", model: "claude-sonnet-4-20250514" }),
    });
    expect(route.provider_id).toBe("prov0001");
  });
});
