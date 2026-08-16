# PaperWeave 阶段 1（后端核心）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端具备完整导入管线：上传 PDF / 粘贴 DOI·arXiv·URL 即可入库并自动补全元数据；条目 CRUD、集合、标签 API 就绪。

**Architecture:** 沿用阶段 0 的 Fastify + better-sqlite3。新增：zod 请求校验、pdfjs-dist 服务端文本提取、可注入 fetch 的元数据客户端（CrossRef/arXiv/URL meta 标签）、multipart 上传。所有外部网络访问经过注入的 fetch，测试零网络。

**Tech Stack:** Fastify 4, better-sqlite3, zod ^3.23, pdfjs-dist ^4, @fastify/multipart ^8, fast-xml-parser ^4, Vitest

## Global Constraints

- Node ≥ 20；pnpm workspaces；包版本按本计划锁定
- 数据库仅 SQLite（WAL）；**迁移必须事务包裹**（阶段 0 最终审查 I-1 已修，保持）
- 数据目录经 `resolveDataDir()` 解析（repo 根 `data/`，`DATA_DIR` 可覆盖）；PDF 存 `data/files/{itemKey}.pdf`
- **测试中禁止真实网络请求**：所有元数据客户端接受注入的 `fetchImpl`，测试用伪造 fetch
- 条目主键 `id`：8 位 Crockford 风格 key（无 0/O/1/I/L），由 `newKey()` 生成
- 阶段 0 最终审查遗留约束：写端点用 zod 校验，不用裸 `as` 断言请求体
- Zotero translators 框架不引入——URL 导入用 `citation_*` meta 标签提取（简化决策，spec §3.2 的 translator 内嵌推迟到有真实需求时）

## 测试夹具

`apps/web/public/samples/sample.pdf`（Attention 论文，阶段 0 已提交）在后端测试中用作真实 PDF 夹具，路径相对 backend 包为 `../../apps/web/public/samples/sample.pdf`。

---

### Task 1: 条目 key 生成 + 单条目 CRUD

**Files:**
- Create: `packages/backend/src/lib/keys.ts`
- Create: `packages/backend/src/lib/validate.ts`
- Modify: `packages/backend/src/routes/items.ts`
- Modify: `packages/backend/package.json`（加 zod）
- Test: `packages/backend/test/item-detail.test.ts`

**Interfaces:**
- Produces: `newKey(len?: number): string`（8 位 Crockford 风格）；`GET /api/items/:id → ItemRow | 404`；`PATCH /api/items/:id`（可改 title/year/venue/abstract/reading_status/starred，zod 校验，未知字段 400）→ ItemRow；`DELETE /api/items/:id` → 204（同时删 `data/files/{id}.pdf`，文件不存在不报错）

- [ ] **Step 1: 加依赖**

在 `packages/backend/package.json` dependencies 加 `"zod": "^3.23.8"`，然后 `pnpm install`。

- [ ] **Step 2: 写 lib/keys.ts**

```ts
import { randomBytes } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newKey(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
```

- [ ] **Step 3: 写 lib/validate.ts**

```ts
import { z } from "zod";

export const patchItemSchema = z
  .object({
    title: z.string().min(1),
    year: z.number().int().nullable(),
    venue: z.string().nullable(),
    abstract: z.string().nullable(),
    reading_status: z.enum(["unread", "reading", "read"]),
    starred: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .partial();

export type PatchItemInput = z.infer<typeof patchItemSchema>;
```

