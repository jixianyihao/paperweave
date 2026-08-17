import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Thread from "./Thread";
import { ReaderBridgeContext } from "../../reader/bridgeContext";

function sseResponse(frames: Record<string, unknown>[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function renderThread(jumpTo = vi.fn()) {
  return {
    jumpTo,
    ...render(
      <ReaderBridgeContext.Provider value={{ jumpTo }}>
        <Thread annotationId="ann-1" />
      </ReaderBridgeContext.Provider>,
    ),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  return () => vi.unstubAllGlobals();
});

describe("Thread 追问线程", () => {
  test("初始折叠；点击展开显示输入框", () => {
    renderThread();
    expect(screen.queryByLabelText("追问输入")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    expect(screen.getByLabelText("追问输入")).toBeInTheDocument();
  });

  test("发送后 user 消息立即上屏，assistant 回复 SSE 流式追加", async () => {
    const fetchSpy = vi.fn(async () =>
      sseResponse([{ delta: "这是" }, { delta: "回答" }, { done: true, message_id: "m1" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    fireEvent.change(screen.getByLabelText("追问输入"), { target: { value: "这句怎么理解？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    // user 消息立即可见
    expect(screen.getByText("这句怎么理解？")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/这是回答/)).toBeInTheDocument());
    // 请求打向 messages 端点
    expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/annotations/ann-1/messages");
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toEqual({
      content: "这句怎么理解？",
    });
  });

  test("assistant 回复里的 [P2] 渲染为锚点，点击调桥 jumpTo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([{ delta: "见 [P2]。" }, { done: true }])));
    const { jumpTo } = renderThread();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    fireEvent.change(screen.getByLabelText("追问输入"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const cite = await screen.findByRole("button", { name: "P2" });
    fireEvent.click(cite);
    expect(jumpTo).toHaveBeenCalledWith({ page: 2 });
  });

  test("error 帧：显示错误文本，不伪造回答", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([{ error: "未配置模型，请在设置中添加服务商" }])),
    );
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    fireEvent.change(screen.getByLabelText("追问输入"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByText(/未配置模型/)).toBeInTheDocument(),
    );
  });

  test("流式进行中禁止重复发送", async () => {
    let resolveStream: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"delta":"…"}\n\n'));
            resolveStream = () => controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    fireEvent.change(screen.getByLabelText("追问输入"), { target: { value: "q1" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeDisabled());
    resolveStream?.();
    fireEvent.change(screen.getByLabelText("追问输入"), { target: { value: "q2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
  });
});
