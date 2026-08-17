# PaperWeave 阶段 2+3 并行开发契约

> 本文档是两条并行开发流的**唯一事实来源**。流 A（后端）与流 B（前端）都严格按此契约实现/对接，任何偏差必须先改本文档再改代码。

## 共同约束

- Node ≥ 20，pnpm workspaces，TS strict
- 所有后端写端点 zod `.strict()` 校验；未知字段 400
- 列表排序必须确定性（有 tiebreaker）
- 后端测试零网络（注入 fetchImpl）；前端测试用 mock fetch / testing-library
- 主题色 token：paper `#fbfaf7`、cream `#f3f1ea`、ink `#2b2b28`、navy `#1a3a8a`、gold `#8a6d1a`、line `#e0dcd2`；另加 `muted` `#8a8578`、hover 底色 `#e8e4d8`（收进 tailwind tokens，不再用裸 hex）
- 前端所有 API 调用经过 `apps/web/src/api/client.ts` 的 `apiFetch(path, init?)` 助手（处理 baseURL 与错误），禁止组件里裸写 `/api` fetch
- 提交粒度：每个逻辑单元一个 commit；全部测试绿了才能算完成

## 数据形状（TS 类型，两端共用语义）

```ts
// 条目（后端 ItemRow ↔ 前端 Item 一一对应；creators 是 JSON 字符串数组，前端 JSON.parse）
interface Item {
  id: string;                 // 8 位 key
  title: string;
  creators: string;           // JSON: string[]
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  abstract: string | null;
  file_path: string | null;   // "files/{id}.pdf" 或 null
  reading_status: "unread" | "reading" | "read";
  starred: 0 | 1;
  metadata_status: "pending" | "complete" | "failed";
  date_added: string;         // UTC "YYYY-MM-DD HH:MM:SS"
  date_modified: string;
}

interface Collection { id: string; parent_id: string | null; name: string; item_count: number }
interface Tag { name: string; item_count: number }

// 标注/时间流条目（AI 产物也是 annotation）
interface Annotation {
  id: string;
  item_id: string;
  type: "highlight" | "note" | "ai_summary" | "ai_explain" | "ai_translate" | "ai_qa" | "voice_digest";
  page: number | null;
  position: string | null;    // JSON，reader 选区定位格式（阶段 4 定义细节，先原样存取）
  content: string;            // 高亮原文 / 笔记文本 / AI 输出
  color: string | null;
  created_at: string;
  sort_index: number;
}

interface Provider {
  id: string;                 // newKey()
  kind: "builtin" | "anthropic" | "openai" | "custom";
  label: string;              // 显示名，如 "我的 DeepSeek"
  base_url: string | null;    // custom 必填；anthropic/openai 有默认
  has_key: boolean;           // 永不回传 key 本体
  models: string;             // JSON: string[]，自定义模型名列表
  enabled: 0 | 1;
}

type AiTask = "translate" | "summarize" | "explain" | "qa" | "voice" | "embedding";
interface TaskRoute { task: AiTask; provider_id: string | null; model: string | null }
// provider_id/model 为 null = 内置额度默认路由
```

## 流 A 新增/修改的后端端点（packages/backend）

### A1. 列表筛选与集合成员（migration 不变）
```
GET /api/items?collection=<id>&tag=<name>&status=unread|reading|read&starred=1&q=<text>
  → Item[]（全部参数可选，可组合；q 走 FTS5，见 A2；排序 date_added DESC, id DESC）
GET /api/collections/:id/items → Item[]（同排序）
```

### A2. FTS5 搜索（migration 004_fts.sql）
- 建 `items_fts` FTS5 虚表（title, abstract, venue, creators），content 同步用触发器（insert/update/delete）
- `GET /api/search?q=<text>` → `{ items: Item[] }`（FTS5 MATCH，按 rank 排序，限制 50 条）
- 现有数据回填：迁移里 `INSERT INTO items_fts(items_fts) VALUES('rebuild')`

### A3. PDF 流式读取
```
GET /api/items/:id/pdf → 200 application/pdf 流式返回 data/files/{id}.pdf
  404 条目不存在或无 file_path；防路径穿越（file_path 只信 files/{id}.pdf 形态）
```

### A4. 元数据重试
```
POST /api/items/:id/refetch-metadata → { item, metadata_status }
  用已有 doi/arxiv_id 重跑元数据管线（fetchByDoi/fetchByArxiv），更新条目
  无 doi 且无 arxiv_id → 400
```

### A5. 标注与时间流（migration 005_annotations.sql）
```sql
CREATE TABLE annotations (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('highlight','note','ai_summary','ai_explain','ai_translate','ai_qa','voice_digest')),
  page INTEGER, position TEXT, content TEXT NOT NULL, color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), sort_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, annotation_id TEXT REFERENCES annotations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL, citations TEXT,      -- JSON: [{page, quote}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
```
GET  /api/items/:id/annotations → Annotation[]（按 page, sort_index, created_at 排序）
POST /api/items/:id/annotations { type, content, page?, position?, color? } → Annotation（zod strict）
PATCH /api/annotations/:id { content?, color? } → Annotation
DELETE /api/annotations/:id → 204
GET  /api/conversations/:id → { conversation, messages: Message[] }
POST /api/annotations/:id/messages { content } → 创建/复用 conversation，SSE 流式返回 assistant 回复（先落 user message，LLM 回复完成后落 assistant message）
```

### A6. LLM 网关（migration 006_llm.sql）
```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('builtin','anthropic','openai','custom')),
  label TEXT NOT NULL, base_url TEXT, api_key TEXT,  -- 本地单用户库明文存（桌面钥匙串在阶段6加固，已在 spec 开放问题记录）
  models TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE task_routes (task TEXT PRIMARY KEY, provider_id TEXT, model TEXT);
CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, provider_id TEXT, model TEXT,
  tokens_in INTEGER, tokens_out INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
```
GET/POST /api/providers            PATCH/DELETE /api/providers/:id
  POST body: { kind, label, base_url?, api_key?, models?: string[] }（zod strict）
  响应永不包含 api_key，只有 has_key
POST /api/providers/:id/test → { ok: boolean, error?: string }（对 provider 发一个 1-token 请求验证连通）
GET /api/task-routes → TaskRoute[]（6 个 task 全返回，缺省为 null/null）
PATCH /api/task-routes { task, provider_id, model }（zod strict）
GET /api/usage → { today_tokens: number, month_tokens: number, by_task: { task, tokens }[] }

POST /api/ai/summarize  { text, level?: "brief"|"bullets", itemId?, page? } → SSE
POST /api/ai/explain    { text, level?: "eli5"|"undergrad"|"grad"|"expert", itemId?, page? } → SSE
POST /api/ai/translate  { text, targetLang?: "zh"|"en", itemId?, page? } → SSE
  SSE 帧：data: {"delta": "..."} … data: {"done": true, "tokens_in": n, "tokens_out": n}
  错误：data: {"error": "..."} 后结束
```

LLM 调用实现要点：
- `src/lib/llm/router.ts`：`resolveRoute(task)` → (provider, model)；provider 为 null 时用内置默认（V1 内置代理未上线，内置 = 环境变量 `PAPERWEAVE_BUILTIN_KEY` + `PAPERWEAVE_BUILTIN_BASE` 的 OpenAI 兼容端点；未配置时返回明确错误 "未配置模型，请在设置中添加服务商"）
- `src/lib/llm/openai.ts`：OpenAI 兼容 chat completions **流式**客户端（fetch + ReadableStream 解析 SSE），支持自定义 base_url
- `src/lib/llm/anthropic.ts`：Anthropic Messages API 流式（x-api-key 头，anthropic-version: 2023-06-01）
- Prompt 模板在 `src/lib/llm/prompts.ts`：summarize（brief 一句话 / bullets 要点）、explain 四档难度、translate 中英互译；system + user 结构，注入论文标题/摘要作上下文（有 itemId 时）
- 每次调用写 usage_log（SSE 结束时）
- 全部客户端可注入 fetchImpl，测试零网络（fake SSE 流）

## 流 B 前端范围（apps/web）

只做前端；后端未就绪的接口用 `apps/web/src/api/mock.ts`（msw 或手写 mock server worker，dev 环境可用 `?mock=1` 开启）。页面与交互按已定稿 UX：

1. **文献库主页（C 方案已定稿）**：左导航（全部文献/待读/在读/已读/收藏 + 集合树 + 标签云）｜中紧凑条目列表（标题/作者/年份/状态/星标，点击选中，⌘↑↓ 导航）｜右侧 AI 预览面板（元数据 + abstract + AI 摘要占位 + 「重试元数据」按钮当 metadata_status=failed）
2. **⌘K 命令面板**：搜索（GET /api/search?q=）+ 命令（导入/切换主题/跳转待读）
3. **导入**：任意界面拖拽 PDF → 静默上传（POST /api/import/file）+ toast；⌘K 或工具栏「导入」打开全能框（粘贴 DOI/arXiv/URL → POST /api/import/identifier，显示 pdf_downloaded/duplicate 结果）
4. **阅读器入口**：列表双击/回车 → `/read/:itemId`（ReaderPage 改造：iframe src 指向 `/api/items/:id/pdf`；无 PDF 显示「仅元数据」占位）
5. **主题**：期刊风默认 + 暗色切换（tailwind dark class 策略，设置存 localStorage）
6. **状态管理**：Zustand；列表选中态、导航筛选态、toast 队列
7. **设置页骨架**：/settings 路由 + 左侧分组导航（通用/AI 与模型/外观/存储/快捷键），本阶段只实现「外观」分组（主题切换）和「AI 与模型」分组的**服务商列表 + 任务路由 UI**（对接 A6 端点；流 A 未完成时走 mock）

## 文件边界（防冲突）

- 流 A 只碰：`packages/backend/**`
- 流 B 只碰：`apps/web/**`（除 `public/reader/`、`public/samples/`）
- 谁都不碰：根 package.json、pnpm-workspace.yaml、对方目录
- pnpm-lock.yaml 冲突由控制者（我）在合并时重新生成解决

## 完成定义

- 流 A：`pnpm -F @paperweave/backend test` 全绿 + tsc 干净；每个端点有测试
- 流 B：`pnpm -F @paperweave/web test` 全绿 + `vite build` 通过；关键交互有组件测试；mock 模式可手工演示全流程
