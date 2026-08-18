import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { disableMockMode, enableMockMode } from "../../api/client";
import { resetMockData } from "../../api/mock";
import { listAnnotations } from "../../api/endpoints";
import { useToastStore } from "../../stores/toastStore";
import { useVoicePrefs } from "./prefs";
import VoiceOrb, { formatDuration } from "./VoiceOrb";
import {
  VoiceSession,
  type MediaStreamLike,
  type RtcDataChannelLike,
  type RtcPeerConnectionLike,
  type VoiceSessionDeps,
} from "../../lib/voiceSession";

// ---- 完全 mock 的 WebRTC 环境（与 lib 测试同一套伪造）----

class FakeDataChannel implements RtcDataChannelLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  send(): void { /* noop */ }
  close(): void { this.closed = true; }
  emit(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

class FakePeerConnection implements RtcPeerConnectionLike {
  dc = new FakeDataChannel();
  closed = false;
  ontrack: ((ev: { streams: unknown[] }) => void) | null = null;
  createDataChannel(): RtcDataChannelLike { return this.dc; }
  addTrack(): void { /* noop */ }
  async createOffer(): Promise<{ sdp?: string }> { return { sdp: "offer" }; }
  async setLocalDescription(): Promise<void> { /* noop */ }
  async setRemoteDescription(): Promise<void> { /* noop */ }
  close(): void { this.closed = true; }
}

interface OrbWorld {
  factory: () => VoiceSession;
  pc: FakePeerConnection;
  session: () => VoiceSession | null;
  sessionCalls: unknown[];
}

function makeWorld(depOverrides: Partial<VoiceSessionDeps> = {}): OrbWorld {
  const pc = new FakePeerConnection();
  const sessionCalls: unknown[] = [];
  let session: VoiceSession | null = null;
  const stream: MediaStreamLike = { getTracks: () => [{ stop: () => undefined }] };
  const deps: VoiceSessionDeps = {
    fetchSession: async (ctx) => {
      sessionCalls.push(ctx);
      return { client_secret: "ek", url: "https://rtc.example/realtime", model: "rt-model" };
    },
    getUserMedia: async () => stream,
    createPeerConnection: () => pc,
    postSdp: async () => "answer",
    ...depOverrides,
  };
  return {
    pc,
    sessionCalls,
    session: () => session,
    factory: () => {
      session = new VoiceSession(deps);
      return session;
    },
  };
}

function renderOrb(world: OrbWorld, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VoiceOrb sessionFactory={world.factory} />
    </MemoryRouter>,
  );
}

function pressShortcut() {
  fireEvent.keyDown(window, { key: "V", code: "KeyV", metaKey: true, shiftKey: true });
}

beforeEach(() => {
  resetMockData();
  enableMockMode();
  useToastStore.getState().clear();
  localStorage.clear();
  useVoicePrefs.setState({ enabled: true, showUsage: true });
  return () => disableMockMode();
});

describe("formatDuration", () => {
  test("formats seconds and minutes", () => {
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(95)).toBe("1 分 35 秒");
    expect(formatDuration(120)).toBe("2 分钟");
  });
});

describe("VoiceOrb", () => {
  test("点击悬浮球开始会话：走状态机到 listening 并显示计时", async () => {
    const w = makeWorld();
    renderOrb(w);
    const orb = screen.getByRole("button", { name: "开始语音会话" });
    fireEvent.click(orb);
    await screen.findByRole("button", { name: "结束语音会话" });
    expect(w.session()?.state).toBe("listening");
    expect(screen.getByLabelText("会话计时")).toBeInTheDocument();
  });

  test("⌘⇧V 唤起/挂断：结束 toast 显示时长，时长上报 usage", async () => {
    const w = makeWorld();
    renderOrb(w);
    pressShortcut();
    await screen.findByRole("button", { name: "结束语音会话" });
    pressShortcut();
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.message.includes("语音会话结束，时长"))).toBe(true),
    );
    expect(w.session()?.state).toBe("idle");
    expect(screen.queryByLabelText("会话计时")).not.toBeInTheDocument();
  });

  test("会话结束生成 voice_digest 摘要（transcript → /api/ai/summarize → 标注）", async () => {
    const w = makeWorld();
    renderOrb(w, "/read/attn0001");
    expect(w.sessionCalls).toHaveLength(0);
    pressShortcut();
    await screen.findByRole("button", { name: "结束语音会话" });
    // 阅读页上下文带 itemId 协商会话
    expect(w.sessionCalls).toEqual([{ itemId: "attn0001" }]);
    w.pc.dc.emit({ type: "response.audio_transcript.delta", delta: "The Transformer uses attention." });
    w.pc.dc.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "讲讲注意力机制" });
    pressShortcut();
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "success" && t.message.includes("语音速览"))).toBe(true),
    );
    const anns = await listAnnotations("attn0001");
    const digest = anns.find((a) => a.type === "voice_digest" && a.content.includes("mock 摘要"));
    expect(digest).toBeDefined();
  });

  test("无麦克风权限 → error toast 与错误态；点击复位", async () => {
    const w = makeWorld({ getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); } });
    renderOrb(w);
    fireEvent.click(screen.getByRole("button", { name: "开始语音会话" }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error")).toBe(true),
    );
    const errOrb = await screen.findByRole("button", { name: "语音会话错误，点击复位" });
    fireEvent.click(errOrb);
    await screen.findByRole("button", { name: "开始语音会话" });
  });

  test("未配置语音服务商 → error toast 显示后端错误信息", async () => {
    const w = makeWorld({ fetchSession: async () => { throw new Error("未配置语音服务商"); } });
    renderOrb(w);
    pressShortcut();
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error" && t.message.includes("未配置语音服务商"))).toBe(true),
    );
  });

  test("卸载后快捷键注销，不再触发会话", async () => {
    const w = makeWorld();
    const { unmount } = renderOrb(w);
    pressShortcut();
    await screen.findByRole("button", { name: "结束语音会话" });
    unmount();
    pressShortcut();
    // 卸载后不再挂断/启动：factory 只被调用过一次，无新会话
    expect(w.sessionCalls).toHaveLength(1);
  });

  test("设置关闭语音模式后不渲染、快捷键无效", () => {
    useVoicePrefs.setState({ enabled: false });
    const w = makeWorld();
    renderOrb(w);
    expect(screen.queryByRole("button", { name: /语音会话/ })).not.toBeInTheDocument();
    pressShortcut();
    expect(w.sessionCalls).toHaveLength(0);
  });

  test("消耗指示关闭后不显示计时（会话本身不受影响）", async () => {
    useVoicePrefs.setState({ showUsage: false });
    const w = makeWorld();
    renderOrb(w);
    pressShortcut();
    await screen.findByRole("button", { name: "结束语音会话" });
    expect(screen.queryByLabelText("会话计时")).not.toBeInTheDocument();
    pressShortcut();
    await waitFor(() => expect(w.session()?.state).toBe("idle"));
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("时长"))).toBe(false);
  });
});
