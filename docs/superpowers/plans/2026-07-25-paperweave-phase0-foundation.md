# PaperWeave 阶段 0（基座）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 Tauri + React + Fastify + SQLite 的应用骨架：桌面应用能启动，能打开内置示例 PDF，后端健康检查通过。

**Architecture:** pnpm monorepo；Fastify 后端（桌面板内嵌 sidecar 的雏形，开发期独立进程跑在 127.0.0.1:8471）；React/Vite 前端代理 `/api` 到后端；zotero/reader 以 submodule 形式 vendored，构建产物拷入前端 public 目录，用 iframe 嵌入。

**Tech Stack:** Node ≥ 20, pnpm ≥ 9, TypeScript, Fastify 4, better-sqlite3, Vite 5 + React 18 + Tailwind 3, Tauri 2（需 Rust 工具链）, Vitest

## Global Constraints

- Node ≥ 20；zotero/reader 构建必须带 `NODE_OPTIONS=--openssl-legacy-provider`
- 包管理器：pnpm workspaces（不用 npm/yarn）
- 数据库仅 SQLite（better-sqlite3 + WAL），禁止引入 Postgres/MinIO
- 数据目录：`data/`（`DATA_DIR` 环境变量可覆盖），PDF 存 `data/files/`
- 前端主题色：paper `#fbfaf7`、cream `#f3f1ea`、ink `#2b2b28`、navy `#1a3a8a`、gold `#8a6d1a`、line `#e0dcd2`；衬线字体 Georgia
- 所有包版本按本计划锁定，不要自行升级大版本
- 后端端口固定 8471，前端 dev 端口固定 5173

## 前置检查

```bash
node --version    # 期望 >= v20
pnpm --version    # 期望 >= 9；没有则 npm i -g pnpm
rustc --version   # 阶段 8 需要；没有则 curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

### Task 1: Monorepo 骨架

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspace 名称 `@paperweave/backend`、`@paperweave/web`、`@paperweave/desktop`（后续任务注册）；根脚本 `dev`、`dev:desktop`、`test`、`build:reader`

- [ ] **Step 1: 写根 package.json**

```json
{
  "name": "paperweave",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "concurrently -n backend,web -c blue,green \"pnpm -F @paperweave/backend dev\" \"pnpm -F @paperweave/web dev\"",
    "dev:desktop": "concurrently -n backend,web,tauri -c blue,green,yellow \"pnpm -F @paperweave/backend dev\" \"pnpm -F @paperweave/web dev\" \"pnpm -F @paperweave/desktop dev\"",
    "test": "pnpm -r test",
    "build:reader": "bash scripts/build-reader.sh"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

- [ ] **Step 2: 写 pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: 更新 .gitignore**（在现有内容上追加）

```
node_modules/
dist/
data/
.superpowers/
apps/web/public/reader/
apps/desktop/src-tauri/target/
```

- [ ] **Step 4: 验证**

Run: `pnpm install`
Expected: 成功安装 concurrently，无 peer 错误

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore pnpm-lock.yaml
git commit -m "chore: pnpm monorepo scaffold"
```

---

### Task 2: 后端 Fastify 骨架 + 健康检查

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/src/server.ts`
- Create: `packages/backend/src/index.ts`
- Test: `packages/backend/test/health.test.ts`

**Interfaces:**
- Produces: `buildServer(db?: Database.Database): FastifyInstance`（db 参数在 Task 4 接入，本任务签名先就位）；服务监听 `127.0.0.1:8471`；`GET /api/health → { status: "ok", version: "0.1.0" }`

- [ ] **Step 1: 写 packages/backend/package.json**

```json
{
  "name": "@paperweave/backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 写 packages/backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: 写失败测试 packages/backend/test/health.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "0.1.0" });
    await app.close();
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm install && pnpm -F @paperweave/backend test`
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 5: 写 src/server.ts**

```ts
import Fastify from "fastify";
import type Database from "better-sqlite3";

export function buildServer(_db?: Database.Database) {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  return app;
}
```

- [ ] **Step 6: 写 src/index.ts**

```ts
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8471);
const app = buildServer();

app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`backend listening on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 7: 跑测试确认通过 + 手动验证监听**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS 1 test

Run: `pnpm -F @paperweave/backend dev &` 然后 `curl -s http://127.0.0.1:8471/api/health`，随后 `kill %1`
Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 8: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): fastify skeleton with health endpoint"
```

---

### Task 3: SQLite 层 + 迁移执行器

**Files:**
- Create: `packages/backend/src/db.ts`
- Create: `packages/backend/migrations/001_items.sql`
- Test: `packages/backend/test/db.test.ts`

**Interfaces:**
- Produces: `openDb(dir?: string): Database.Database`（建目录、WAL、跑迁移）；`dataDir(): string`（读 `DATA_DIR`，默认 `<cwd>/data`）；`items` 表结构（字段与 spec §5 一致）

- [ ] **Step 1: 写失败测试 packages/backend/test/db.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";

describe("openDb", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("creates data dir, files subdir, and applies migrations", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    expect(existsSync(join(dir, "files"))).toBe(true);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    expect(tables).toContain("items");
    expect(tables).toContain("_migrations");
    db.close();
  });

  it("is idempotent across restarts", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    openDb(dir).close();
    const db = openDb(dir);
    const row = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    expect(row.n).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 3: 写 src/db.ts**

```ts
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function dataDir(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), "data");
}

