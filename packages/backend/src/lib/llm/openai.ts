import { readSse, httpError, type ChatMessage, type LlmUsage, type DeltaHandler, type FetchLike } from "./common.js";

export interface OpenAiChatOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  fetchImpl?: FetchLike;
  onDelta: DeltaHandler;
  /** 思考过程增量（Kimi K2.6 / DeepSeek R1 等的 reasoning_content） */
  onThinking?: DeltaHandler;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

// OpenAI 兼容 chat completions 流式客户端（fetch + SSE 解析），支持自定义 base_url
export async function streamOpenAiChat(opts: OpenAiChatOptions): Promise<LlmUsage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetchImpl(endpoint(opts.baseUrl, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) throw await httpError(res, "openai-compatible chat");

  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  await readSse(res, (data) => {
    if (data === "[DONE]") return;
    let parsed: {
      choices?: { delta?: { content?: string; reasoning_content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try { parsed = JSON.parse(data); } catch { return; }
    const thinking = parsed.choices?.[0]?.delta?.reasoning_content;
    if (typeof thinking === "string" && thinking) opts.onThinking?.(thinking);
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) opts.onDelta(delta);
    if (parsed.usage) {
      if (typeof parsed.usage.prompt_tokens === "number") tokensIn = parsed.usage.prompt_tokens;
      if (typeof parsed.usage.completion_tokens === "number") tokensOut = parsed.usage.completion_tokens;
    }
  });
  return { tokensIn, tokensOut };
}

export interface PingOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  fetchImpl?: FetchLike;
}

// 连通性验证：1-token 非流式请求
export async function pingOpenAi(opts: PingOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetchImpl(endpoint(opts.baseUrl, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw await httpError(res, "openai-compatible ping");
}
