import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, apiSse, disableMockMode, enableMockMode, type SseFrame } from "./client";
import { resetMockData } from "./mock";
import { aiExplain, aiSummarize, aiTranslate, askItem, sendAnnotationMessage } from "./endpoints";

/** 构造一个 SSE 响应体 */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${f}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function stubSseFetch(frames: string[]) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => sseResponse(frames));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  resetMockData();
  disableMockMode();
  vi.unstubAllGlobals();
  return () => {
    disableMockMode();
    vi.unstubAllGlobals();
  };
});

describe("apiSse（真实模式，fake fetch 流）", () => {
  test("逐帧解析 data: 行并按序回调", async () => {
    stubSseFetch(['{"delta":"你"}', '{"delta":"好"}', '{"done":true,"tokens_in":1,"tokens_out":2}']);
    const frames: SseFrame[] = [];
    await apiSse("/api/ai/summarize", { text: "x" }, (f) => frames.push(f));
    expect(frames).toEqual([{ delta: "你" }, { delta: "好" }, { done: true, tokens_in: 1, tokens_out: 2 }]);
  });

  test("跨 TCP 分包的长帧也能拼齐（按行缓冲）", async () => {
    const encoder = new TextEncoder();
    const payload = `data: {"delta":"一段比较长的增量文本"}\n\ndata: {"done":true}\n\n`;
    const bytes = encoder.encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7, 40));
        controller.enqueue(bytes.slice(40));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const frames: SseFrame[] = [];
    await apiSse("/api/ai/summarize", { text: "x" }, (f) => frames.push(f));
    expect(frames).toEqual([{ delta: "一段比较长的增量文本" }, { done: true }]);
  });

  test("错误帧原样透传（不抛异常，由调用方处理）", async () => {
    stubSseFetch(['{"error":"未配置模型，请在设置中添加服务商"}']);
    const frames: SseFrame[] = [];
    await apiSse("/api/ai/summarize", { text: "x" }, (f) => frames.push(f));
    expect(frames).toEqual([{ error: "未配置模型，请在设置中添加服务商" }]);
  });

  test("HTTP 错误抛 ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid request" }), { status: 400 })),
    );
    await expect(apiSse("/api/ai/summarize", { text: "x" }, () => {})).rejects.toBeInstanceOf(ApiError);
  });

  test("POST body 走 JSON", async () => {
    const spy = stubSseFetch(['{"done":true}']);
    await apiSse("/api/ai/explain", { text: "t", level: "grad" }, () => {});
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "t", level: "grad" });
  });
});

describe("SSE 端点封装（mock 模式）", () => {
  beforeEach(() => {
    enableMockMode();
    return () => disableMockMode();
  });

  test("aiSummarize：流式 delta 后 done 帧带 annotation_id，且标注落库", async () => {
    const frames: SseFrame[] = [];
    await aiSummarize({ text: "selected text", itemId: "attn0001", page: 3 }, (f) => frames.push(f));
    expect(frames.length).toBeGreaterThan(1);
    const done = frames[frames.length - 1];
    expect(done.done).toBe(true);
    expect(typeof done.annotation_id).toBe("string");
    const deltas = frames.slice(0, -1).map((f) => f.delta ?? "").join("");
    expect(deltas.length).toBeGreaterThan(0);
  });

  test("aiExplain 带难度档位", async () => {
    const frames: SseFrame[] = [];
    await aiExplain({ text: "t", level: "eli5", itemId: "attn0001", page: 1 }, (f) => frames.push(f));
    expect(frames[frames.length - 1].done).toBe(true);
  });

  test("aiTranslate 默认中文", async () => {
    const frames: SseFrame[] = [];
    await aiTranslate({ text: "hello", itemId: "attn0001" }, (f) => frames.push(f));
    expect(frames[frames.length - 1].done).toBe(true);
  });

  test("sendAnnotationMessage：done 帧带 message_id", async () => {
    const frames: SseFrame[] = [];
    await sendAnnotationMessage("ann-mock-1", "这句什么意思？", (f) => frames.push(f));
    const done = frames[frames.length - 1];
    expect(done.done).toBe(true);
    expect(typeof done.message_id).toBe("string");
  });

  test("askItem：done 帧带 citations", async () => {
    const frames: SseFrame[] = [];
    await askItem("attn0001", "Transformer 的核心是什么？", (f) => frames.push(f));
    const done = frames[frames.length - 1];
    expect(done.done).toBe(true);
    expect(Array.isArray(done.citations)).toBe(true);
    const c = (done.citations as { page: number; quote: string }[])[0];
    expect(typeof c.page).toBe("number");
    expect(typeof c.quote).toBe("string");
  });
});