export function openDb(dir: string = dataDir()): Database.Database {
  mkdirSync(join(dir, "files"), { recursive: true });
  const db = new Database(join(dir, "library.sqlite"));
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(
  db: Database.Database,
  migrationsDir: string = join(import.meta.dirname, "..", "migrations"),
): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map(r => r.name),
  );
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
  }
}
```

- [ ] **Step 4: 写 migrations/001_items.sql**

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creators TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  venue TEXT,
  doi TEXT,
  arxiv_id TEXT,
  url TEXT,
  abstract TEXT,
  file_path TEXT,
  reading_status TEXT NOT NULL DEFAULT 'unread'
    CHECK (reading_status IN ('unread','reading','read')),
  starred INTEGER NOT NULL DEFAULT 0,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS（health 1 + db 2，共 3 个）

- [ ] **Step 6: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): sqlite layer with migration runner and items table"
```

---

### Task 4: GET /api/items 路由

**Files:**
- Create: `packages/backend/src/routes/items.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/test/health.test.ts`（注入临时 db，避免污染真实 data/）
- Test: `packages/backend/test/items.test.ts`

**Interfaces:**
- Consumes: `openDb(dir)`、`buildServer(db?)`（Task 2/3）
- Produces: `registerItemRoutes(app: FastifyInstance, db: Database.Database): void`；`GET /api/items → ItemRow[]`（按 date_added 倒序）；`ItemRow` 类型

- [ ] **Step 1: 写失败测试 packages/backend/test/items.test.ts**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("GET /api/items", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns inserted rows", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run("abc123", "Attention Is All You Need");
    const app = buildServer(db);
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { title: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Attention Is All You Need");
    await app.close();
    db.close();
  });

  it("returns empty array when library is empty", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir));
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.json()).toEqual([]);
    await app.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @paperweave/backend test`
Expected: FAIL — `/api/items` 404

- [ ] **Step 3: 写 src/routes/items.ts**

```ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

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

export function registerItemRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/items", async (): Promise<ItemRow[]> => {
    return db.prepare("SELECT * FROM items ORDER BY date_added DESC").all() as ItemRow[];
  });
}
```

- [ ] **Step 4: 改 src/server.ts 接入 db 与路由**

```ts
import Fastify from "fastify";
import type Database from "better-sqlite3";
import { openDb } from "./db.js";
import { registerItemRoutes } from "./routes/items.js";

export function buildServer(db: Database.Database = openDb()) {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerItemRoutes(app, db);
  return app;
}
```

- [ ] **Step 5: 改 test/health.test.ts 用临时目录 db（完整替换原文件）**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("GET /api/health", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns ok", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir));
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "0.1.0" });
    await app.close();
  });
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm -F @paperweave/backend test`
Expected: PASS 共 5 个

- [ ] **Step 7: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): GET /api/items route"
```

---

### Task 5: 前端骨架 + 期刊风文献库外壳

**Files:**
- Create: `apps/web/package.json`、`apps/web/tsconfig.json`、`apps/web/vite.config.ts`、`apps/web/tailwind.config.js`、`apps/web/postcss.config.js`、`apps/web/index.html`
- Create: `apps/web/src/main.tsx`、`apps/web/src/index.css`、`apps/web/src/App.tsx`、`apps/web/src/test-setup.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces: 期刊风主题色 Tailwind token（`paper/cream/ink/navy/gold/line`）；`App` 三栏外壳组件；dev server `localhost:5173`，`/api` 代理到 `127.0.0.1:8471`

- [ ] **Step 1: 写 apps/web/package.json**

