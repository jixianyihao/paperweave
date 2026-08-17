# PaperWeave 阶段 4+5 并行开发契约（阅读器二开 + 全文问答）

> 三条并行流的**唯一事实来源**：流 A（reader 桥接）、流 B（reader UI）、流 C（问答后端）。偏差必须先改本文档。

## 共同约束

- 沿用前序全部约束（TDD、zod strict、零网络测试、主题 token、apiFetch 唯一入口、确定性排序）
- **vendor/zotero-reader 内的文件一律不改**；所有桥接代码放 `scripts/`（构建时注入）或 `apps/web/src/reader/`
- 完成后各自的测试与 build 必须全绿

## 流间接口 1：Reader 桥（流 A 实现，流 B 消费）

zotero/reader 运行在 iframe（`/reader/reader.html?file=...`）。桥接经 `window.postMessage`，协议：

```
iframe → parent（source: "pw-reader"）:
  { source:"pw-reader", type:"ready" }
  { source:"pw-reader", type:"selection",
    payload: { text: string, page: number,
               rect: { x, y, width, height },   // iframe 视口坐标，用于定位浮动菜单
               position: unknown } }            // reader 原生选区对象，原样透传，回跳用
  { source:"pw-reader", type:"selectionCleared" }

parent → iframe（source: "pw-host"）:
  { source:"pw-host", type:"jumpTo", payload: { page?: number, position?: unknown } }
  { source:"pw-host", type:"clearSelection" }
```

**流 A 产出**：
1. `scripts/reader-bootstrap.js` 扩展：加载 reader 后探测其 API（先查 `vendor/zotero-reader/src/index.web.js` 和 demo 页确认 createReader 可用回调/reader 对象方法，如 onSelection/annotation 相关事件；用最小侵入方式拿到选区事件与跳转能力），按上面协议 postMessage。**不改 vendor 内文件**；如 reader 对象未暴露所需能力，允许在 bootstrap 里从 reader 内部 DOM/事件层取（注释说明）。
2. `apps/web/src/reader/bridge.ts`：父窗口侧封装——
   ```ts
   export interface ReaderSelection { text: string; page: number; rect: {x:number;y:number;width:number;height:number}; position: unknown }
   export function attachReaderBridge(iframe: HTMLIFrameElement, handlers: {
     onReady(): void;
     onSelection(sel: ReaderSelection): void;
     onSelectionCleared(): void;
   }): { jumpTo(pageOrPosition: { page?: number; position?: unknown }): void; clearSelection(): void; dispose(): void }
   ```
3. 单元测试（jsdom）：postMessage 协议解析、非法消息忽略、dispose 清理监听。bootstrap 的 reader 内部探测不做单测（靠手工验证）。

## 流间接口 2：全文问答 API（流 C 实现，流 B 消费）

```
POST /api/items/:id/ask
  body: { question: string }                      （zod strict）
  → SSE 流（text/event-stream）：
    data: {"delta": "..."}  …
    data: {"done": true, "message_id": "...", "citations": [{"page": 3, "quote": "原文片段"}]}
    错误：data: {"error": "..."}（如未配置 embedding 或 qa 路由模型）
```

- migration `007_chunks.sql`：
  ```sql
  CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL, embedding BLOB,           -- Float32Array 字节
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX chunks_item ON chunks(item_id);
  ```
- 切块：导入/打开时若 chunks 缺失则构建——用 pdfhints 的 pdfjs 提取全文（逐页），按 ~500 token（约 1500 字符）按段落边界切块，记录 page
- embedding：走任务路由 `embedding` 的服务商（OpenAI 兼容 `/embeddings`）；未配置 → chunks.embedding 为 NULL，ask 返回明确 error 帧 "未配置 embedding 模型，全文问答不可用"
- 检索：JS 内 cosine 相似度 brute-force（个人库规模足够），top-8，注入 prompt 并要求模型输出 `[P{page}]` 引用标记；后端把标记解析成 citations（含该 chunk 的 page + quote 首尾各 80 字符）
- 问答对话落 conversations/messages（item_id 关联，citations JSON 存 messages.citations）
- 每次调用写 usage_log
- **测试零网络**：fake embedding fetch + fake SSE LLM fetch；验证切块边界、cosine top-k、引用解析、usage_log、错误帧

## 流 B 范围（阅读器 UI，apps/web）

消费接口 1（桥）和接口 2（ask）+ 已有端点（annotations CRUD、ai summarize/explain/translate、conversations messages SSE）。

1. **ReaderPage 重写**：三栏——左大纲（reader iframe 自带即可，V1 不重复造）｜中 iframe reader｜右统一时间流面板
2. **统一时间流面板**（`components/reader/Timeline.tsx`）：拉 `GET /api/items/:id/annotations`，按页混排渲染四种条目（高亮黄/笔记灰/AI 藏青/voice_digest），每条显示 `P{page}` 标签 + 「↩ 跳回原文」（调桥 jumpTo）
3. **选中浮动菜单**（`components/reader/FloatingMenu.tsx`）：onSelection → 在 iframe 上方按 rect 定位（考虑 iframe 在页面中的偏移）显示「摘要·解释·翻译·追问·笔记」；点击调对应 SSE 端点，流式结果显示在时间流新条目
4. **追问线程**（`components/reader/Thread.tsx`）：AI 条目就地展开对话（GET /api/conversations/:id 若无则 POST /api/annotations/:id/messages 创建）；SSE 流式追加；assistant 消息里的 citations 渲染为可点击锚点 → 桥 jumpTo
5. **全文问答输入框**：时间流底部，POST /api/items/:id/ask，SSE 流式 + 引用锚点
6. **解释难度选择**：解释操作时弹出四档（小白/本科/研究生/专家，默认研究生）
7. 测试：组件测试（时间流渲染排序、浮动菜单定位与触发、线程展开与 SSE 追加、引用点击调 jumpTo——桥用 mock）、桥 mock 助手 `src/reader/__mocks__/bridge.ts`

## 文件边界

- 流 A：`scripts/**`、`apps/web/src/reader/bridge.ts`、`apps/web/src/reader/bridge.test.ts`
- 流 B：`apps/web/**` 除 `src/reader/bridge.ts*`（用 `src/reader/__mocks__` 里的 mock 替代真实桥）
- 流 C：`packages/backend/**`

## 完成定义

- 流 A：bridge 测试绿；手工验证路径写明（如何看到 selection 事件）
- 流 B：web 测试全绿 + build 通过
- 流 C：backend 测试全绿 + build 干净；ask 端点全链路 fake-fetch 测试
