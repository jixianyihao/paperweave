import { describe, it, expect } from "vitest";
import { streamOpenAiChat, pingOpenAi } from "../src/lib/llm/openai.js";
import { streamAnthropicChat, pingAnthropic } from "../src/lib/llm/anthropic.js";

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fakeFetch(res: Response, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    return res;
  }) as unknown as typeof fetch;
}

describe("streamOpenAiChat", () => {
  it("parses SSE deltas and usage from an openai-compatible stream", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const deltas: string[] = [];
    const result = await streamOpenAiChat({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fakeFetch(sseResponse(sse)),
      onDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Hello", " world"]);
    expect(result).toEqual({ tokensIn: 11, tokensOut: 7 });
  });

  it("sends auth header, model and stream flag to /chat/completions", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const sse = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n';
    await streamOpenAiChat({
      baseUrl: "https://example.com/v1/",
      apiKey: "sk-key",
      model: "deepseek-chat",
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
      fetchImpl: fakeFetch(sseResponse(sse), capture),
      onDelta: () => {},
    });
    expect(capture.url).toBe("https://example.com/v1/chat/completions");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-key");
    const body = JSON.parse(String(capture.init?.body));
    expect(body.model).toBe("deepseek-chat");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(2);
  });

  it("returns null token counts when the stream carries no usage", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n';
    const result = await streamOpenAiChat({
      baseUrl: "https://example.com/v1",
      apiKey: null,
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fakeFetch(sseResponse(sse)),
      onDelta: () => {},
    });
    expect(result).toEqual({ tokensIn: null, tokensOut: null });
  });

  it("throws with status and body snippet on http error", async () => {
    const res = new Response("rate limited", { status: 429 });
    await expect(streamOpenAiChat({
      baseUrl: "https://example.com/v1",
      apiKey: null,
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fakeFetch(res),
      onDelta: () => {},
    })).rejects.toThrow(/429/);
  });
});

describe("pingOpenAi", () => {
  it("resolves on 2xx and throws otherwise", async () => {
    const ok = fakeFetch(new Response('{"choices":[{"message":{"content":"hi"}}]}', { status: 200 }));
    await expect(pingOpenAi({ baseUrl: "https://example.com/v1", apiKey: "k", model: "m", fetchImpl: ok })).resolves.toBeUndefined();
    const bad = fakeFetch(new Response("nope", { status: 401 }));
    await expect(pingOpenAi({ baseUrl: "https://example.com/v1", apiKey: "k", model: "m", fetchImpl: bad })).rejects.toThrow(/401/);
  });
});

describe("streamAnthropicChat", () => {
  it("parses content_block_delta events and usage", async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25}}}',
      "",
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}',
      "",
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}',
      "",
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":9}}',
      "",
      'event: message_stop',
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    const deltas: string[] = [];
    const result = await streamAnthropicChat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      model: "claude-test",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      fetchImpl: fakeFetch(sseResponse(sse)),
      onDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Bon", "jour"]);
    expect(result).toEqual({ tokensIn: 25, tokensOut: 9 });
  });

  it("sends x-api-key and anthropic-version headers, splits system out of messages", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const sse = 'data: {"type":"message_stop"}\n\n';
    await streamAnthropicChat({
      baseUrl: "https://api.anthropic.com/",
      apiKey: "sk-ant-key",
      model: "claude-test",
      messages: [{ role: "system", content: "sys prompt" }, { role: "user", content: "u" }],
      fetchImpl: fakeFetch(sseResponse(sse), capture),
      onDelta: () => {},
    });
    expect(capture.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(capture.init?.body));
    expect(body.system).toBe("sys prompt");
    expect(body.messages).toEqual([{ role: "user", content: "u" }]);
    expect(body.stream).toBe(true);
  });

  it("throws on http error", async () => {
    const res = new Response("overloaded", { status: 529 });
    await expect(streamAnthropicChat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fakeFetch(res),
      onDelta: () => {},
    })).rejects.toThrow(/529/);
  });
});

describe("pingAnthropic", () => {
  it("resolves on 2xx and throws otherwise", async () => {
    const ok = fakeFetch(new Response('{"content":[{"text":"hi"}]}', { status: 200 }));
    await expect(pingAnthropic({ baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m", fetchImpl: ok })).resolves.toBeUndefined();
    const bad = fakeFetch(new Response("bad key", { status: 401 }));
    await expect(pingAnthropic({ baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m", fetchImpl: bad })).rejects.toThrow(/401/);
  });
});
