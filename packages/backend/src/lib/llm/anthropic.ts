import { readSse, httpError, type ChatMessage, type LlmUsage, type DeltaHandler, type FetchLike } from "./common.js";

export interface AnthropicChatOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  fetchImpl?: FetchLike;
  onDelta: DeltaHandler;
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
}

function splitSystem(messages: ChatMessage[]): { system?: string; rest: { role: "user" | "assistant"; content: string }[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const rest = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, rest };
}

// Anthropic Messages API 流式客户端
export async function streamAnthropicChat(opts: AnthropicChatOptions): Promise<LlmUsage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { system, rest } = splitSystem(opts.messages);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  const res = await fetchImpl(endpoint(opts.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: rest,
    }),
  });
  if (!res.ok) throw await httpError(res, "anthropic messages");

  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  await readSse(res, (data) => {
    let parsed: {
      type?: string;
      delta?: { type?: string; text?: string };
      message?: { usage?: { input_tokens?: number } };
      usage?: { output_tokens?: number };
    };
    try { parsed = JSON.parse(data); } catch { return; }
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
      opts.onDelta(parsed.delta.text);
    } else if (parsed.type === "message_start" && typeof parsed.message?.usage?.input_tokens === "number") {
      tokensIn = parsed.message.usage.input_tokens;
    } else if (parsed.type === "message_delta" && typeof parsed.usage?.output_tokens === "number") {
      tokensOut = parsed.usage.output_tokens;
    }
  });
  return { tokensIn, tokensOut };
}

export interface AnthropicPingOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  fetchImpl?: FetchLike;
}

export async function pingAnthropic(opts: AnthropicPingOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  const res = await fetchImpl(endpoint(opts.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw await httpError(res, "anthropic ping");
}
