# PaperWeave — AI 原生论文阅读与文献管理工具 · 设计文档

日期：2026-07-25
状态：待用户审阅
代号：PaperWeave（正式名待定）

---

## 1. 产品定位

开源（AGPL-3.0）的桌面论文阅读器，面向研究生、科研人员和深度阅读者。

**一句话**：像 Zotero 一样管理文献，像 SciSpace Copilot 一样用 AI 读论文，体验比两者都好。

**核心差异化**：
1. AI 是全程协作者，不是插件——融入导入、阅读、标注、回顾、管理的每个环节
2. 任务级模型路由——翻译/摘要/解释/问答/语音可分别指派不同模型，支持任意 OpenAI 兼容端点
3. 实时语音模式——`⌘⇧V` 随时召唤，上下文感知，可打断
4. 本地数据主权——SQLite + 本地文件，离线完整可用；BYOK 后 AI 也离线可用

**形态**：Tauri 桌面应用（Mac/Windows/Linux），下载安装即用；同一套代码可选部署为 Web 服务（进阶用户自托管）。

---

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 用户范围 | 正式多用户产品，开源 + 内置模型额度变现 |
| 技术底座 | fork zotero/reader（PDF 阅读）+ 全部自研（文献库 UI、后端、LLM 层） |
| 许可证 | AGPL-3.0（用户接受开源） |
| 同步 | V1 不做云同步；桌面本地优先，Web 部署仅作远程访问补充 |
| 数据库 | SQLite（FTS5 全文搜索 + sqlite-vec 向量检索），不引入 Postgres |
| 文件存储 | 本地文件系统，不引入 MinIO/S3 |
| LLM 接入 | 内置额度（官方代理）+ BYOK（自定义服务商/URL/模型）双轨 |
| 阅读器布局 | B 方案：右侧统一时间流（高亮/笔记/AI 条目按页混排）+ 条目就地展开追问线程 |
| 视觉风格 | 学术期刊风（浅色纸张底、衬线标题、藏青+暗金点缀），暗色模式可选 |
| 文献库主页 | C 方案：左导航 + 紧凑列表 + 右侧 AI 预览面板 |
| 导入 | A+C 组合：任意界面拖拽静默导入 + 全能导入框（自动识别 DOI/arXiv/URL/PDF） |
| 语音 | realtime 语音对话，全局召唤，消耗指示默认开，结束自动沉淀摘要 |
| MVP 分期 | 桌面（Tauri）优先；移动端/云同步/浏览器插件后置 |

UX 原型稿存档于 `.superpowers/brainstorm/69672-1784944431/content/`（reader-final-voice / visual-style-paper / library-layout / import-flow / settings-v2-model-routing）。

---

## 3. 功能范围（V1）

### 3.1 文献管理
- **集合（分组）**：树状文件夹，一篇论文可属多个集合
- **标签**：多标签，自动建议（基于 AI 全文摘要的主题标签）
- **收藏**：⭐ 星标，左栏一键筛选
- **阅读任务**：状态机 `待读 → 在读 → 已读`；导入默认「待读」；左栏「待读清单」即阅读队列；打开即转「在读」
- **搜索**：`⌘K` 全局命令面板，搜标题/作者/全文/笔记/AI 摘要/对话，FTS5 支撑
- **排序/筛选**：按日期、期刊、阅读状态、有无 AI 摘要等

### 3.2 导入
- **拖拽静默导入**：任意界面拖入 PDF/文件夹，后台入库 + 元数据补全 + 自动生成 AI 全文摘要，toast 通知
- **全能导入框**（`⌘K` → 导入，或工具栏按钮）：粘贴任意内容自动识别——DOI / arXiv ID / 出版社 URL / 本地 PDF；逐条显示进度与失败原因（如"无开放获取 PDF，仅导入元数据"）
- **元数据管线**：PDF 文本提取 → 正则定位 DOI/标题 → CrossRef API 补全；URL/DOI 抓取复用 Zotero translators（作为库内嵌进后端，不跑独立服务）
- **迁移导入**：RIS / BibTeX 文件导入（Zotero/Mendeley/EndNote 迁移）

