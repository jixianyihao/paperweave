import type Database from "better-sqlite3";
import { streamOpenAiChat, pingOpenAi } from "./openai.js";
import { streamAnthropicChat, pingAnthropic } from "./anthropic.js";
import type { ChatMessage, LlmUsage, DeltaHandler, FetchLike } from "./common.js";

export const AI_TASKS = ["translate", "summarize", "explain", "qa", "voice", "embedding"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface ProviderRow {
  id: string;
  kind: "builtin" | "anthropic" | "openai" | "custom";
  label: string;
  base_url: string | null;
  api_key: string | null;
  models: string;
  enabled: number;
}

export interface ResolvedLlm {
  client: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string | null;
  model: string;
  providerId: string | null;
}

export type ResolveResult = { ok: true; llm: ResolvedLlm } | { ok: false; error: string };

export const BUILTIN_UNCONFIGURED = "未配置模型，请在设置中添加服务商";

const DEFAULT_BASE_URL = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
} as const;

const DEFAULT_MODEL = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  builtin: "gpt-4o-mini",
} as const;

function firstModel(modelsJson: string): string | null {
  try {
    const arr = JSON.parse(modelsJson) as unknown;
    if (Array.isArray(arr) && typeof arr[0] === "string" && arr[0]) return arr[0];
  } catch { /* fall through */ }
  return null;
}

function fromProvider(provider: ProviderRow, routeModel: string | null, env: NodeJS.ProcessEnv = process.env): ResolveResult {
  if (!provider.enabled) return { ok: false, error: `provider "${provider.label}" is disabled` };
  if (provider.kind === "builtin") {
    // builtin 行的语义 = 环境变量内置端点，与 resolveProvider（/test 端点）保持一致；
    // 保留行 id 以便 usage_log 归因到该 provider
    const res = fromBuiltinEnv(env, routeModel);
    if (res.ok) res.llm.providerId = provider.id;
    return res;
  }
  if (provider.kind === "anthropic") {
    if (!provider.api_key) return { ok: false, error: `provider "${provider.label}" 未配置 API key` };
    return {
      ok: true,
      llm: {
        client: "anthropic",
        baseUrl: provider.base_url ?? DEFAULT_BASE_URL.anthropic,
        apiKey: provider.api_key,
        model: routeModel ?? firstModel(provider.models) ?? DEFAULT_MODEL.anthropic,
        providerId: provider.id,
      },
    };
  }
  // openai / custom 类型的 provider 行按 OpenAI 兼容协议处理
  const baseUrl = provider.base_url ?? (provider.kind === "openai" ? DEFAULT_BASE_URL.openai : null);
  if (!baseUrl) return { ok: false, error: `provider "${provider.label}" 缺少 base_url` };
  return {
    ok: true,
    llm: {
      client: "openai",
      baseUrl,
      apiKey: provider.api_key,
      model: routeModel ?? firstModel(provider.models) ?? DEFAULT_MODEL.openai,
      providerId: provider.id,
    },
  };
}

function fromBuiltinEnv(env: NodeJS.ProcessEnv, routeModel: string | null): ResolveResult {
  const key = env.PAPERWEAVE_BUILTIN_KEY;
  const base = env.PAPERWEAVE_BUILTIN_BASE;
  if (!key || !base) return { ok: false, error: BUILTIN_UNCONFIGURED };
  return {
    ok: true,
    llm: {
      client: "openai",
      baseUrl: base,
      apiKey: key,
      model: routeModel ?? env.PAPERWEAVE_BUILTIN_MODEL ?? DEFAULT_MODEL.builtin,
      providerId: null,
    },
  };
}

// resolveRoute(task)：task_routes 指向 provider 则用之，否则回落内置（环境变量）路由
export function resolveRoute(db: Database.Database, task: AiTask, env: NodeJS.ProcessEnv = process.env): ResolveResult {
  const route = db.prepare("SELECT provider_id, model FROM task_routes WHERE task = ?").get(task) as
    | { provider_id: string | null; model: string | null }
    | undefined;
  if (route?.provider_id) {
    const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(route.provider_id) as ProviderRow | undefined;
    if (!provider) return { ok: false, error: "task route references an unknown provider" };
    return fromProvider(provider, route.model, env);
  }
  return fromBuiltinEnv(env, route?.model ?? null);
}

// 供 providers 测试端点使用：直接按 provider 行解析（不看 task_routes）
export function resolveProvider(provider: ProviderRow, env: NodeJS.ProcessEnv = process.env): ResolveResult {
  if (provider.kind === "builtin") return fromBuiltinEnv(env, null);
  return fromProvider(provider, null, env);
}

export type StreamTaskResult =
  | ({ ok: true } & LlmUsage)
  | { ok: false; error: string };

export async function streamTask(
  db: Database.Database,
  task: AiTask,
  messages: ChatMessage[],
  opts: { fetchImpl: FetchLike; onDelta: DeltaHandler; onThinking?: DeltaHandler; maxTokens?: number },
): Promise<StreamTaskResult> {
  const resolved = resolveRoute(db, task);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { llm } = resolved;
  try {
    const usage = llm.client === "anthropic"
      ? await streamAnthropicChat({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, messages, maxTokens: opts.maxTokens, fetchImpl: opts.fetchImpl, onDelta: opts.onDelta })
      : await streamOpenAiChat({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, messages, maxTokens: opts.maxTokens, fetchImpl: opts.fetchImpl, onDelta: opts.onDelta, onThinking: opts.onThinking });
    db.prepare("INSERT INTO usage_log (task, provider_id, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?)")
      .run(task, llm.providerId, llm.model, usage.tokensIn, usage.tokensOut);
    return { ok: true, ...usage };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pingLlm(llm: ResolvedLlm, fetchImpl: FetchLike): Promise<void> {
  if (llm.client === "anthropic") {
    await pingAnthropic({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, fetchImpl });
  } else {
    await pingOpenAi({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, fetchImpl });
  }
}
