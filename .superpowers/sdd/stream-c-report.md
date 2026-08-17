# Stream C 报告：全文问答后端

分支：`stream-c/qa-backend`（基于 worktree 起点 a7bf9d1，契约 commit）
提交范围：`19e3a59..c4fc351`（5 个 commit，均在 `packages/backend/**` 内）

## 交付物

1. **`migrations/007_chunks.sql`** — 与契约逐字一致（chunks 表 + `chunks_item` 索引，embedding BLOB 存 Float32Array 字节）。
2. **`src/lib/chunking.ts`**
   - `extractPages(pdfBytes)`：pdfjs 逐页提取；items 按 `hasEOL` 组行，行间垂直间距 > 1.5× 中位间距处切段（`\n\n` 分隔段落）；解析失败返回 `[]` 不抛错（与 `extractPdfHints` 一致）。
   - `chunkPages(pages, maxChars = 1500)`：段落感知切块，不跨页、不中段（除非段落本身超长则硬切）；`chunkIndex` 全文递增，确定性。
3. **`src/lib/embedding.ts`**
   - `embedTexts(db, texts, {fetchImpl})`：经 `resolveRoute(db, "embedding")`；仅 OpenAI 兼容客户端（POST `{base}/embeddings`），anthropic 路由视为未配置；未配置返回 `{ ok:false, error: EMBEDDING_UNCONFIGURED }`（"未配置 embedding 模型，全文问答不可用"），不发请求。
   - 成功写 `usage_log`（task=`embedding`, tokens_in=usage.prompt_tokens）；失败不写。
   - `vectorToBlob` / `blobToVector`：Float32Array ↔ BLOB（对齐拷贝）。
4. **`src/lib/ask.ts`**
   - `cosine` / `topK(chunks, query, k)`：brute-force，分数相同保持文档顺序（确定性）。
   - `fullTextQaMessages(question, chunks)`：excerpts 以 `[P{page}]` 前缀注入，system 要求逐句附 `[P{page}]` 引用标记。
   - `parseCitations(answer, chunks)`：按出现顺序解析 `[P\d+]`，按页去重，忽略未检索到的页；`quoteOf` 取 chunk 首尾各 80 字符（短文本全取）。
5. **`src/routes/ask.ts` + server.ts 注册** — `POST /api/items/:id/ask`，zod strict `{ question }`；404 unknown item / 400 invalid body；SSE 帧 `{delta}` → `{done, message_id, citations, tokens_in, tokens_out}`，错误帧 `{error}`。
6. **懒构建**：首次 ask 且无 chunks → 读 `files/<id>.pdf`（沿用 items 路由的防穿越校验）→ extract → chunk →（若已配置则批量嵌入，否则 NULL）→ 事务插入。无 PDF / 无法提取文本 → 明确错误帧。chunks 已有但 embedding 为 NULL 且现已配置 → 回填后再检索。
7. **持久化**：每次 ask 新建 conversation（`annotation_id=NULL`, item_id 关联）；检索成功后落 user message，流式完成后落 assistant message（`citations` 存 JSON 字符串）；qa 调用经 `streamTask` 自动写 usage_log。

## 测试（零网络，全部 fake fetch）

- `test/chunking.test.ts`（7）：段落边界/超长硬切/flush 恢复/空段落/默认 1500/真实 sample.pdf 逐页提取/垃圾 buffer 容错。
- `test/embedding.test.ts`（6）：URL/headers/向量顺序/usage_log；未配置（不发请求）；anthropic 路由拒绝；上游 429 传播；空输入；blob round-trip。
- `test/ask-lib.test.ts`（10）：cosine 已知值/零范数/维度不齐；topK 排序+并列确定性+k 上限；prompt 标记与指令；quoteOf 首尾 80；引用解析顺序/去重/跳未知页/无标记。
- `test/ask.test.ts`（8）：全链路（懒构建→嵌入→top-8→SSE→citations→conversations/messages→usage_log 顺序 embedding/embedding/qa）；二次 ask 复用 chunks（仅问题嵌入）；NULL 回填；未配置错误帧 + NULL embedding 落库 + 无 conversation/usage_log；无 PDF 错误帧；PDF 无文本错误帧；400/404；qa 路由 disabled 错误帧。

## 验证

- `pnpm -F @paperweave/backend test`：**21 文件 / 166 tests 全绿**（master 135 → +31）。
- `pnpm -F @paperweave/backend build`：tsc 干净。

## 偏差与说明

- 段落重建用「行距 > 1.5× 中位行距」启发式（pdfjs 无段落概念），已在 sample.pdf 上验证产生空行分段。
- 每次 ask 新建 conversation（契约未要求多轮历史）；前端拿到 done 帧的 message_id 即可。
- done 帧在契约字段（done/message_id/citations）之外附带 tokens_in/tokens_out，与既有 SSE 端点一致。
- 关注： embedding 批量一次请求（个人库规模 OK）；超大文献（数千 chunks）时单请求 input 可能触 provider 上限，后续可分批。
