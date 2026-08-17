# PaperWeave 阶段 5.5+6 并行契约（语音模式 + DMG 打包）

> 两条并行流的唯一事实来源：流 V（语音）、流 P（打包）。偏差先改本文档。

## 共同约束

- 沿用全部既有约束（TDD、零网络测试、apiFetch 唯一入口、主题 token、zod strict）
- 打包目标产物：macOS `.dmg`（Apple Silicon + Intel 尽量 universal）

## 流 V：语音模式（packages/backend + apps/web）

### 架构决策（OpenAI Realtime，ephemeral token 模式）
浏览器与 OpenAI Realtime API 直连走 WebRTC 需要 ephemeral token；为支持自定义端点与将来其他 realtime 服务，采用后端代理协商：

```
POST /api/voice/session  {} →
  成功: { "client_secret": "...", "url": "https://api.openai.com/v1/realtime", "model": "..." }
  失败: 400/502 { "error": "..." }（未配置 voice 路由 → 明确错误 "未配置语音服务商"）
```
- 后端按任务路由 `voice` 找 provider，用其 api_key 调 `{base}/realtime/sessions`（OpenAI 兼容，body 指定 model + instructions）换取 ephemeral client_secret，原样回传
- BYOK key 不出后端进程边界（只在服务端用）；builtin 未配置 → 明确错误
- 注入系统上下文：当前打开论文的标题/摘要（body 可带 `{ itemId?, page?, selectedText? }`，zod strict optional）

### 前端（apps/web）
- `components/voice/VoiceOrb.tsx`：全局悬浮语音球（右下角）+ `⌘⇧V` 快捷键（任何页面可唤起/挂断）
- `lib/voiceSession.ts`：getUserMedia → RTCPeerConnection 连 realtime 端点（data channel + audio track）；状态机 idle→connecting→listening→speaking→error；可打断（realtime 原生 barge-in）
- 实时消耗指示：会话期间显示计时 + 结束后 toast 显示时长；usage 由后端按 session 协商记录（duration 上报 `POST /api/voice/usage { seconds }` → usage_log task=voice）
- 会话结束自动生成摘要：把 transcript（data channel 收到的文本）POST `/api/ai/summarize`，结果存为 `voice_digest` annotation（有 itemId 时）
- 测试：状态机、快捷键注册/卸载、错误路径（无麦克风权限/未配置服务商）；WebRTC 用 mock（不打真实连接）

### 文件边界
- `packages/backend/src/routes/voice.ts` + `src/lib/voice.ts` + server.ts 注册 + 测试
- `apps/web/src/components/voice/**`、`src/lib/voiceSession*`、Root.tsx 挂载 orb、设置页语音分组（开关 + 消耗指示开关）
- **额外任务**：`POST /api/import/ris`（RIS/BibTeX 迁移导入，spec §3.2）：解析 RIS（TY/TI/AU/PY/JO/DO 标签）与 BibTeX（@entry 基本解析），批量建条目（无 PDF，metadata_status complete），返回 `{ imported: number, failed: number }`。文件 `src/lib/risbib.ts` + 路由追加 + 测试（内嵌夹具字符串）

## 流 P：Tauri 打包（apps/desktop + scripts + 构建配置）

目标：`pnpm -F @paperweave/desktop build` 产出可双击安装的 DMG，新机器无需 Node/Docker。

1. **后端 sidecar 化**：后端需打成单文件可执行——调研并选择：Node SEA（`node --experimental-sea-config`）或 `bun build --compile`（若本机有 bun）或 pkg 替代品。验收标准：产出的二进制在 PATH 无 node 的环境下能跑（`env -i` 验证）
2. **Tauri sidecar 集成**：tauri.conf.json `bundle.externalBin` 注册二进制；`src-tauri/src/main.rs` 启动时 spawn sidecar（端口 8471，若被占用则 8472+ 探测并把实际端口经 `tauri://` 环境传给前端——前端 apiFetch 需要支持运行时 baseURL 覆盖，**允许流 P 修改 apps/web/src/api/client.ts 加 `setApiBase()`**，其他 apps/web 文件不碰）
3. **数据目录**：桌面形态 DATA_DIR 指向系统应用数据目录（macOS `~/Library/Application Support/org.paperweave.app/data`），sidecar 启动时传 env
4. **资源打包**：`apps/web/public/reader/`（reader 构建产物）必须进包；先 `pnpm build:reader` 再 build frontend 再 tauri build——写成 `scripts/build-desktop.sh` 一键流程
5. **图标**：用 `pnpm tauri icon` 从一张 1024px 源图生成全套（源图可用程序化生成的简洁字母标"Pw"藏青底）
6. **产物验证**：构建成功 + DMG 文件存在 + 体积记录；如本机无签名证书，ad-hoc 签名即可（记录 Gatekeeper 说明：用户首次打开需右键打开）
7. 测试：Rust 侧无测试框架要求；验证以构建成功 + `env -i` 后端二进制冒烟（/api/health 200）为准

### 文件边界
- `apps/desktop/**`、`scripts/build-desktop.sh`、`scripts/sea-*`（如采用 SEA）、`apps/web/src/api/client.ts`（仅 setApiBase 追加）
- 不碰 packages/backend/src/**（如确需改后端以支持 sidecar，在报告中提出而非直接改）

## 完成定义
- 流 V：backend + web 测试全绿、build 通过、RIS/BibTeX 导入有测试
- 流 P：DMG 产出 + sidecar 冒烟证据 + build-desktop.sh 可复现
