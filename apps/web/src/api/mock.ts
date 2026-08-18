// 手写 mock 后端：`?mock=1` 或真实请求网络失败时接管全部 /api 调用，
// 让完整流程（列表/筛选/搜索/导入/设置）在没有后端时也可演示。
import type {
  AiTask,
  Annotation,
  Collection,
  FileImportResult,
  IdentifierImportResult,
  Item,
  Provider,
  Tag,
  TaskRoute,
  UsageSummary,
} from "./types";
import type { SseFrame, SseOptions } from "./client";

interface MockDb {
  items: Item[];
  collections: Collection[];
  /** collectionId -> itemIds */
  collectionItems: Map<string, Set<string>>;
  tags: Tag[];
  /** tagName -> itemIds */
  tagItems: Map<string, Set<string>>;
  providers: Provider[];
  taskRoutes: TaskRoute[];
  annotations: Annotation[];
  keySeq: number;
}

function makeItem(partial: Partial<Item> & Pick<Item, "id" | "title">): Item {
  return {
    creators: "[]",
    year: null,
    venue: null,
    doi: null,
    arxiv_id: null,
    url: null,
    abstract: null,
    file_path: null,
    reading_status: "unread",
    starred: 0,
    metadata_status: "complete",
    date_added: "2026-08-01 09:00:00",
    date_modified: "2026-08-01 09:00:00",
    ...partial,
  };
}

function seed(): MockDb {
  const items: Item[] = [
    makeItem({
      id: "attn0001",
      title: "Attention Is All You Need",
      creators: JSON.stringify(["Ashish Vaswani", "Noam Shazeer"]),
      year: 2017,
      venue: "NeurIPS",
      arxiv_id: "1706.03762",
      abstract:
        "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
      file_path: "files/attn0001.pdf",
      reading_status: "read",
      starred: 1,
      date_added: "2026-08-10 10:00:00",
      date_modified: "2026-08-10 10:00:00",
    }),
    makeItem({
      id: "bert0002",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      creators: JSON.stringify(["Jacob Devlin", "Ming-Wei Chang"]),
      year: 2019,
      venue: "NAACL",
      arxiv_id: "1810.04805",
      abstract: "We introduce a new language representation model called BERT.",
      file_path: "files/bert0002.pdf",
      reading_status: "reading",
      date_added: "2026-08-11 11:00:00",
      date_modified: "2026-08-11 11:00:00",
    }),
    makeItem({
      id: "gpt30003",
      title: "Language Models are Few-Shot Learners",
      creators: JSON.stringify(["Tom B. Brown"]),
      year: 2020,
      venue: "NeurIPS",
      doi: "10.48550/arXiv.2005.14165",
      arxiv_id: "2005.14165",
      abstract: "We demonstrate that scaling up language models greatly improves task-agnostic, few-shot performance.",
      file_path: "files/gpt30003.pdf",
      reading_status: "unread",
      date_added: "2026-08-12 12:00:00",
      date_modified: "2026-08-12 12:00:00",
    }),
    makeItem({
      id: "fail0004",
      title: "Untitled (元数据抓取失败)",
      creators: "[]",
      metadata_status: "failed",
      reading_status: "unread",
      date_added: "2026-08-13 13:00:00",
      date_modified: "2026-08-13 13:00:00",
    }),
    makeItem({
      id: "meta0005",
      title: "A Metadata-Only Entry Without PDF",
      creators: JSON.stringify(["Jane Doe"]),
      year: 2024,
      doi: "10.1234/example.5678",
      abstract: "This entry has metadata but no local PDF file.",
      reading_status: "unread",
      metadata_status: "pending",
      date_added: "2026-08-14 14:00:00",
      date_modified: "2026-08-14 14:00:00",
    }),
  ];
  const collections: Collection[] = [
    { id: "col00001", parent_id: null, name: " Transformer 基础", item_count: 2 },
    { id: "col00002", parent_id: "col00001", name: "预训练模型", item_count: 1 },
  ];
  const collectionItems = new Map<string, Set<string>>([
    ["col00001", new Set(["attn0001", "bert0002"])],
    ["col00002", new Set(["bert0002"])],
  ]);
  const tags: Tag[] = [
    { name: "nlp", item_count: 3 },
    { name: "attention", item_count: 1 },
  ];
  const tagItems = new Map<string, Set<string>>([
    ["nlp", new Set(["attn0001", "bert0002", "gpt30003"])],
    ["attention", new Set(["attn0001"])],
  ]);
  const providers: Provider[] = [
    {
      id: "prov0001",
      kind: "anthropic",
      label: "我的 Anthropic",
      base_url: null,
      has_key: true,
      models: JSON.stringify(["claude-sonnet-4-20250514"]),
      enabled: 1,
    },
    {
      id: "prov0002",
      kind: "custom",
      label: "我的 DeepSeek",
      base_url: "https://api.deepseek.com",
      has_key: false,
      models: JSON.stringify(["deepseek-chat", "deepseek-reasoner"]),
      enabled: 1,
    },
  ];
  const taskRoutes: TaskRoute[] = (
    ["translate", "summarize", "explain", "qa", "voice", "embedding"] as AiTask[]
  ).map((task) => ({ task, provider_id: null, model: null }));
  const annotations: Annotation[] = [
    {
      id: "ann-mock-1",
      item_id: "attn0001",
      type: "highlight",
      page: 1,
      position: null,
      content: "The Transformer is the first transduction model relying entirely on self-attention.",
      color: "yellow",
      created_at: "2026-08-10 12:00:00",
      sort_index: 0,
    },
    {
      id: "ann-mock-2",
      item_id: "attn0001",
      type: "note",
      page: 1,
      position: null,
      content: "开篇立论：抛弃循环与卷积，全靠注意力。",
      color: null,
      created_at: "2026-08-10 12:05:00",
      sort_index: 1,
    },
    {
      id: "ann-mock-3",
      item_id: "attn0001",
      type: "ai_summary",
      page: 2,
      position: null,
      content: "（mock）本页提出多头注意力结构，并给出缩放点积注意力的定义。",
      color: null,
      created_at: "2026-08-10 12:10:00",
      sort_index: 0,
    },
    {
      id: "ann-mock-4",
      item_id: "attn0001",
      type: "voice_digest",
      page: 4,
      position: null,
      content: "（mock）语音速览：实验在两个机器翻译任务上取得 SOTA。",
      color: null,
      created_at: "2026-08-10 12:20:00",
      sort_index: 0,
    },
  ];
  return { items, collections, collectionItems, tags, tagItems, providers, taskRoutes, annotations, keySeq: 100 };
}

