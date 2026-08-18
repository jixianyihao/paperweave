// 语音会话（OpenAI Realtime ephemeral token 模式）：后端代理协商会话，
// 用任务路由 voice 的 provider api_key 调 {base}/realtime/sessions 换 ephemeral
// client_secret 原样回传；BYOK key 不出后端进程边界。
import type Database from "better-sqlite3";
import { resolveRoute } from "./llm/router.js";
import type { FetchLike } from "./metadata.js";

export const VOICE_UNCONFIGURED = "未配置语音服务商";

export interface VoiceContext {
  title?: string;
  abstract?: string | null;
  page?: number | null;
  selectedText?: string;
}

export interface VoiceDeps {
  fetchImpl: FetchLike;
  env?: NodeJS.ProcessEnv;
}

export type VoiceSessionResult =
  | { ok: true; client_secret: string; url: string; model: string }
  | { ok: false; status: 400 | 502; error: string };

/** 实时会话的系统指令：注入当前打开论文的标题/摘要、页码与选中文本 */
export function voiceInstructions(ctx: VoiceContext): string {
  let s = "You are PaperWeave's voice reading companion. Help the user discuss and understand the academic paper they are reading. Answer concisely and in the user's language.";
  const parts: string[] = [];
  if (ctx.title) parts.push(`Paper title: ${ctx.title}`);
  if (ctx.abstract) parts.push(`Paper abstract: ${ctx.abstract}`);
  if (ctx.page) parts.push(`The user is currently on page ${ctx.page}.`);
  if (ctx.selectedText) parts.push(`The user has selected this passage:\n${ctx.selectedText}`);
  if (parts.length) s += `\n\nContext:\n${parts.join("\n")}`;
  return s;
}

function stripSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

/** 代理协商 realtime 会话：成功返回 { client_secret, url, model } */
export async function createVoiceSession(
  db: Database.Database,
  ctx: VoiceContext,
  deps: VoiceDeps,
): Promise<VoiceSessionResult> {
  const resolved = resolveRoute(db, "voice", deps.env);
  if (!resolved.ok) return { ok: false, status: 400, error: VOICE_UNCONFIGURED };
  const { llm } = resolved;
  if (llm.client !== "openai") {
    return { ok: false, status: 400, error: "语音路由需要 OpenAI 兼容的 realtime 端点（当前路由不是 OpenAI 兼容协议）" };
  }
  if (!llm.apiKey) return { ok: false, status: 400, error: "语音服务商缺少 API key" };

  const base = stripSlash(llm.baseUrl);
  let res: Response;
  try {
    res = await deps.fetchImpl(`${base}/realtime/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({ model: llm.model, instructions: voiceInstructions(ctx) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `语音服务商连接失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, status: 502, error: `语音服务商响应错误（${res.status}）` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, error: "语音服务商返回了无效 JSON" };
  }
  const cs = (data as { client_secret?: unknown } | null)?.client_secret;
  const secret = typeof cs === "string" ? cs : (cs as { value?: unknown } | null)?.value;
  if (typeof secret !== "string" || !secret) {
    return { ok: false, status: 502, error: "语音服务商未返回 client_secret" };
  }
  return { ok: true, client_secret: secret, url: `${base}/realtime`, model: llm.model };
}

/** 会话时长上报：写入 usage_log（task=voice，秒数存 seconds 列），provider/model 尽力归因 */
export function recordVoiceUsage(db: Database.Database, seconds: number, env?: NodeJS.ProcessEnv): void {
  const resolved = resolveRoute(db, "voice", env);
  db.prepare("INSERT INTO usage_log (task, provider_id, model, seconds) VALUES ('voice', ?, ?, ?)")
    .run(resolved.ok ? resolved.llm.providerId : null, resolved.ok ? resolved.llm.model : null, seconds);
}