- [ ] **Step 4: 写失败测试 test/item-detail.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("item detail routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const id = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(id, "Test Paper");
    const app = buildServer(db, { dataDir: dir });
    return { db, app, id };
  }

  it("GET /api/items/:id returns the item", async () => {
    const { app, id } = await setup();
    const res = await app.inject({ method: "GET", url: `/api/items/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Test Paper");
    await app.close();
  });

  it("GET /api/items/:id 404s for unknown id", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items/NOPE1234" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("PATCH updates allowed fields and bumps date_modified", async () => {
    const { app, id } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/items/${id}`,
      payload: { reading_status: "reading", starred: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reading_status).toBe("reading");
    expect(res.json().starred).toBe(1);
    await app.close();
  });

  it("PATCH rejects unknown fields and bad enums with 400", async () => {
    const { app, id } = await setup();
    const bad1 = await app.inject({ method: "PATCH", url: `/api/items/${id}`, payload: { evil: true } });
    const bad2 = await app.inject({ method: "PATCH", url: `/api/items/${id}`, payload: { reading_status: "bogus" } });
    expect(bad1.statusCode).toBe(400);
    expect(bad2.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE removes row and its pdf file", async () => {
    const { db, app, id } = await setup();
    writeFileSync(join(dir, "files", `${id}.pdf`), "fake");
    db.prepare("UPDATE items SET file_path = ? WHERE id = ?").run(`files/${id}.pdf`, id);
    const res = await app.inject({ method: "DELETE", url: `/api/items/${id}` });
    expect(res.statusCode).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = ?").get(id)).toEqual({ n: 0 });
    expect(existsSync(join(dir, "files", `${id}.pdf`))).toBe(false);
    await app.close();
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — 路由不存在（404 全部、PATCH/DELETE 404），且 `buildServer` 还不接受 options

- [ ] **Step 6: 实现 routes/items.ts 扩展（在 Task 4 阶段0 版本基础上追加；完整文件如下）**

```ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { patchItemSchema } from "../lib/validate.js";

export interface ItemRow {
  id: string;
  title: string;
  creators: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  abstract: string | null;
  file_path: string | null;
  reading_status: "unread" | "reading" | "read";
  starred: number;
  date_added: string;
  date_modified: string;
}

export interface RouteDeps {
  dataDir: string;
}

const UPDATABLE = ["title", "year", "venue", "abstract", "reading_status", "starred"] as const;

export function registerItemRoutes(app: FastifyInstance, db: Database.Database, deps: RouteDeps): void {
  app.get("/api/items", async (): Promise<ItemRow[]> => {
    return db.prepare("SELECT * FROM items ORDER BY date_added DESC, id DESC").all() as ItemRow[];
  });

  app.get("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!row) return reply.code(404).send({ error: "item not found" });
    return row;
  });

  app.patch("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchItemSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: "invalid patch", details: parsed.success ? "empty" : parsed.error.issues });
    }
    const existing = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "item not found" });
    const sets = UPDATABLE.filter((f) => f in parsed.data).map((f) => `${f} = ?`);
    const values = UPDATABLE.filter((f) => f in parsed.data).map((f) => (parsed.data as Record<string, unknown>)[f]);
    db.prepare(`UPDATE items SET ${sets.join(", ")}, date_modified = datetime('now') WHERE id = ?`).run(...values, id);
    return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  });

  app.delete("/api/items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT file_path FROM items WHERE id = ?").get(id) as { file_path: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: "item not found" });
    if (row.file_path) {
      const abs = join(deps.dataDir, row.file_path);
      if (existsSync(abs)) unlinkSync(abs);
    }
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 7: 改 server.ts 接受 options（完整替换）**

```ts
import Fastify from "fastify";
import type Database from "better-sqlite3";
import { openDb, resolveDataDir } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";

export interface ServerOptions {
  dataDir?: string;
}

export function buildServer(db: Database.Database = openDb(), opts: ServerOptions = {}) {
  const dataDir = opts.dataDir ?? resolveDataDir();
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db, { dataDir });
  return app;
}
```

注：`resolveDataDir` 是阶段 0 修复 I-2 时在 db.ts 中新增的导出。若该函数实际名不同，以 db.ts 中真实导出为准。

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS（health 1 + db 若干 + items 2 + item-detail 5）

- [ ] **Step 9: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): item detail CRUD with zod validation"
```

---

### Task 2: 集合与标签

**Files:**
- Create: `packages/backend/migrations/002_collections_tags.sql`
- Create: `packages/backend/src/routes/collections.ts`
- Create: `packages/backend/src/routes/tags.ts`
- Modify: `packages/backend/src/db.ts`（开外键）
- Modify: `packages/backend/src/server.ts`（注册路由）
- Test: `packages/backend/test/collections.test.ts`、`packages/backend/test/tags.test.ts`

**Interfaces:**
- Consumes: `newKey()`（Task 1）、`buildServer(db, opts)`
- Produces: `GET/POST /api/collections`、`PATCH/DELETE /api/collections/:id`、`PUT/DELETE /api/collections/:id/items/:itemId`；`GET /api/tags`（含每标签文献数）、`PUT/DELETE /api/items/:id/tags/:name`；集合/标签结构供阶段 2 UI 使用

- [ ] **Step 1: 写迁移 002_collections_tags.sql**

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, item_id)
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
```

- [ ] **Step 2: db.ts 打开外键支持**

在 `openDb()` 的 `journal_mode` pragma 后加一行：

```ts
db.pragma("foreign_keys = ON");
```

并在 `test/db.test.ts` 加测试：

```ts
it("enforces foreign keys", () => {
  dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  expect(() =>
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('nope', 'nope')").run(),
  ).toThrow();
  db.close();
});
```

Run: `pnpm -F @paperweave/backend test` → 该测试 FAIL（外键未开）；实现后 PASS。

- [ ] **Step 3: 写失败测试 test/collections.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("collection routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const itemId = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(itemId, "Paper");
    const app = buildServer(db, { dataDir: dir });
    return { db, app, itemId };
  }

  it("creates, lists (with item counts), renames and deletes collections", async () => {
    const { app, itemId } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/collections", payload: { name: "Transformer" } });
    expect(created.statusCode).toBe(200);
    const col = created.json();
    expect(col.name).toBe("Transformer");

    const put = await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    expect(put.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/collections" });
    expect(list.json()).toEqual([expect.objectContaining({ name: "Transformer", item_count: 1 })]);

    const renamed = await app.inject({ method: "PATCH", url: `/api/collections/${col.id}`, payload: { name: "LLM" } });
    expect(renamed.json().name).toBe("LLM");

    const del = await app.inject({ method: "DELETE", url: `/api/collections/${col.id}` });
    expect(del.statusCode).toBe(204);
    await app.close();
  });

  it("PUT membership is idempotent", async () => {
    const { app, itemId } = await setup();
    const col = (await app.inject({ method: "POST", url: "/api/collections", payload: { name: "C" } })).json();
    await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    const again = await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    expect(again.statusCode).toBe(204);
    await app.close();
  });

  it("rejects empty collection name with 400", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/collections", payload: { name: "  " } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 4: 写失败测试 test/tags.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("tag routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("adds, lists (with counts) and removes tags", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const itemId = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(itemId, "Paper");
    const app = buildServer(db, { dataDir: dir });

    const put = await app.inject({ method: "PUT", url: `/api/items/${itemId}/tags/NLP` });
    expect(put.statusCode).toBe(204);
    const again = await app.inject({ method: "PUT", url: `/api/items/${itemId}/tags/NLP` });
    expect(again.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/tags" });
    expect(list.json()).toEqual([{ name: "NLP", item_count: 1 }]);

    const del = await app.inject({ method: "DELETE", url: `/api/items/${itemId}/tags/NLP` });
    expect(del.statusCode).toBe(204);
    const empty = await app.inject({ method: "GET", url: "/api/tags" });
    expect(empty.json()).toEqual([]);
    await app.close();
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — collections/tags 路由 404

- [ ] **Step 6: 写 routes/collections.ts**

```ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { newKey } from "../lib/keys.js";

const nameSchema = z.object({ name: z.string().trim().min(1) }).strict();

export function registerCollectionRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/collections", async () => {
    return db.prepare(`
      SELECT c.id, c.parent_id, c.name,
        (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
      FROM collections c ORDER BY c.name
    `).all();
  });

  app.post("/api/collections", async (req, reply) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid name" });
    const id = newKey();
    const parent = (req.body as { parent_id?: string })?.parent_id ?? null;
    db.prepare("INSERT INTO collections (id, parent_id, name) VALUES (?, ?, ?)").run(id, parent, parsed.data.name);
    return { id, parent_id: parent, name: parsed.data.name, item_count: 0 };
  });

  app.patch("/api/collections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid name" });
    const info = db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(parsed.data.name, id);
    if (info.changes === 0) return reply.code(404).send({ error: "collection not found" });
    return db.prepare("SELECT id, parent_id, name FROM collections WHERE id = ?").get(id);
  });

  app.delete("/api/collections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = db.prepare("DELETE FROM collections WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "collection not found" });
    return reply.code(204).send();
  });

  app.put("/api/collections/:id/items/:itemId", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const col = db.prepare("SELECT id FROM collections WHERE id = ?").get(id);
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
    if (!col || !item) return reply.code(404).send({ error: "collection or item not found" });
    db.prepare("INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)").run(id, itemId);
    return reply.code(204).send();
  });

  app.delete("/api/collections/:id/items/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    db.prepare("DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?").run(id, itemId);
    return { ok: true };
  });
}
```

- [ ] **Step 7: 写 routes/tags.ts**

```ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export function registerTagRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/tags", async () => {
    return db.prepare(`
      SELECT t.name, COUNT(it.item_id) AS item_count
      FROM tags t JOIN item_tags it ON it.tag_id = t.id
      GROUP BY t.id ORDER BY t.name
    `).all();
  });

  app.put("/api/items/:id/tags/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const item = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (!item) return reply.code(404).send({ error: "item not found" });
    db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
    const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number };
    db.prepare("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)").run(id, tag.id);
    return reply.code(204).send();
  });

  app.delete("/api/items/:id/tags/:name", async (req) => {
    const { id, name } = req.params as { id: string; name: string };
    db.prepare("DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)").run(id, name);
    db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)").run();
    return { ok: true };
  });
}
```

- [ ] **Step 8: server.ts 注册两个路由**

在 `registerItemRoutes(...)` 后加：

```ts
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";
// ...
  registerCollectionRoutes(app, db);
  registerTagRoutes(app, db);