let db = seed();

/** 测试用：恢复初始数据 */
export function resetMockData(): void {
  db = seed();
}

function newKey(): string {
  db.keySeq += 1;
  return `mock${String(db.keySeq).padStart(4, "0")}`;
}

export class MockApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sortedItems(items: Item[]): Item[] {
  return [...items].sort((a, b) =>
    a.date_added === b.date_added ? b.id.localeCompare(a.id) : b.date_added.localeCompare(a.date_added),
  );
}

function filterItems(params: URLSearchParams): Item[] {
  let out = [...db.items];
  const status = params.get("status");
  if (status) out = out.filter((i) => i.reading_status === status);
  if (params.get("starred") === "1") out = out.filter((i) => i.starred === 1);
  const collection = params.get("collection");
  if (collection) {
    const members = db.collectionItems.get(collection);
    out = out.filter((i) => members?.has(i.id));
  }
  const tag = params.get("tag");
  if (tag) {
    const members = db.tagItems.get(tag);
    out = out.filter((i) => members?.has(i.id));
  }
  const q = params.get("q");
  if (q) out = searchItems(q);
  return sortedItems(out);
}

function searchItems(q: string): Item[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return db.items
    .filter((i) => {
      const hay = [i.title, i.abstract ?? "", i.venue ?? "", i.creators].join(" ").toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 50);
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 模拟 /api 路由。返回的值与真实后端 JSON 形状一致。 */
export async function mockApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 模拟一点网络延迟，便于演示 loading 态
  await new Promise((r) => setTimeout(r, 5));
  const url = new URL(path, "http://mock.local");
  const method = (init?.method ?? "GET").toUpperCase();
  const p = url.pathname;
  const body = bodyOf(init);

  // ---- items ----
  if (method === "GET" && p === "/api/items") return filterItems(url.searchParams) as T;

  const itemMatch = p.match(/^\/api\/items\/([^/]+)$/);
  if (method === "GET" && itemMatch) {
    const item = db.items.find((i) => i.id === itemMatch[1]);
    if (!item) throw new MockApiError(404, "item not found");
    return item as T;
  }

  const refetchMatch = p.match(/^\/api\/items\/([^/]+)\/refetch-metadata$/);
  if (method === "POST" && refetchMatch) {
    const item = db.items.find((i) => i.id === refetchMatch[1]);
    if (!item) throw new MockApiError(404, "item not found");
    if (!item.doi && !item.arxiv_id) throw new MockApiError(400, "no doi or arxiv_id");
    item.metadata_status = "complete";
    if (item.title.startsWith("Untitled")) item.title = "Recovered Metadata Title";
    return { item, metadata_status: item.metadata_status } as T;
  }

  // ---- search ----
  if (method === "GET" && p === "/api/search") {
    return { items: searchItems(url.searchParams.get("q") ?? "") } as T;
  }

  // ---- collections / tags ----
  if (method === "GET" && p === "/api/collections") return db.collections.map((c) => ({ ...c })) as T;
  if (method === "GET" && p === "/api/tags") return db.tags.map((t) => ({ ...t })) as T;
  const colItemsMatch = p.match(/^\/api\/collections\/([^/]+)\/items$/);
  if (method === "GET" && colItemsMatch) {
    return filterItems(new URLSearchParams({ collection: colItemsMatch[1] })) as T;
  }

  // ---- import ----
  if (method === "POST" && p === "/api/import/file") {
    const item = makeItem({
      id: newKey(),
      title: "Dropped Paper (mock)",
      file_path: "files/mock-drop.pdf",
      date_added: "2026-08-17 09:00:00",
      date_modified: "2026-08-17 09:00:00",
    });
    db.items.push(item);
    const result: FileImportResult = { item, metadata_status: "complete", duplicate: false };
    return result as T;
  }

  if (method === "POST" && p === "/api/import/identifier") {
    const input = String(body.input ?? "").trim();
    if (!input) throw new MockApiError(400, "input required");
    const dup = db.items.find(
      (i) => (i.doi && i.doi.toLowerCase() === input.toLowerCase()) || i.arxiv_id === input,
    );
    if (dup) {
      const result: IdentifierImportResult = { item: dup, pdf_downloaded: false, duplicate: true };
      return result as T;
    }
    const item = makeItem({
      id: newKey(),
      title: `Imported: ${input}`,
      doi: input.startsWith("10.") ? input : null,
      arxiv_id: /^\d{4}\.\d{4,5}$/.test(input) ? input : null,
      abstract: "（mock）通过标识符导入的条目。",
      file_path: "files/mock-import.pdf",
      date_added: "2026-08-17 09:30:00",
      date_modified: "2026-08-17 09:30:00",
    });
    db.items.push(item);
    const result: IdentifierImportResult = { item, pdf_downloaded: true, duplicate: false };
    return result as T;
  }

  // ---- providers ----
  // 注意：返回数组副本而非内部引用，避免调用方 setState 拿到同一引用导致 React 跳过重渲染
  if (method === "GET" && p === "/api/providers") return [...db.providers] as T;
  if (method === "POST" && p === "/api/providers") {
    const kind = String(body.kind ?? "");
    const label = String(body.label ?? "").trim();
    if (!["builtin", "anthropic", "openai", "custom"].includes(kind) || !label) {
      throw new MockApiError(400, "invalid provider");
    }
    const baseUrl = typeof body.base_url === "string" && body.base_url ? body.base_url : null;
    if (kind === "custom" && !baseUrl) throw new MockApiError(400, "custom provider requires base_url");
    const provider: Provider = {
      id: newKey(),
      kind: kind as Provider["kind"],
      label,
      base_url: baseUrl,
      has_key: typeof body.api_key === "string" && body.api_key.length > 0,
      models: JSON.stringify(Array.isArray(body.models) ? body.models : []),
      enabled: 1,
    };
    db.providers.push(provider);
    return provider as T;
  }

  const providerMatch = p.match(/^\/api\/providers\/([^/]+)$/);
  if (providerMatch && method === "PATCH") {
    const provider = db.providers.find((x) => x.id === providerMatch[1]);
    if (!provider) throw new MockApiError(404, "provider not found");
    if (typeof body.label === "string" && body.label) provider.label = body.label;
    if (typeof body.base_url === "string") provider.base_url = body.base_url || null;
    if (typeof body.api_key === "string" && body.api_key) provider.has_key = true;
    if (Array.isArray(body.models)) provider.models = JSON.stringify(body.models);
    if (body.enabled === 0 || body.enabled === 1) provider.enabled = body.enabled;
    return provider as T;
  }
  if (providerMatch && method === "DELETE") {
    const idx = db.providers.findIndex((x) => x.id === providerMatch[1]);
    if (idx === -1) throw new MockApiError(404, "provider not found");
    db.providers.splice(idx, 1);
    for (const route of db.taskRoutes) {
      if (route.provider_id === providerMatch[1]) {
        route.provider_id = null;
        route.model = null;
      }
    }
    return undefined as T;
  }

  const providerTestMatch = p.match(/^\/api\/providers\/([^/]+)\/test$/);
  if (method === "POST" && providerTestMatch) {
    const provider = db.providers.find((x) => x.id === providerTestMatch[1]);
    if (!provider) throw new MockApiError(404, "provider not found");
    if (!provider.has_key && provider.kind !== "builtin") {
      return { ok: false, error: "未配置 API key" } as T;
    }
    return { ok: true } as T;
  }

  // ---- task routes / usage ----
  if (method === "GET" && p === "/api/task-routes") return db.taskRoutes.map((r) => ({ ...r })) as T;
  if (method === "PATCH" && p === "/api/task-routes") {
    const task = String(body.task ?? "");
    const route = db.taskRoutes.find((r) => r.task === task);
    if (!route) throw new MockApiError(400, "unknown task");
    route.provider_id = (body.provider_id as string | null) ?? null;
    route.model = (body.model as string | null) ?? null;
    return route as T;
  }
  if (method === "GET" && p === "/api/usage") {
    const usage: UsageSummary = { today_tokens: 0, month_tokens: 0, by_task: [] };
    return usage as T;
  }

  // ---- voice（阶段 5.5+6：ephemeral token 协商 + 时长上报）----
  if (method === "POST" && p === "/api/voice/session") {
    return {
      client_secret: "mock-ephemeral-key",
      url: "https://mock.realtime.local/v1/realtime",
      model: "gpt-4o-realtime-preview",
    } as T;
  }
  if (method === "POST" && p === "/api/voice/usage") {
    if (typeof body.seconds !== "number" || body.seconds <= 0) throw new MockApiError(400, "invalid request");
    return { ok: true } as T;
  }

  // ---- annotations（阶段 4+5：阅读器时间流）----
  const annMatch = p.match(/^\/api\/items\/([^/]+)\/annotations$/);
  if (annMatch && method === "GET") {
    const item = db.items.find((i) => i.id === annMatch[1]);
    if (!item) throw new MockApiError(404, "item not found");
    return db.annotations
      .filter((a) => a.item_id === annMatch[1])
      .map((a) => ({ ...a }))
      .sort(
        (a, b) =>
          (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) ||
          a.sort_index - b.sort_index ||
          a.created_at.localeCompare(b.created_at) ||
          a.id.localeCompare(b.id),
      ) as T;
  }
  if (annMatch && method === "POST") {
    const item = db.items.find((i) => i.id === annMatch[1]);
    if (!item) throw new MockApiError(404, "item not found");
    const type = String(body.type ?? "");
    const content = String(body.content ?? "").trim();
    if (!content) throw new MockApiError(400, "invalid annotation");
    const annotation: Annotation = {
      id: newKey(),
      item_id: item.id,
      type: type as Annotation["type"],
      page: typeof body.page === "number" ? body.page : null,
      position: typeof body.position === "string" ? body.position : null,
      content,
      color: typeof body.color === "string" ? body.color : null,
      created_at: "2026-08-17 10:00:00",
      sort_index: db.annotations.filter((a) => a.item_id === item.id && a.page === body.page).length,
    };
    db.annotations.push(annotation);
    return { ...annotation } as T;
  }

  throw new MockApiError(404, `mock: no route for ${method} ${p}`);
}

// ---- SSE mock（阶段 4+5）：与真实端点帧形状一致，便于无后端演示流式交互 ----

function nowStamp(): string {
  return "2026-08-17 10:30:00";
}

async function streamText(text: string, onFrame: (f: SseFrame) => void, signal?: AbortSignal): Promise<void> {
  // 按 ~8 字切片模拟流式增量
  for (let i = 0; i < text.length; i += 8) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    await new Promise((r) => setTimeout(r, 2));
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    onFrame({ delta: text.slice(i, i + 8) });
  }
}