```json
{
  "name": "@paperweave/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "jsdom": "^24.1.1",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 写 apps/web/vite.config.ts**

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8471" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
```

- [ ] **Step 3: 写 apps/web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 写 apps/web/tailwind.config.js 与 postcss.config.js**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#fbfaf7",
        cream: "#f3f1ea",
        ink: "#2b2b28",
        navy: "#1a3a8a",
        gold: "#8a6d1a",
        line: "#e0dcd2",
      },
      fontFamily: {
        serif: ["Georgia", "Songti SC", "serif"],
      },
    },
  },
  plugins: [],
};
```

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: 写 index.html、src/test-setup.ts、src/index.css、src/main.tsx**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PaperWeave</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```ts
// src/test-setup.ts
import "@testing-library/jest-dom";
```

```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: 写失败测试 src/App.test.tsx**

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders library shell with nav entries", () => {
  render(<App />);
  expect(screen.getByText("全部文献")).toBeInTheDocument();
  expect(screen.getByText("待读")).toBeInTheDocument();
  expect(screen.getByText("收藏")).toBeInTheDocument();
});
```

- [ ] **Step 7: 跑测试确认失败**

Run: `pnpm install && pnpm -F @paperweave/web test`
Expected: FAIL — `Cannot find module './App'`

- [ ] **Step 8: 写 src/App.tsx**

```tsx
const NAV = [
  { key: "all", label: "全部文献", icon: "📁" },
  { key: "unread", label: "待读", icon: "🏷" },
  { key: "starred", label: "收藏", icon: "⭐" },
  { key: "reading", label: "在读", icon: "📖" },
  { key: "read", label: "已读", icon: "✓" },
];

export default function App() {
  return (
    <div className="flex h-screen bg-paper text-ink font-serif">
      <nav className="w-56 shrink-0 bg-cream border-r border-line p-3 flex flex-col gap-1">
        <div className="text-lg font-bold mb-2">PaperWeave</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className="text-left px-2 py-1.5 rounded hover:bg-[#e8e4d8] text-sm"
          >
            {n.icon} {n.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 p-4">
        <p className="text-sm text-[#8a8578]">文献列表将在阶段 2 实现</p>
      </main>
      <aside className="w-80 shrink-0 bg-cream border-l border-line p-4">
        <p className="text-sm text-[#8a8578]">AI 预览面板将在阶段 2 实现</p>
      </aside>
    </div>
  );
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `pnpm -F @paperweave/web test`
Expected: PASS 1 test

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): journal-style library shell"
```

---

### Task 6: Vendor zotero/reader 并构建

**Files:**
- Create: `scripts/build-reader.sh`
- Create: `.gitmodules`（由 git submodule 命令生成）

**Interfaces:**
- Produces: `apps/web/public/reader/`（reader 的 web 构建产物，gitignored）；`pnpm build:reader` 脚本

- [ ] **Step 1: 添加 submodule**

Run: `git submodule add https://github.com/zotero/reader vendor/zotero-reader`
Expected: `vendor/zotero-reader/` 出现，`.gitmodules` 生成

> 后续我们会对 reader 做二开（阶段 4），届时把 submodule 的 remote 换成自己的 fork。阶段 0 先用上游。

- [ ] **Step 2: 写 scripts/build-reader.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f vendor/zotero-reader/package.json ]; then
  git submodule update --init vendor/zotero-reader
fi

cd vendor/zotero-reader
NODE_OPTIONS=--openssl-legacy-provider npm install
NODE_OPTIONS=--openssl-legacy-provider npm run build
cd ../..

rm -rf apps/web/public/reader
mkdir -p apps/web/public/reader
cp -R vendor/zotero-reader/web/. apps/web/public/reader/