### 3.3 阅读器（fork zotero/reader 二开）
- 布局：左大纲｜中 PDF｜右统一时间流
- **统一时间流**：高亮（黄）、笔记（灰）、AI 条目（藏青）按页码混排；每条带页码标签（P3 紧凑式，悬停显示章节+页）和「↩ 跳回原文」
- **选中浮动菜单**：摘要 · 解释 · 翻译 · 追问 · 笔记
- **追问线程**：AI 条目就地展开多轮对话（Slack thread 式），回答带引用锚点可跳回原文页
- 保留 zotero/reader 原生能力：文本选区、高亮、批注、大纲、缩略图、双页/滚动模式

### 3.4 AI 功能
| 功能 | 触发 | 输出 |
|---|---|---|
| 局部摘要 | 选中 → 浮动菜单 | 流内 AI 条目，粒度可选（一句话/要点） |
| 选中解释 | 选中 → 浮动菜单 | 流内 AI 条目，难度分级（小白/本科/研究生/专家） |
| 划选翻译 | 选中 → 浮动菜单 | 流内 AI 条目，中英互译 |
| 选区追问 | 浮动菜单「追问」或条目上点击 | 就地对话线程 |
| 全文问答 | 流底部输入框 | embedding 检索相关切块 + 回答 + 引用锚点 |
| 全文摘要 | 导入后自动生成 | 文献库右侧预览面板 + 流首条 |
| 语音对话 | `⌘⇧V` 或语音球，全局任意界面 | 实时对话；结束后自动摘要进时间流 |

### 3.5 模型与服务商
- **服务商管理**：内置额度、Anthropic、OpenAI、DeepSeek 预设 + 自定义（任意 OpenAI 兼容：Base URL + Key + 模型名；Ollama/LM Studio/内网网关均可）
- **任务级路由**：翻译 / 局部摘要 / 解释 / 追问问答 / 语音 / Embedding 各自独立指派模型；下拉项标注速度/成本/能力
- **默认策略**：零配置时全部走内置额度（服务端成本优化路由）；配 Key 后自动切换；Embedding 默认端侧本地模型（bge-m3 级，零成本零隐私泄露）
- **额度**：设备 ID 计免费额度，免登录开箱即用；登录提升额度（V1 仅做设备额度 + 预留登录接口）

### 3.6 设置
- 通用、AI 与模型（路由 + 服务商）、外观（期刊风/暗色）、存储与备份（数据目录位置、一键导出备份）、快捷键

---

## 4. 技术架构

```
┌─ Tauri 壳（Mac/Win/Linux 安装包，自动更新）────────┐
│  前端 React + Tailwind（学术期刊主题）              │
│  ├ 文献库 UI（自研：导航/列表/AI 预览/Cmd+K）        │
│  └ 阅读器（fork zotero/reader + Copilot 二开）      │
├─ 内嵌后端（TypeScript/Fastify，Tauri sidecar）──────┤
│  ├ 产品 API（条目/集合/标签/标注/文件/设置）          │
│  ├ 元数据管线（PDF 提取 + Zotero translators 库      │
│  │   + CrossRef）                                   │
│  ├ LLM 网关（任务路由 → 内置代理 | BYOK 直连）       │
│  ├ 检索（FTS5 + sqlite-vec）                        │
│  └ 语音桥（WebSocket → Realtime API）               │
├─ 数据（用户本机 data/）─────────────────────────────┤
│  ├ library.sqlite（含 FTS5、vec 虚拟表）             │
│  └ files/{itemKey}.pdf                              │
└────────────────────────────────────────────────────┘

外部服务（唯一官方在线组件）：LLM 代理服务（开源，可自建）
  - 设备额度计量、内置模型路由、成本优化
  - BYOK 请求不经过代理
```

**Web 部署形态**：同一后端跑在服务器上 + 同一前端走浏览器，数据在服务器 `data/`。无多租户（V1 单用户实例）。

