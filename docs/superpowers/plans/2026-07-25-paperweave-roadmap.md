# PaperWeave 实施路线图

> Spec: `docs/superpowers/specs/2026-07-25-paper-reader-design.md`
> 每个阶段一份独立计划文件，阶段完成并验收后再写下一阶段的详细计划。

**Goal:** 开源 AI 原生论文阅读器（Tauri 桌面应用），文献管理 + PDF 阅读 + 任务级模型路由的 LLM 协作。

**Architecture:** Tauri 2 壳 + React/Tailwind 前端 + 内嵌 Fastify/TS 后端（sidecar）+ SQLite（FTS5/sqlite-vec）+ fork zotero/reader。

**Tech Stack:** Node 20+, pnpm workspaces, TypeScript, Fastify 4, better-sqlite3, Vite + React 18 + Tailwind 3, Tauri 2, Vitest, zotero/reader (vendored submodule)

## Global Constraints

- Node ≥ 20；zotero/reader 构建必须带 `NODE_OPTIONS=--openssl-legacy-provider`
- 包管理器：pnpm workspaces（不用 npm/yarn）
- 数据库仅 SQLite（better-sqlite3 + WAL），禁止引入 Postgres/MinIO
- 数据目录：`data/`（`DATA_DIR` 环境变量可覆盖），PDF 存 `data/files/{itemKey}.pdf`
- API Key 只存系统钥匙串（Tauri keyring），DB 仅存引用
- 前端主题：学术期刊风（浅色纸张底 #fbfaf7、藏青 #1a3a8a、暗金 #8a6d1a）为默认，暗色为备选主题
- 所有 AI 调用必须走 LLM 网关的任务路由，禁止前端直连模型 API
- 许可证 AGPL-3.0；fork 的 zotero/reader 保留原许可证声明

## 阶段拆分

| 阶段 | 计划文件 | 验收标准 | 状态 |
|---|---|---|---|
| 0 基座 | `2026-07-25-paperweave-phase0-foundation.md` | 应用启动，能打开内置示例 PDF；后端健康检查通过 | ✅ 已出计划 |
| 1 后端核心 | `paperweave-phase1-backend.md`（阶段 0 完成后编写） | 拖入 PDF / 粘贴 DOI 入库成功，元数据自动补全 | ⬜ |
| 2 文献库 UI | `paperweave-phase2-library-ui.md` | 三栏管理 100 篇文献流畅；集合/标签/收藏/待读/⌘K 可用 | ⬜ |
| 3 LLM 网关 | `paperweave-phase3-llm-gateway.md` | BYOK 与内置额度双路径可用；摘要/解释/翻译接口通 | ⬜ |
| 4 阅读器二开 | `paperweave-phase4-reader.md` | 选中→AI→沉淀时间流→跳回原文闭环 | ⬜ |
| 5 问答+语音 | `paperweave-phase5-qa-voice.md` | 全文问答带可点击引用；语音可打断 | ⬜ |
| 6 发布 | `paperweave-phase6-release.md` | 三平台安装包新机器下载即用；RIS/BibTeX 迁移 | ⬜ |

## 仓库结构（阶段 0 建立，后续阶段沿用）

```
paperweave/                      # 本仓库根
├── package.json                 # pnpm workspace 根
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                     # React 前端（Vite）
│   └── desktop/                 # Tauri 壳（src-tauri）
├── packages/
│   └── backend/                 # Fastify 后端（桌面 sidecar / Web 服务器共用）
├── vendor/
│   └── zotero-reader/           # zotero/reader fork（git submodule）
├── scripts/
│   └── build-reader.sh          # 构建 reader 并拷贝到 apps/web/public/reader
├── data/                        # 运行时数据（gitignore）：library.sqlite + files/
└── docs/superpowers/            # specs + plans
```