```

- [ ] **Step 9: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: 全部 PASS

- [ ] **Step 10: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): collections and tags with foreign keys"
```

---

### Task 3: PDF 提示提取（文本 + DOI/arXiv 探测）

**Files:**
- Create: `packages/backend/src/lib/pdfhints.ts`
- Modify: `packages/backend/package.json`（加 pdfjs-dist）
- Test: `packages/backend/test/pdfhints.test.ts`

**Interfaces:**
- Produces: `extractPdfHints(pdfBytes: Uint8Array): Promise<{ doi: string | null; arxivId: string | null; firstText: string }>` — 提取前两页文本，正则探测 DOI 和 arXiv ID。Task 5 使用。

- [ ] **Step 1: 加依赖**

`packages/backend/package.json` dependencies 加 `"pdfjs-dist": "^4.2.67"`，然后 `pnpm install`。

- [ ] **Step 2: 写失败测试 test/pdfhints.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfHints } from "../src/lib/pdfhints.js";

const sample = new Uint8Array(
  readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf")),
);

describe("extractPdfHints", () => {
  it("extracts text and finds the arXiv id in the Attention paper", async () => {
    const hints = await extractPdfHints(sample);
    expect(hints.firstText).toContain("Attention Is All You Need");
    expect(hints.arxivId).toBe("1706.03762");
  });

  it("returns nulls for a text-free buffer", async () => {
    const hints = await extractPdfHints(new Uint8Array([37, 80, 68, 70])); // "%PDF" garbage
    expect(hints.doi).toBeNull();
    expect(hints.arxivId).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 写 lib/pdfhints.ts**

```ts
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
const ARXIV_RE = /(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/;

export interface PdfHints {
  doi: string | null;
  arxivId: string | null;
  firstText: string;
}

export async function extractPdfHints(pdfBytes: Uint8Array): Promise<PdfHints> {
  const none: PdfHints = { doi: null, arxivId: null, firstText: "" };
  let text = "";
  try {
    const doc = await getDocument({ data: pdfBytes, isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, 2);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    await doc.destroy();
  } catch {
    return none;
  }
  const doi = text.match(DOI_RE)?.[1] ?? null;
  const arxivId = text.match(ARXIV_RE)?.[1] ?? null;
  return { doi, arxivId, firstText: text.slice(0, 2000) };
}
```

注：若 `pdfjs-dist/legacy/build/pdf.mjs` 导入解析失败（Node ESM exports 问题），改用 `pdfjs-dist/legacy/build/pdf.js`（CJS 经 default interop）。以实测为准并在报告中说明。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS（Attention 论文首页含 "arXiv:1706.03762v5" 与标题）

- [ ] **Step 6: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): pdf hint extraction via pdfjs-dist"
```

---

### Task 4: 元数据客户端（CrossRef / arXiv / URL）

**Files:**
- Create: `packages/backend/src/lib/metadata.ts`
- Modify: `packages/backend/package.json`（加 fast-xml-parser）
- Test: `packages/backend/test/metadata.test.ts`

**Interfaces:**
- Produces:
  - `interface PaperMeta { title?: string; creators: string[]; year?: number; venue?: string; doi?: string; arxivId?: string; abstract?: string; url?: string; pdfUrl?: string }`
  - `type FetchLike = typeof fetch`
  - `fetchByDoi(doi: string, fetchImpl?: FetchLike): Promise<PaperMeta | null>`
  - `fetchByArxiv(arxivId: string, fetchImpl?: FetchLike): Promise<PaperMeta | null>`
  - `fetchByUrl(url: string, fetchImpl?: FetchLike): Promise<PaperMeta | null>` — 抓页面 `citation_*` meta 标签
  全部在网络错误/404/解析失败时返回 null，不抛异常。Task 5/6 使用。

- [ ] **Step 1: 加依赖**

`packages/backend/package.json` dependencies 加 `"fast-xml-parser": "^4.4.1"`，然后 `pnpm install`。

- [ ] **Step 2: 写失败测试 test/metadata.test.ts**（全部用注入的假 fetch，零网络）

```ts
import { describe, it, expect } from "vitest";
import { fetchByDoi, fetchByArxiv, fetchByUrl } from "../src/lib/metadata.js";

const crossrefJson = {
  message: {
    title: ["Attention Is All You Need"],
    author: [{ given: "Ashish", family: "Vaswani" }, { given: "Noam", family: "Shazeer" }],
    issued: { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.48550/arXiv.1706.03762",
    abstract: "<jats:p>We propose the Transformer…</jats:p>",
    URL: "https://doi.org/10.48550/arXiv.1706.03762",
  },
};

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <summary>Dominant sequence transduction models…</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
</feed>`;

const pageHtml = `<html><head>
<meta name="citation_title" content="Some Paper">
<meta name="citation_author" content="Doe, Jane">
<meta name="citation_author" content="Smith, John">
<meta name="citation_publication_date" content="2021">
<meta name="citation_journal_title" content="Nature">
<meta name="citation_doi" content="10.1000/xyz123">
<meta name="citation_pdf_url" content="https://example.com/paper.pdf">
</head><body></body></html>`;

function fakeFetch(body: unknown, ok = true, status = 200) {
  return (async () => ({
    ok, status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(typeof body === "string" ? body : "").buffer,
  })) as unknown as typeof fetch;
}

describe("fetchByDoi", () => {
  it("maps crossref json to PaperMeta", async () => {
    const meta = await fetchByDoi("10.48550/arXiv.1706.03762", fakeFetch(crossrefJson));
    expect(meta?.title).toBe("Attention Is All You Need");
    expect(meta?.creators).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(meta?.year).toBe(2017);
    expect(meta?.venue).toBe("NeurIPS");
    expect(meta?.abstract).toBe("We propose the Transformer…");
  });

  it("returns null on http error", async () => {
    expect(await fetchByDoi("10.1/x", fakeFetch({}, false, 404))).toBeNull();
  });

  it("returns null on network throw", async () => {
    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect(await fetchByDoi("10.1/x", boom)).toBeNull();
  });
});

describe("fetchByArxiv", () => {
  it("maps atom xml to PaperMeta", async () => {
    const meta = await fetchByArxiv("1706.03762", fakeFetch(arxivXml));
    expect(meta?.title).toBe("Attention Is All You Need");
    expect(meta?.creators).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(meta?.year).toBe(2017);
    expect(meta?.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
  });
});

describe("fetchByUrl", () => {
  it("maps citation meta tags to PaperMeta", async () => {
    const meta = await fetchByUrl("https://example.com/p", fakeFetch(pageHtml));
    expect(meta?.title).toBe("Some Paper");
    expect(meta?.creators).toEqual(["Doe, Jane", "Smith, John"]);
    expect(meta?.year).toBe(2021);
    expect(meta?.doi).toBe("10.1000/xyz123");
    expect(meta?.pdfUrl).toBe("https://example.com/paper.pdf");
  });

  it("returns null when no citation tags", async () => {
    expect(await fetchByUrl("https://x.com", fakeFetch("<html></html>"))).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 写 lib/metadata.ts**

```ts
import { XMLParser } from "fast-xml-parser";

export interface PaperMeta {
  title?: string;
  creators: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url?: string;
  pdfUrl?: string;
}

export type FetchLike = typeof fetch;

export async function fetchByDoi(doi: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!res.ok) return null;
    const { message: m } = await res.json();
    if (!m?.title?.[0]) return null;
    return {
      title: m.title[0],
      creators: (m.author ?? []).map((a: { given?: string; family?: string }) =>
        [a.given, a.family].filter(Boolean).join(" ")),
      year: m.issued?.["date-parts"]?.[0]?.[0],
      venue: m["container-title"]?.[0],
      doi: m.DOI ?? doi,
      abstract: typeof m.abstract === "string" ? m.abstract.replace(/<[^>]+>/g, "") : undefined,
      url: m.URL,
      pdfUrl: (m.link ?? []).find((l: { "content-type"?: string }) => l["content-type"] === "application/pdf")?.URL,
    };
  } catch {
    return null;
  }
}

export async function fetchByArxiv(arxivId: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
    const entry = parsed?.feed?.entry;
    if (!entry?.title) return null;
    const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
    return {
      title: String(entry.title).replace(/\s+/g, " ").trim(),
      creators: authors.filter(Boolean).map((a: { name: string }) => a.name),
      year: entry.published ? Number(String(entry.published).slice(0, 4)) : undefined,
      arxivId,
      abstract: entry.summary ? String(entry.summary).replace(/\s+/g, " ").trim() : undefined,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  } catch {
    return null;
  }
}

export async function fetchByUrl(url: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const html = await res.text();
    const tags = new Map<string, string[]>();
    for (const match of html.matchAll(/<meta[^>]+name=["'](citation_[a-z_]+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi)) {
      const key = match[1].toLowerCase();
      tags.set(key, [...(tags.get(key) ?? []), match[2]]);
    }
    // content 在 name 之前的写法也兼容
    for (const match of html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["'](citation_[a-z_]+)["'][^>]*>/gi)) {
      const key = match[2].toLowerCase();
      tags.set(key, [...(tags.get(key) ?? []), match[1]]);
    }
    const title = tags.get("citation_title")?.[0];
    if (!title) return null;
    const yearRaw = tags.get("citation_publication_date")?.[0] ?? tags.get("citation_date")?.[0];
    return {
      title,
      creators: tags.get("citation_author") ?? [],
      year: yearRaw ? Number(yearRaw.slice(0, 4)) : undefined,
      venue: tags.get("citation_journal_title")?.[0] ?? tags.get("citation_conference_title")?.[0],
      doi: tags.get("citation_doi")?.[0],
      arxivId: tags.get("citation_arxiv_id")?.[0],
      abstract: tags.get("citation_abstract")?.[0],
      url,
      pdfUrl: tags.get("citation_pdf_url")?.[0],
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS（metadata 7 个测试）

- [ ] **Step 6: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): metadata clients (crossref, arxiv, citation meta tags)"
```

---

### Task 5: POST /api/import/file（PDF 上传导入）

**Files:**
- Create: `packages/backend/src/lib/importfile.ts`
- Create: `packages/backend/src/routes/import.ts`
- Modify: `packages/backend/src/server.ts`（注册 multipart + 路由）
- Modify: `packages/backend/package.json`（加 @fastify/multipart）
- Create: `packages/backend/migrations/003_metadata_status.sql`
- Test: `packages/backend/test/import-file.test.ts`

**Interfaces:**
- Consumes: `newKey`、`extractPdfHints`、`fetchByDoi/fetchByArxiv`、`buildServer` options
- Produces: `POST /api/import/file`（multipart 字段名 `file`）→ `{ item: ItemRow, metadata_status: "complete" | "failed" }`；管线：存文件 → 提取提示 → 查元数据（失败不阻断）→ 插库（临时标题 = 文件名去扩展名）。`buildServer(db, opts)` 的 `ServerOptions` 增加 `fetchImpl?: FetchLike`

- [ ] **Step 1: 加依赖 + 迁移**

`packages/backend/package.json` dependencies 加 `"@fastify/multipart": "^8.3.0"`，`pnpm install`。

写 `migrations/003_metadata_status.sql`：

```sql
ALTER TABLE items ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (metadata_status IN ('pending', 'complete', 'failed'));
```

注意：SQLite 的 ALTER ADD COLUMN 支持带 CHECK 的列定义（SQLite ≥ 3.37 支持非空默认值的 CHECK；若实测报错，拆成不带 CHECK 的版本）。在 `test/db.test.ts` 已有迁移测试会自动覆盖 002/003 的执行（items 表测试不变）；加一条断言：

```ts
it("has metadata_status column after migrations", () => {
  dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  const cols = (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toContain("metadata_status");
  db.close();
});
```

`ItemRow` 接口加 `metadata_status: "pending" | "complete" | "failed";`。

- [ ] **Step 2: 写失败测试 test/import-file.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import FormData from "form-data";

const sample = readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf"));

const crossrefJson = {
  message: {
    title: ["Attention Is All You Need"],
    author: [{ given: "Ashish", family: "Vaswani" }],
    issued: { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.48550/arXiv.1706.03762",
  },
};

function fetchOk() {
  return (async () => ({
    ok: true, status: 200,
    json: async () => crossrefJson,
    text: async () => JSON.stringify(crossrefJson),
  })) as unknown as typeof fetch;
}
function fetchBoom() {
  return (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
}

describe("POST /api/import/file", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function multipart() {
    const form = new FormData();
    form.append("file", sample, { filename: "attention.pdf", contentType: "application/pdf" });
    return form;
  }

  it("imports a pdf, stores it, fills metadata from crossref", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchOk() });
    const form = multipart();
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(metadata_status).toBe("complete");
    expect(item.title).toBe("Attention Is All You Need");
    expect(item.year).toBe(2017);
    expect(item.file_path).toBe(`files/${item.id}.pdf`);
    expect(existsSync(join(dir, "files", `${item.id}.pdf`))).toBe(true);
    await app.close();
  });

  it("still imports with provisional title when metadata lookup fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchBoom() });
    const form = multipart();
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(metadata_status).toBe("failed");
    expect(item.title).toBe("attention");
    await app.close();
  });

  it("rejects non-pdf uploads with 400", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchOk() });
    const form = new FormData();
    form.append("file", Buffer.from("hello"), { filename: "note.txt", contentType: "text/plain" });
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

注：`form-data` 是 Node 侧构造 multipart 的测试辅助包，加到 devDependencies（`"form-data": "^4.0.0"`）。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — 路由 404 / multipart 未注册

- [ ] **Step 4: 写 lib/importfile.ts**

```ts
import type Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { newKey } from "./keys.js";
import { extractPdfHints } from "./pdfhints.js";
import { fetchByDoi, fetchByArxiv, type PaperMeta, type FetchLike } from "./metadata.js";
import type { ItemRow } from "../routes/items.js";

export interface ImportResult {
  item: ItemRow;
  metadata_status: "complete" | "failed";
}

export function applyMeta(db: Database.Database, id: string, meta: PaperMeta): void {
  db.prepare(`
    UPDATE items SET title = ?, creators = ?, year = ?, venue = ?, doi = COALESCE(?, doi),
      arxiv_id = COALESCE(?, arxiv_id), abstract = COALESCE(?, abstract), url = COALESCE(?, url),
      metadata_status = 'complete', date_modified = datetime('now')
    WHERE id = ?
  `).run(
    meta.title ?? "Untitled",
    JSON.stringify(meta.creators ?? []),
    meta.year ?? null,
    meta.venue ?? null,
    meta.doi ?? null,
    meta.arxivId ?? null,
    meta.abstract ?? null,
    meta.url ?? null,
    id,
  );
}

export function insertItem(db: Database.Database, fields: {
  title: string; filePath?: string | null; doi?: string | null; arxivId?: string | null;
}): ItemRow {
  const id = newKey();
  db.prepare(`
    INSERT INTO items (id, title, file_path, doi, arxiv_id, metadata_status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, fields.title, fields.filePath ?? null, fields.doi ?? null, fields.arxivId ?? null);
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
}

export async function importPdf(
  db: Database.Database,
  dataDir: string,
  pdfBytes: Uint8Array,
  filename: string,
  fetchImpl: FetchLike,
): Promise<ImportResult> {
  const provisional = filename.replace(/\.pdf$/i, "");
  const id = newKey();
  const filePath = `files/${id}.pdf`;
  writeFileSync(join(dataDir, filePath), pdfBytes);

  const hints = await extractPdfHints(pdfBytes);
  const item = insertItemWithId(db, id, provisional, filePath, hints);

  let meta: PaperMeta | null = null;
  if (hints.doi) meta = await fetchByDoi(hints.doi, fetchImpl);
  if (!meta && hints.arxivId) meta = await fetchByArxiv(hints.arxivId, fetchImpl);

  if (meta?.title) {
    applyMeta(db, id, meta);
  } else {
    db.prepare("UPDATE items SET metadata_status = 'failed' WHERE id = ?").run(id);
  }
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  return { item: row, metadata_status: row.metadata_status === "complete" ? "complete" : "failed" };
}

function insertItemWithId(
  db: Database.Database, id: string, title: string, filePath: string,
  hints: { doi: string | null; arxivId: string | null },
): void {
  db.prepare(`
    INSERT INTO items (id, title, file_path, doi, arxiv_id, metadata_status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, title, filePath, hints.doi, hints.arxivId);
}
```

注：`insertItem`（Task 6 用，无 id 外部传入）与 `insertItemWithId` 有重复是刻意的——若实现时你认为可以合并为一个带可选 id 的函数，合并并把两个导出都保留为包装。不要删测试。

- [ ] **Step 5: 写 routes/import.ts**

```ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { importPdf } from "../lib/importfile.js";
import type { FetchLike } from "../lib/metadata.js";

export interface ImportDeps {
  dataDir: string;
  fetchImpl: FetchLike;
}

export function registerImportRoutes(app: FastifyInstance, db: Database.Database, deps: ImportDeps): void {
  app.post("/api/import/file", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "missing file field" });
    const filename = data.filename ?? "upload.pdf";
    if (!/\.pdf$/i.test(filename) && data.mimetype !== "application/pdf") {
      return reply.code(400).send({ error: "only PDF uploads are supported" });
    }
    const buf = await data.toBuffer();
    const result = await importPdf(db, deps.dataDir, new Uint8Array(buf), filename, deps.fetchImpl);
    return result;
  });
}
```

- [ ] **Step 6: 改 server.ts 注册 multipart + import 路由（完整替换）**

```ts
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import { openDb, resolveDataDir } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerImportRoutes } from "./routes/import.js";
import type { FetchLike } from "./lib/metadata.js";

export interface ServerOptions {
  dataDir?: string;
  fetchImpl?: FetchLike;
}

export function buildServer(db: Database.Database = openDb(), opts: ServerOptions = {}) {
  const dataDir = opts.dataDir ?? resolveDataDir();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const app = Fastify({ logger: false });
  void app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db, { dataDir });
  registerCollectionRoutes(app, db);
  registerTagRoutes(app, db);
  registerImportRoutes(app, db, { dataDir, fetchImpl });
  return app;
}
```

注：`app.register(multipart)` 是异步插件注册；fastify 的 inject 会等待 ready。若测试出现 "multipart not parsed"，确认 register 在路由注册之前完成（上面顺序已满足）。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/backend pnpm-lock.yaml
git commit -m "feat(backend): pdf file import with metadata pipeline"
```

---

### Task 6: POST /api/import/identifier（DOI/arXiv/URL 导入）

**Files:**
- Create: `packages/backend/src/lib/importidentifier.ts`
- Modify: `packages/backend/src/routes/import.ts`
- Test: `packages/backend/test/import-identifier.test.ts`

**Interfaces:**
- Consumes: Task 4 客户端、Task 5 的 `applyMeta`/`insertItem`
- Produces: `POST /api/import/identifier` `{ input: string }` → `{ item: ItemRow, pdf_downloaded: boolean, duplicate: boolean }`；识别 DOI / arXiv ID / URL；arXiv 自动下载 PDF；DOI 有 OA pdfUrl 时尝试下载；已存在（doi 或 arxiv_id 匹配）返回 `duplicate: true` 不新建

- [ ] **Step 1: 写失败测试 test/import-identifier.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

const crossrefJson = {
  message: {
    title: ["Some DOI Paper"],
    author: [{ given: "Jane", family: "Doe" }],
    issued: { "date-parts": [[2021]] },
    "container-title": ["Nature"],
    DOI: "10.1000/xyz123",
  },
};

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <summary>Dominant…</summary>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`;

function fakeFetch() {
  return (async (url: unknown) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      return { ok: true, status: 200, json: async () => crossrefJson, text: async () => JSON.stringify(crossrefJson), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (u.includes("export.arxiv.org")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => arxivXml, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (u.includes("arxiv.org/pdf")) {
      const bytes = new TextEncoder().encode("%PDF-fake-arxiv");
      return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }) as unknown as typeof fetch;
}

describe("POST /api/import/identifier", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const app = buildServer(db, { dataDir: dir, fetchImpl: fakeFetch() });
    return { db, app };
  }

  it("imports by DOI (metadata only, no pdf)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    expect(res.statusCode).toBe(200);
    const { item, pdf_downloaded, duplicate } = res.json();
    expect(item.title).toBe("Some DOI Paper");
    expect(item.venue).toBe("Nature");
    expect(pdf_downloaded).toBe(false);
    expect(duplicate).toBe(false);
    await app.close();
  });

  it("imports by arXiv id and downloads the pdf", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "1706.03762" } });
    const { item, pdf_downloaded } = res.json();
    expect(item.title).toBe("Attention Is All You Need");
    expect(pdf_downloaded).toBe(true);
    expect(existsSync(join(dir, "files", `${item.id}.pdf`))).toBe(true);
    await app.close();
  });

  it("detects duplicates by doi and returns the existing item", async () => {
    const { app } = await setup();
    const first = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    const second = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    expect(second.json().duplicate).toBe(true);
    expect(second.json().item.id).toBe(first.json().item.id);
    await app.close();
  });

  it("400s on unrecognizable input", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "hello world" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — 路由不存在

- [ ] **Step 3: 写 lib/importidentifier.ts**

```ts
import type Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchByDoi, fetchByArxiv, fetchByUrl, type PaperMeta, type FetchLike } from "./metadata.js";
import { insertItem, applyMeta } from "./importfile.js";
import type { ItemRow } from "../routes/items.js";

const DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const ARXIV_RE = /^(?:arXiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i;

export interface IdentifierResult {
  item: ItemRow;
  pdf_downloaded: boolean;
  duplicate: boolean;
}

export function classifyInput(input: string): { kind: "doi" | "arxiv" | "url"; value: string } | null {
  const s = input.trim();
  if (DOI_RE.test(s)) return { kind: "doi", value: s };
  const ax = s.match(ARXIV_RE);
  if (ax) return { kind: "arxiv", value: ax[1] };
  if (/^https?:\/\//i.test(s)) return { kind: "url", value: s };
  const doiInUrl = s.match(/(?:doi\.org\/)(10\.\d{4,9}\/[^\s]+)/i);
  if (doiInUrl) return { kind: "doi", value: doiInUrl[1] };
  return null;
}

function findDuplicate(db: Database.Database, meta: PaperMeta): ItemRow | null {
  if (meta.doi) {
    const row = db.prepare("SELECT * FROM items WHERE doi = ?").get(meta.doi) as ItemRow | undefined;
    if (row) return row;
  }
  if (meta.arxivId) {
    const row = db.prepare("SELECT * FROM items WHERE arxiv_id = ?").get(meta.arxivId) as ItemRow | undefined;
    if (row) return row;
  }
  return null;
}

async function tryDownloadPdf(
  pdfUrl: string, dataDir: string, itemId: string, fetchImpl: FetchLike,
): Promise<string | null> {
  try {
    const res = await fetchImpl(pdfUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 1024) return null; // 太小，多半不是真 PDF
    const filePath = `files/${itemId}.pdf`;
    writeFileSync(join(dataDir, filePath), buf);
    return filePath;
  } catch {
    return null;
  }
}

export async function importIdentifier(
  db: Database.Database, dataDir: string, input: string, fetchImpl: FetchLike,
): Promise<IdentifierResult | null> {
  const c = classifyInput(input);
  if (!c) return null;

  let meta: PaperMeta | null = null;
  if (c.kind === "doi") meta = await fetchByDoi(c.value, fetchImpl);
  else if (c.kind === "arxiv") meta = await fetchByArxiv(c.value, fetchImpl);
  else meta = await fetchByUrl(c.value, fetchImpl);
  if (!meta?.title) return null;

  const dup = findDuplicate(db, meta);
  if (dup) return { item: dup, pdf_downloaded: false, duplicate: true };

  const item = insertItem(db, { title: meta.title, doi: meta.doi ?? null, arxivId: meta.arxivId ?? null });
  applyMeta(db, item.id, meta);

  let pdf_downloaded = false;
  if (meta.pdfUrl) {
    const filePath = await tryDownloadPdf(meta.pdfUrl, dataDir, item.id, fetchImpl);
    if (filePath) {
      db.prepare("UPDATE items SET file_path = ? WHERE id = ?").run(filePath, item.id);
      pdf_downloaded = true;
    }
  }
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(item.id) as ItemRow;
  return { item: row, pdf_downloaded, duplicate: false };
}
```

- [ ] **Step 4: routes/import.ts 追加 identifier 路由**

文件顶部 import 加：

```ts
import { importIdentifier } from "../lib/importidentifier.js";
import { z } from "zod";
```

在 `registerImportRoutes` 内追加：

```ts
  const identifierSchema = z.object({ input: z.string().trim().min(1) }).strict();

  app.post("/api/import/identifier", async (req, reply) => {
    const parsed = identifierSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "input required" });
    const result = await importIdentifier(db, deps.dataDir, parsed.data.input, deps.fetchImpl);
    if (!result) return reply.code(400).send({ error: "unrecognized identifier or metadata lookup failed" });
    return result;
  });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): identifier import (doi/arxiv/url) with dedup and OA pdf download"
```

---

## 阶段 1 验收清单

- [ ] `pnpm test` 全绿（backend 含 import/collections/tags/metadata/pdfhints/item-detail）
- [ ] 手动：拖 sample.pdf 经 multipart 上传（可用 curl 模拟）入库，元数据补全
- [ ] `POST /api/import/identifier` 传 `1706.03762`（真实网络，需代理时按环境处理）返回论文元数据且 PDF 下载成功
- [ ] `data/files/{id}.pdf` 实际落盘
- [ ] 重复导入同一 DOI 返回 duplicate