/** 模拟 SSE 端点：/api/ai/{summarize,explain,translate}、/api/annotations/:id/messages、/api/items/:id/ask */
export async function mockApiSse(
  path: string,
  body: unknown,
  onFrame: (f: SseFrame) => void,
  options?: SseOptions,
): Promise<void> {
  const signal = options?.signal;
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  await new Promise((r) => setTimeout(r, 5));
  const p = new URL(path, "http://mock.local").pathname;
  const b = body as Record<string, unknown>;

  const aiMatch = p.match(/^\/api\/ai\/(summarize|explain|translate)$/);
  if (aiMatch) {
    const kind = aiMatch[1];
    const label = kind === "summarize" ? "摘要" : kind === "explain" ? "解释" : "翻译";
    await streamText(`（mock ${label}）这是针对所选内容的流式${label}结果。`, onFrame, signal);
    let annotationId: string | undefined;
    const itemId = typeof b.itemId === "string" ? b.itemId : null;
    const item = itemId ? db.items.find((i) => i.id === itemId) : undefined;
    if (item) {
      const type = (
        kind === "summarize" ? "ai_summary" : kind === "explain" ? "ai_explain" : "ai_translate"
      ) as Annotation["type"];
      const annotation: Annotation = {
        id: newKey(),
        item_id: item.id,
        type,
        page: typeof b.page === "number" ? b.page : null,
        position: null,
        content: `（mock ${label}）这是针对所选内容的流式${label}结果。`,
        color: null,
        created_at: nowStamp(),
        sort_index: 0,
      };
      db.annotations.push(annotation);
      annotationId = annotation.id;
    }
    onFrame({ done: true, tokens_in: 12, tokens_out: 34, ...(annotationId ? { annotation_id: annotationId } : {}) });
    return;
  }

  const msgMatch = p.match(/^\/api\/annotations\/([^/]+)\/messages$/);
  if (msgMatch) {
    await streamText("（mock 追问）这是对所选片段的进一步解释，详见 [P1] 与 [P2] 的相关段落。", onFrame, signal);
    onFrame({ done: true, tokens_in: 20, tokens_out: 40, message_id: newKey() });
    return;
  }

  const askMatch = p.match(/^\/api\/items\/([^/]+)\/ask$/);
  if (askMatch) {
    await streamText("（mock 问答）Transformer 的核心是自注意力机制 [P1]，它摒弃了循环结构 [P2]。", onFrame, signal);
    onFrame({
      done: true,
      message_id: newKey(),
      citations: [
        { page: 1, quote: "The Transformer is the first transduction model relying entirely on self-attention…" },
        { page: 2, quote: "We propose a new simple network architecture, the Transformer…" },
      ],
    });
    return;
  }

  throw new MockApiError(404, `mock: no SSE route for ${p}`);
}