### 技术选型
- 前端：React 18 + TypeScript + Tailwind CSS + Zustand；主题变量实现期刊风/暗色双主题
- 桌面：Tauri 2（Rust 壳，系统 WebView）
- 后端：TypeScript + Fastify + better-sqlite3 + sqlite-vec
- PDF：zotero/reader（PDF.js 内核）fork
- 端侧 embedding：Tauri 侧加载 bge-m3（ONNX），或退化为 API embedding（可配置）
- 语音：OpenAI Realtime API / Gemini Live（BYOK 或代理），WebSocket 桥接

---

## 5. 数据模型（SQLite）

```sql
items          -- 文献条目：id, title, creators(json), year, venue, doi, arxiv_id,
               --   url, abstract, file_path, reading_status(待读/在读/已读),
               --   starred, date_added, date_modified
collections    -- 集合树：id, parent_id, name
collection_items -- item ↔ collection 多对多
tags           -- id, name；item_tags 多对多
annotations    -- 统一时间流条目：id, item_id, type(highlight|note|ai_summary|
               --   ai_explain|ai_translate|ai_qa|voice_digest), page,
               --   position(json, zotero/reader 选区定位格式),
               --   content, color, created_at, sort_index
conversations  -- 追问线程：id, annotation_id(可空=全文问答), created_at
messages       -- id, conversation_id, role, content, citations(json:
               --   [{page, position, quote}])
providers      -- 服务商：id, kind(builtin|anthropic|openai|custom),
               --   base_url, api_key(系统钥匙串), models(json), enabled
task_routes    -- 任务路由：task(translate|summarize|explain|qa|voice|embedding),
               --   provider_id, model
settings       -- kv
chunks         -- embedding 切块：id, item_id, page, text,
               --   embedding(vec 虚拟表)
usage_log      -- 额度与消耗记录：id, task, provider, model,
               --   tokens_in, tokens_out, created_at
```

要点：
- `annotations` 一张表统一高亮/笔记/AI 条目——统一时间流的数据基础
- `messages.citations` 存引用锚点（页码 + zotero/reader position 格式），支撑"点引用跳回原文"
- API Key 存系统钥匙串（Tauri keyring），DB 只存引用

---

## 6. API 概览（前后端内部 REST）

```
条目/管理
  GET/POST /api/items            PATCH/DELETE /api/items/:id
  GET/POST /api/collections      GET /api/tags
  POST     /api/import/file      POST /api/import/identifier   (DOI/arXiv/URL)
  POST     /api/import/ris
  GET      /api/items/:id/pdf    (流式返回文件)
  GET      /api/search?q=        (FTS5)

时间流/对话
  GET/POST /api/items/:id/annotations    PATCH/DELETE /api/annotations/:id
  POST     /api/annotations/:id/messages  (追问，SSE 流式)
  POST     /api/items/:id/ask             (全文问答，SSE 流式)

AI 直连操作
  POST /api/ai/summarize   POST /api/ai/explain    POST /api/ai/translate
  {text, itemId, page, position, level?, targetLang?} → SSE 流式

模型/设置
  GET/POST/PATCH /api/providers     POST /api/providers/:id/test
  GET/PATCH      /api/task-routes   GET /api/usage
  WS  /api/voice                   (语音会话桥)

备份
  POST /api/backup/export   (打包 data/ 目录)
```

---

## 7. LLM 交互流

### 7.1 选中操作（摘要/解释/翻译）
1. zotero/reader 选区事件 → 浮动菜单
2. 前端取选中纯文本 + position → `POST /api/ai/*`
3. 后端按 `task_routes` 查路由 → 对应 provider（BYOK 直连 / 内置代理）
4. Prompt 组装：选中文本 + 上下文窗口（同页前后段落）+ 论文元数据（标题/摘要）
5. SSE 流式返回 → 生成 annotation 落库 → 时间流实时出现条目

### 7.2 解释难度分级
四档 system prompt：小白（类比+术语全解释）/ 本科 / 研究生（默认，术语保留、讲清逻辑）/ 专家（直接点出方法与局限）。