echo "--- reader web build copied. HTML entries: ---"
ls apps/web/public/reader/*.html
```

- [ ] **Step 3: 构建并确认入口文件名**

Run: `chmod +x scripts/build-reader.sh && pnpm build:reader`
Expected: 构建成功（首次 npm install 较慢）；最后一行列出 `.html` 入口文件

**确认入口文件名**：上面 `ls` 输出的 html 文件名（预期为 `reader.html`）。如果实际文件名不同，记下来，Task 7 的 iframe src 用实际文件名。

- [ ] **Step 4: Commit**

```bash
git add .gitmodules scripts/build-reader.sh
git commit -m "chore: vendor zotero/reader with build script"
```

---

### Task 7: 阅读器页面（iframe 嵌入 + 示例 PDF）

**Files:**
- Create: `apps/web/src/ReaderPage.tsx`
- Create: `apps/web/public/samples/sample.pdf`（curl 下载）
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/src/ReaderPage.test.tsx`

**Interfaces:**
- Produces: 路由 `/read/sample` → 全屏 iframe 加载 reader，传入示例 PDF 路径；后续阶段（4）在同一页面内替换为深度桥接

- [ ] **Step 1: 下载示例 PDF（Attention Is All You Need）**

Run: `mkdir -p apps/web/public/samples && curl -L -o apps/web/public/samples/sample.pdf https://arxiv.org/pdf/1706.03762`
Expected: 文件大小 > 500KB（`ls -la apps/web/public/samples/`）

- [ ] **Step 2: 写失败测试 src/ReaderPage.test.tsx**

```tsx
import { render, screen } from "@testing-library/react";
import ReaderPage from "./ReaderPage";

test("embeds zotero reader pointing at the sample pdf", () => {
  render(<ReaderPage />);
  const frame = screen.getByTitle("reader");
  const src = frame.getAttribute("src") ?? "";
  expect(src).toContain("reader.html");
  expect(src).toContain("sample.pdf");
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @paperweave/web test`
Expected: FAIL — `Cannot find module './ReaderPage'`

- [ ] **Step 4: 写 src/ReaderPage.tsx**（iframe src 中的 `reader.html` 以 Task 6 Step 3 确认的实际入口名为准）

```tsx
export default function ReaderPage() {
  return (
    <iframe
      title="reader"
      src="/reader/reader.html?file=/samples/sample.pdf"
      className="block w-screen h-screen border-0"
    />
  );
}
```

- [ ] **Step 5: 改 src/main.tsx 加路由（完整替换）**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import ReaderPage from "./ReaderPage";
import "./index.css";

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/read/sample", element: <ReaderPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

- [ ] **Step 6: 跑测试确认通过 + 手动验证**

Run: `pnpm -F @paperweave/web test`
Expected: PASS 2 tests

Run: `pnpm dev`，浏览器打开 `http://localhost:5173/read/sample`
Expected: zotero reader 加载并显示 Attention 论文首页

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): reader page embedding zotero/reader with sample pdf"
```

---

### Task 8: Tauri 桌面壳

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/build.rs`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/main.rs`

**Interfaces:**
- Produces: `pnpm -F @paperweave/desktop dev` 启动桌面窗口加载 `localhost:5173`；`pnpm dev:desktop` 一键拉起后端+前端+桌面（生产 sidecar 内嵌在阶段 6 处理）

- [ ] **Step 0: 确认 Rust 工具链**

Run: `rustc --version`
Expected: 输出版本号；若无，先装 rustup（见前置检查）

- [ ] **Step 1: 写 apps/desktop/package.json**

```json
{
  "name": "@paperweave/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 src-tauri/Cargo.toml、build.rs、src/main.rs**

```toml
[package]
name = "paperweave"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

```rust
// build.rs
fn main() {
    tauri_build::build()
}
```

```rust
// src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 写 src-tauri/tauri.conf.json**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "PaperWeave",
  "version": "0.1.0",
  "identifier": "org.paperweave.app",
  "build": {
    "frontendDist": "../../web/dist",
    "devUrl": "http://localhost:5173"
  },
  "app": {
    "windows": [
      { "label": "main", "title": "PaperWeave", "width": 1440, "height": 900 }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

- [ ] **Step 4: 写 src-tauri/capabilities/default.json**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default window capabilities",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 5: 安装依赖并冒烟启动**

Run: `pnpm install && pnpm dev:desktop`
Expected: 三个进程拉起；Tauri 窗口打开，显示文献库外壳（左侧导航含「全部文献/待读/收藏」）；首次 cargo 编译较慢（5–15 分钟）属正常。验证后 Ctrl+C 停止

> 冒烟测试为人工验证：窗口渲染、无白屏、无控制台报错。Tauri 窗口的自动化测试不在阶段 0 范围。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): tauri shell loading the web frontend"
```

---

## 阶段 0 验收清单

- [ ] `pnpm test` 全绿（backend 5 + web 2）
- [ ] `curl http://127.0.0.1:8471/api/health` 返回 ok
- [ ] 浏览器 `localhost:5173` 显示期刊风三栏外壳
- [ ] 浏览器 `localhost:5173/read/sample` 显示 Attention 论文
- [ ] `pnpm dev:desktop` 打开桌面窗口显示文献库外壳
- [ ] `data/library.sqlite` 已创建且包含 `items` 表
