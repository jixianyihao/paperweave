# 流 A（后端）完成报告 — PaperWeave 阶段 2+3

分支：`stream-a-backend`（基于 master `31a982a`）
提交范围：`31a982a..4a0dc7b`（7 个 commit）
验证：`pnpm -F @paperweave/backend test` → 17 files / 133 tests 全绿；`pnpm -F @paperweave/backend build`（tsc strict）干净。零新运行时依赖，测试零网络（全部注入 fetchImpl / fake SSE 流）。

## 各项实现

### A1 列表筛选 + 集合成员
- `GET /api/items` 支持 `collection` / `tag` / `status` / `starred` / `q`（可组合），zod strict 校验 query（非法 status/starred → 400），排序 `date_added DESC, id DESC`。
- `GET /api/collections/:id/items`（集合不存在 404；同排序）。
- 文件：`src/routes/items.ts`、`src/routes/collections.ts`；测试 `test/items-filter.test.ts`。

### A2 FTS5 搜索
- `migrations/004_fts.sql`：`items_fts`（external content，rowid 关联）+ insert/update/delete 触发器 + `rebuild` 回填。
- `GET /api/search?q=` → `{ items }`，MATCH 按 rank 排序（id 作 tiebreaker），LIMIT 50；q 缺失 400。
- 用户输入经 `toFtsQuery` 转义（分词 + 双引号包裹 + 前缀 `*`），特殊字符不炸（有测试）。
- 文件：`src/lib/fts.ts`、`src/routes/search.ts`。

### A3 PDF 流式
- `GET /api/items/:id/pdf`：条目/文件缺失 404；`file_path` 只信精确的 `files/<id>.pdf` 形态，其余（含 `../`、其它目录、别人的文件名）一律 404；`application/pdf` + content-length 流式返回。
- 测试覆盖穿越三种形态（`secret/evil.pdf`、`../secret/evil.pdf`、`files/other.pdf`）。

### A4 元数据重试
- `POST /api/items/:id/refetch-metadata` → `{ item, metadata_status }`；无 doi/arxiv → 400，条目不存在 404；doi 失败回落 arxiv；都失败置 `failed`。
- 文件：`src/lib/refetch.ts`（复用 fetchByDoi/fetchByArxiv/applyMeta）；路由挂在 items.ts，fetchImpl 由 buildServer 注入。

### A5 标注与时间流
- `migrations/005_annotations.sql`：annotations/conversations/messages（按契约 SQL，另加两个索引）。
- 端点全量：`GET/POST /api/items/:id/annotations`、`PATCH/DELETE /api/annotations/:id`、`GET /api/conversations/:id`、`POST /api/annotations/:id/messages`（SSE）。
- messages：创建/复用 conversation → 先落 user message → qa 任务流式 → 完成后落 assistant message；未配置 LLM 时发 `{"error":"未配置模型，请在设置中添加服务商"}` 帧（user message 仍落库，不造假文本）。
- 排序：annotations 按 `page, sort_index, created_at, rowid`；messages 按 `created_at, rowid`。**关键修正**：created_at 是秒级、id 是随机 key，同秒插入的消息按 id 排序会乱序 —— 改用 rowid（插入序）作 tiebreaker，并补了专门回归测试。

### A6 LLM 网关
- `migrations/006_llm.sql`：providers/task_routes/usage_log（按契约 SQL）。
- providers CRUD + `POST /api/providers/:id/test`（1-token ping）；响应永不含 api_key（仅 has_key）；custom 必须有 base_url；删除 provider 时把引用它的 task_routes 置 NULL。
- `GET /api/task-routes` 固定返回 6 个 task（缺省 null/null）；`PATCH` upsert，provider_id 必须存在。
- `GET /api/usage` → today/month 总额 + by_task（见「偏差」）。
- `POST /api/ai/{summarize,explain,translate}`：zod strict；SSE 帧 `{"delta"}` … `{"done":true,tokens_in,tokens_out}`；错误 `{"error"}` 帧后结束；每次成功调用写 usage_log。
- LLM 层：`src/lib/llm/openai.ts`（chat completions 流式，`stream_options.include_usage`）、`anthropic.ts`（Messages 流式，x-api-key + anthropic-version 2023-06-01）、`common.ts`（SSE 解析）、`prompts.ts`（summarize brief/bullets、explain 四档、translate 中英、qa；有 itemId 时注入标题/摘要上下文）、`router.ts`（resolveRoute：task_routes → provider，否则回落 `PAPERWEAVE_BUILTIN_KEY`+`PAPERWEAVE_BUILTIN_BASE` 的内置 OpenAI 兼容端点；未配置 → 契约指定错误文案）。

## 与契约的偏差（均为加性/明确化，不改契约语义）

1. **done 帧增加 `annotation_id`**：ai 三端点在有 itemId 时落 ai_* annotation，done 帧附带其 id；messages 的 done 帧附带 `message_id`。契约帧字段原样保留，前端不读新字段也能工作。
2. **`by_task` 统计口径为当月**：契约未说明时间窗，取与 month_tokens 一致的当月口径，按 task 名字典序。
3. **模型缺省值**：provider 无 models 且 route 无 model 时，openai→`gpt-4o-mini`、anthropic→`claude-3-5-haiku-latest`、builtin→`PAPERWEAVE_BUILTIN_MODEL` 或 `gpt-4o-mini`。契约未指定。
4. **tokens 缺报时记 NULL**：上游流未带 usage 时 tokens_in/out 为 null（帧里也是 null），usage 聚合按 0 处理；不伪造数字。
5. **`GET /api/search` 无 q → 400**；`GET /api/collections/:id/items` 集合不存在 → 404；annotation 列表对不存在 item → 404。契约未明确，取与现有路由一致的语义。

## 担忧 / 留给后续

- **anthropic 默认模型名**（`claude-3-5-haiku-latest`）是占位，阶段后续应按实际可用模型调整；用户均可在 provider.models / task_routes 覆盖。
- provider.api_key 明文存 SQLite（契约已注明，阶段 6 钥匙串加固）。
- usage_log 只在流成功结束时写；上游中途失败不计量（无 token 数可记）。
- `POST /api/annotations/:id/messages` 失败路径只发 error 帧，assistant message 不落库 —— conversation 里会留一条未回复的 user message，属预期行为。
