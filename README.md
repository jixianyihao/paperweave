# PaperWeave

AI 原生的开源论文阅读与文献管理工具。像 Zotero 一样管理文献，像 SciSpace Copilot 一样用 AI 读论文。

## 功能

- **文献管理**：集合（分组）/ 标签 / 收藏 / 阅读状态（待读·在读·已读）/ ⌘K 全局搜索
- **导入**：拖拽 PDF 静默导入；粘贴 DOI / arXiv / 论文 URL 自动抓取元数据与开放获取 PDF；RIS / BibTeX 迁移导入
- **AI 阅读**：选中任意段落 → 摘要 / 解释（四档难度）/ 翻译 / 追问；右侧统一时间流沉淀高亮、笔记与 AI 产物，可一键跳回原文
- **全文问答**：基于 embedding 检索的库内问答，回答带引用锚点
- **语音模式**：`⌘⇧V` 随时召唤实时语音对话，上下文感知（知道你在看哪篇哪页），结束自动沉淀摘要
- **模型自由**：任务级模型路由——翻译/摘要/解释/问答/语音可分别指派不同模型；支持任意 OpenAI 兼容端点（DeepSeek、Kimi、Ollama、内网网关）+ Anthropic 原生；BYOK 后完全离线可用
- **本地数据主权**：SQLite + 本地文件，数据全在自己机器上

## 安装

从 Releases 下载 `PaperWeave_x.y.z_aarch64.dmg`（目前仅 Apple Silicon），拖入「应用程序」。

首次打开请右键 →「打开」（应用为 ad-hoc 签名）。数据存储在 `~/Library/Application Support/org.paperweave.app/data/`。

## 从源码构建

```bash
# 环境：Node ≥ 20, pnpm ≥ 9, Rust (stable)
git clone <repo> && cd paperweave
pnpm install
pnpm build:reader          # 构建 zotero/reader（首次需要拉取 submodule）
pnpm dev                   # 开发模式：后端 :8471 + 前端 :5173
pnpm dev:desktop           # 开发模式：Tauri 桌面窗口
pnpm -r test               # 全部测试（后端 194 + 前端 164）
bash scripts/build-desktop.sh   # 产出 DMG（apps/desktop/src-tauri/target/release/bundle/dmg/）
```

## 配置模型

设置 → AI 与模型 → 添加服务商。内置 OpenAI 兼容预设：Moonshot Kimi、DeepSeek、OpenAI，或自定义任意兼容端点。在「按任务分配模型」中为翻译/摘要/解释/问答/语音/Embedding 分别指派模型。

## 架构

```
apps/web        React 18 + Vite + Tailwind（文献库 + 阅读器 UI）
apps/desktop    Tauri 2 壳（sidecar 集成、打包）
packages/backend Fastify + better-sqlite3（FTS5 全文搜索、LLM 网关、导入管线）
vendor/zotero-reader zotero/reader（AGPL）作为 PDF 阅读内核
```

后端以 Node SEA 单文件形态内嵌进桌面应用，无需系统 Node。

## 许可证

AGPL-3.0（含 zotero/reader 衍生组件，同样 AGPL-3.0）