### 7.3 全文问答 + 引用锚定
1. 入库时：PDF 全文切块（按页 + 语义边界，~500 token/块）→ 本地 embedding → `chunks`
2. 提问：query embedding → sqlite-vec top-k → 拼上下文
3. 要求模型输出引用标记 `[P3]`；后端映射回 chunk 的 (page, position)
4. 前端渲染可点击锚点 → reader API 跳转并闪烁高亮

### 7.4 语音模式
1. `⌘⇧V` 任意界面唤起 → 采集麦克风 → WebSocket `/api/voice`
2. 后端桥接到路由指定的 Realtime 服务；系统提示注入当前上下文（当前论文/页/选中/最近流条目）
3. 支持打断（realtime 原生）；界面显示实时消耗（usage 事件）
4. 会话结束 → 调用摘要任务路由生成 `voice_digest` annotation 进时间流

### 7.5 成本与失败
- 每次调用写 `usage_log`；内置额度请求先查配额，超限返回明确错误 + 引导（登录/ BYOK）
- BYOK 失败（key 无效、URL 不可达）在设置页"测试"按钮暴露，运行时失败给出可读错误并允许重试

---

## 8. 错误处理原则

- **导入失败不丢**：仅元数据入库，标注"待补全"，可重试抓取
- **AI 失败可降级**：内置额度失败且用户有 BYOK → 提示一键切换；流式中断可续问
- **PDF 损坏**：阅读器降级为占位页 + 错误说明，不崩应用
- **数据库**：WAL 模式；启动时 integrity check，异常时提示从备份恢复
- **语音断连**：自动重连一次，失败则保留已有转写并提示

---

## 9. 测试策略

- **后端**：Vitest 单测（元数据管线、任务路由、切块检索）+ API 集成测试（临时 SQLite）
- **LLM 层**：mock provider 契约测试；prompt 快照测试（分级解释输出结构）
- **前端**：组件测试（时间流、浮动菜单）+ Playwright E2E 核心路径：导入 PDF → 打开 → 选中摘要 → 追问 → 跳转引用
- **桌面**：Tauri 冒烟测试（三平台打包产物启动 + 导入一篇 arXiv 论文）
- **语音**：以接口契约测试为主（realtime 服务 mock），人工验收交互

---

## 10. 分期计划（1–2 人，约 16–19 周）

| 阶段 | 内容 | 预估 | 验收 |
|---|---|---|---|
| 0 基座 | Tauri 工程 + 内嵌后端 + SQLite + reader fork 跑通 | 2 周 | 应用启动，能打开内置示例 PDF |
| 1 后端核心 | 产品 API、PDF 导入、元数据管线（translators + CrossRef） | 3 周 | 拖入 PDF/粘贴 DOI 入库成功 |
| 2 文献库 UI | 三栏、集合/标签/收藏/阅读状态、⌘K、暗色 | 3.5 周 | 管理 100 篇测试文献流畅 |
| 3 LLM 网关 | 任务路由、服务商管理、内置代理服务、摘要/解释/翻译 | 3 周 | BYOK 与内置额度双路径可用 |
| 4 阅读器二开 | 浮动菜单、统一时间流、追问线程 | 3 周 | 完整选中→AI→沉淀→回跳闭环 |
| 5 全文问答+语音 | embedding 检索、引用锚点、realtime 语音桥 | 3 周 | 问答带可点击引用；语音可打断 |
| 6 发布 | 三平台打包签名、自动更新、官网、RIS/BibTeX 迁移 | 2 周 | 新机器下载即用 |

**V1 明确不做**：云同步、多用户/账号体系（仅预留）、浏览器剪藏插件、移动端、PDF 内嵌注释导出、引用格式导出（CSL/BibTeX 导出放 V1.1）。

---

## 11. 开放问题

1. 产品正式命名（PaperWeave 为代号）
2. 内置额度的具体数值与定价（需成本测算后定）
3. 端侧 embedding 模型的体积/性能取舍（bge-m3 ~2GB 是否随包分发，或首次使用时下载）
4. 语音模式默认服务商（OpenAI Realtime vs Gemini Live，按届时价格/质量定）
