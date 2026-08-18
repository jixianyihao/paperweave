import { describe, expect, test, vi } from "vitest";
import {
  VoiceSession,
  type MediaStreamLike,
  type RtcDataChannelLike,
  type RtcPeerConnectionLike,
  type VoiceSessionDeps,
} from "./voiceSession";

// ---- 完全 mock 的 WebRTC 环境：不打真实连接、不用真实 getUserMedia ----

class FakeDataChannel implements RtcDataChannelLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  emit(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

class FakePeerConnection implements RtcPeerConnectionLike {
  dc = new FakeDataChannel();
  tracks: unknown[] = [];
  closed = false;
  local: unknown = null;
  remote: unknown = null;
  ontrack: ((ev: { streams: unknown[] }) => void) | null = null;
  createDataChannel(): RtcDataChannelLike { return this.dc; }
  addTrack(track: unknown): void { this.tracks.push(track); }
  async createOffer(): Promise<{ sdp?: string }> { return { sdp: "fake-offer-sdp" }; }
  async setLocalDescription(desc: unknown): Promise<void> { this.local = desc; }
  async setRemoteDescription(desc: unknown): Promise<void> { this.remote = desc; }
  close(): void { this.closed = true; }
}

function fakeStream(): MediaStreamLike & { tracks: { stop: () => void; stopped: boolean }[] } {
  const tracks = [{ stop() { this.stopped = true; }, stopped: false }];
  return { getTracks: () => tracks, tracks };
}

interface FakeWorld {
  deps: VoiceSessionDeps;
  pc: FakePeerConnection;
  stream: ReturnType<typeof fakeStream>;
  sessionCalls: unknown[];
  sdpCalls: { url: string; sdp: string; secret: string }[];
  now: () => number;
  advance: (ms: number) => void;
}

function makeWorld(overrides: Partial<VoiceSessionDeps> = {}): FakeWorld {
  const pc = new FakePeerConnection();
  const stream = fakeStream();
  const sessionCalls: unknown[] = [];
  const sdpCalls: { url: string; sdp: string; secret: string }[] = [];
  let t = 1_000_000;
  const world: FakeWorld = {
    pc,
    stream,
    sessionCalls,
    sdpCalls,
    now: () => t,
    advance: (ms: number) => { t += ms; },
    deps: {
      fetchSession: async (ctx) => {
        sessionCalls.push(ctx);
        return { client_secret: "ek_test", url: "https://rtc.example/v1/realtime", model: "gpt-4o-realtime-preview" };
      },
      getUserMedia: async () => stream,
      createPeerConnection: () => pc,
      postSdp: async (url, sdp, secret) => {
        sdpCalls.push({ url, sdp, secret });
        return "fake-answer-sdp";
      },
      now: () => t,
      ...overrides,
    },
  };
  return world;
}

describe("VoiceSession 状态机", () => {
  test("start: idle→connecting→listening，走 getUserMedia→RTCPeerConnection→SDP 协商", async () => {
    const w = makeWorld();
    const s = new VoiceSession(w.deps);
    const states: string[] = [];
    s.subscribe((st) => states.push(st));

    expect(s.state).toBe("idle");
    await s.start({ itemId: "itm00001" });
    expect(s.state).toBe("listening");
    expect(states).toEqual(["connecting", "listening"]);
    expect(w.sessionCalls).toEqual([{ itemId: "itm00001" }]);
    expect(w.sdpCalls).toEqual([
      {
        url: "https://rtc.example/v1/realtime?model=gpt-4o-realtime-preview",
        sdp: "fake-offer-sdp",
        secret: "ek_test",
      },
    ]);
    expect(w.pc.remote).toEqual({ type: "answer", sdp: "fake-answer-sdp" });
    expect(w.pc.tracks).toHaveLength(1);
  });

  test("start 进行中重复调用是 no-op", async () => {
    const w = makeWorld();
    const s = new VoiceSession(w.deps);
    await s.start({});
    await s.start({});
    expect(w.sessionCalls).toHaveLength(1);
    expect(s.state).toBe("listening");
  });

  test("data channel 事件驱动 listening/speaking 与 transcript 累积", async () => {
    const w = makeWorld();
    const s = new VoiceSession(w.deps);
    await s.start({});
    w.pc.dc.emit({ type: "response.created" });
    expect(s.state).toBe("speaking");
    w.pc.dc.emit({ type: "response.audio_transcript.delta", delta: "Transformer " });
    w.pc.dc.emit({ type: "response.audio_transcript.delta", delta: "uses attention." });
    w.pc.dc.emit({ type: "response.done" });
    expect(s.state).toBe("listening");
    // barge-in：用户开口打断 → 回到 listening
    w.pc.dc.emit({ type: "response.created" });
    w.pc.dc.emit({ type: "input_audio_buffer.speech_started" });
    expect(s.state).toBe("listening");
    w.pc.dc.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "What is attention?" });
    expect(s.transcript).toContain("Transformer uses attention.");
    expect(s.transcript).toContain("What is attention?");
    // 非 JSON 帧不炸
    w.pc.dc.onmessage?.({ data: "not json" });
    expect(s.state).toBe("listening");
  });

  test("stop 返回时长与 transcript，并关闭全部资源", async () => {
    const w = makeWorld();
    const s = new VoiceSession(w.deps);
    await s.start({});
    w.advance(95_000);
    w.pc.dc.emit({ type: "response.audio_transcript.delta", delta: "digest me" });
    const end = await s.stop();
    expect(end.seconds).toBe(95);
    expect(end.transcript).toContain("digest me");
    expect(w.pc.closed).toBe(true);
    expect(w.pc.dc.closed).toBe(true);
    expect(w.stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(s.state).toBe("idle");
    expect(s.transcript).toBe("");
    // idle 状态下 stop 是安全 no-op
    expect(await s.stop()).toEqual({ seconds: 0, transcript: "" });
  });

  test("无麦克风权限 → error 状态并保留错误信息，可 dismissError 复位", async () => {
    const w = makeWorld({ getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); } });
    const s = new VoiceSession(w.deps);
    await s.start({});
    expect(s.state).toBe("error");
    expect(s.error).toMatch(/麦克风|denied|NotAllowed/);
    // getUserMedia 在创建连接之前失败：不应产生任何悬挂资源，可干净重试
    s.dismissError();
    expect(s.state).toBe("idle");
    expect(s.error).toBeNull();
  });

  test("协商中途失败（postSdp 抛错）→ error 且半成品连接被清理", async () => {
    const w = makeWorld({ postSdp: async () => { throw new Error("rtc down"); } });
    const s = new VoiceSession(w.deps);
    await s.start({});
    expect(s.state).toBe("error");
    expect(w.pc.closed).toBe(true);
    expect(w.stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  test("未配置语音服务商（fetchSession 失败）→ error 状态", async () => {
    const w = makeWorld({ fetchSession: async () => { throw new Error("未配置语音服务商"); } });
    const s = new VoiceSession(w.deps);
    await s.start({});
    expect(s.state).toBe("error");
    expect(s.error).toBe("未配置语音服务商");
  });

  test("error 状态下 stop 也返回已积累的时长与 transcript", async () => {
    const w = makeWorld({ postSdp: async () => { throw new Error("rtc down"); } });
    const s = new VoiceSession(w.deps);
    await s.start({});
    expect(s.state).toBe("error");
    const end = await s.stop();
    expect(end.seconds).toBeGreaterThanOrEqual(0);
    expect(s.state).toBe("idle");
  });

  test("elapsedSeconds 只在活动会话中计时", async () => {
    const w = makeWorld();
    const s = new VoiceSession(w.deps);
    expect(s.elapsedSeconds()).toBe(0);
    await s.start({});
    w.advance(10_000);
    expect(s.elapsedSeconds()).toBe(10);
    await s.stop();
    w.advance(10_000);
    expect(s.elapsedSeconds()).toBe(0);
  });

  test("ontrack：远端音频流交给 playRemoteStream 播放，stop/error 清理时停掉", async () => {
    const played: unknown[] = [];
    let stopped = 0;
    const remoteStream = { kind: "remote-audio" };
    const w = makeWorld({
      playRemoteStream: (stream) => {
        played.push(stream);
        return { stop: () => { stopped += 1; } };
      },
    });
    const s = new VoiceSession(w.deps);
    await s.start({});
    // start 挂好了 track 监听面
    expect(typeof w.pc.ontrack).toBe("function");
    w.pc.ontrack?.({ streams: [remoteStream] });
    expect(played).toEqual([remoteStream]);
    await s.stop();
    expect(stopped).toBe(1);
  });

  test("connecting 中 stop（SDP 协商挂起）：挂起的 start 中止，pc/track 被清理，最终保持 idle", async () => {
    let resolveSdp: ((v: string) => void) | null = null;
    const sdpCalls: string[] = [];
    const w = makeWorld({
      postSdp: (url) => {
        sdpCalls.push(url);
        return new Promise<string>((res) => { resolveSdp = res; });
      },
    });
    const s = new VoiceSession(w.deps);
    const starting = s.start({});
    // 等协商进行到 SDP POST（mic 已开、pc 已建）
    await vi.waitFor(() => expect(sdpCalls).toHaveLength(1));
    expect(s.state).toBe("connecting");
    await s.stop();
    expect(s.state).toBe("idle");
    // SDP 稍后返回：start 不得把状态推进到 listening
    resolveSdp!("late-answer");
    await starting;
    expect(s.state).toBe("idle");
    expect(w.pc.closed).toBe(true);
    expect(w.stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  test("connecting 中 stop（getUserMedia 挂起）：权限稍后授予也不会上线", async () => {
    let resolveMedia: ((s: MediaStreamLike) => void) | null = null;
    const w = makeWorld({ getUserMedia: () => new Promise<MediaStreamLike>((res) => { resolveMedia = res; }) });
    const s = new VoiceSession(w.deps);
    const starting = s.start({});
    await vi.waitFor(() => expect(w.sessionCalls).toHaveLength(1));
    await s.stop();
    expect(s.state).toBe("idle");
    resolveMedia!(w.stream);
    await starting;
    expect(s.state).toBe("idle");
    // 迟到的麦克风流被立即停掉，且从未创建 peer connection
    expect(w.stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(w.pc.closed).toBe(false);
    expect(w.sdpCalls).toHaveLength(0);
  });
});
