// 语音会话状态机（阶段 5.5+6，流 V）：
// idle → connecting → listening ⇄ speaking →（stop）→ idle；任何失败 → error。
// WebRTC 细节全部通过 deps 注入——测试中完全 mock，不打真实连接、不用真实 getUserMedia。
import { createVoiceSession } from "../api/endpoints";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface VoiceContext {
  itemId?: string;
  page?: number | null;
  selectedText?: string;
}

export interface VoiceSessionInfo {
  client_secret: string;
  url: string;
  model: string;
}

// 最小结构接口：与浏览器原生类型结构兼容（structural typing），测试中可整体伪造
export interface RtcDataChannelLike {
  onmessage: ((ev: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RtcPeerConnectionLike {
  createDataChannel(label: string): RtcDataChannelLike;
  addTrack(track: unknown, stream: MediaStreamLike): void;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: unknown): Promise<void>;
  close(): void;
}

export interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}

export interface VoiceSessionDeps {
  /** 后端代理协商 ephemeral token（apiFetch 入口） */
  fetchSession: (ctx: VoiceContext) => Promise<VoiceSessionInfo>;
  getUserMedia: () => Promise<MediaStreamLike>;
  createPeerConnection: () => RtcPeerConnectionLike;
  /** 把 local offer SDP POST 给 realtime 端点，返回 answer SDP */
  postSdp: (url: string, sdp: string, clientSecret: string) => Promise<string>;
  now?: () => number;
}

export interface VoiceSessionEnd {
  seconds: number;
  transcript: string;
}

/** 生产环境依赖：真实 getUserMedia + RTCPeerConnection + 直连 realtime 端点 */
export function defaultVoiceDeps(): VoiceSessionDeps {
  return {
    fetchSession: (ctx) => createVoiceSession(ctx),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }) as unknown as Promise<MediaStreamLike>,
    createPeerConnection: () => new RTCPeerConnection() as unknown as RtcPeerConnectionLike,
    postSdp: async (url, sdp, clientSecret) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${clientSecret}`, "content-type": "application/sdp" },
        body: sdp,
      });
      if (!res.ok) throw new Error(`realtime 端点响应错误（${res.status}）`);
      return res.text();
    },
  };
}

type Listener = (state: VoiceState) => void;

export class VoiceSession {
  state: VoiceState = "idle";
  error: string | null = null;
  transcript = "";

  private readonly deps: VoiceSessionDeps;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private pc: RtcPeerConnectionLike | null = null;
  private dc: RtcDataChannelLike | null = null;
  private stream: MediaStreamLike | null = null;
  private startedAt: number | null = null;

  constructor(deps: VoiceSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const fn of this.listeners) fn(state);
  }

  elapsedSeconds(): number {
    if (this.startedAt === null || this.state === "idle") return 0;
    return Math.max(0, Math.floor((this.now() - this.startedAt) / 1000));
  }

  async start(ctx: VoiceContext = {}): Promise<void> {
    if (this.state !== "idle") return;
    this.error = null;
    this.transcript = "";
    this.setState("connecting");
    try {
      const info = await this.deps.fetchSession(ctx);
      this.stream = await this.deps.getUserMedia();
      const pc = this.deps.createPeerConnection();
      this.pc = pc;
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onmessage = (ev) => this.onEvent(ev.data);
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await this.deps.postSdp(
        `${info.url}?model=${encodeURIComponent(info.model)}`,
        offer.sdp ?? "",
        info.client_secret,
      );
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      this.startedAt = this.now();
      this.setState("listening");
    } catch (err) {
      this.cleanup();
      this.error = err instanceof Error ? err.message : String(err);
      this.setState("error");
    }
  }

  private onEvent(data: string): void {
    let msg: { type?: string; delta?: string; transcript?: string; message?: string };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return; // 非 JSON 帧忽略
    }
    switch (msg.type) {
      case "response.created":
        if (this.state === "listening") this.setState("speaking");
        break;
      case "response.audio_transcript.delta":
        if (msg.delta) this.transcript += msg.delta;
        break;
      case "response.done":
        if (this.state === "speaking") this.setState("listening");
        break;
      case "input_audio_buffer.speech_started":
        // barge-in：用户开口打断模型说话
        if (this.state === "speaking") this.setState("listening");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) this.transcript += `${this.transcript ? "\n" : ""}${msg.transcript}`;
        break;
      case "error":
        this.error = msg.message ?? "realtime 会话错误";
        this.cleanup();
        this.setState("error");
        break;
      default:
        break;
    }
  }

  private cleanup(): void {
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    for (const track of this.stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    this.dc = null;
    this.pc = null;
    this.stream = null;
  }

  /** 挂断：返回时长（秒）与 transcript；idle 状态下为安全 no-op */
  async stop(): Promise<VoiceSessionEnd> {
    if (this.state === "idle") return { seconds: 0, transcript: "" };
    const seconds = this.startedAt !== null ? Math.max(1, Math.round((this.now() - this.startedAt) / 1000)) : 0;
    const transcript = this.transcript;
    this.transcript = "";
    this.startedAt = null;
    this.cleanup();
    this.setState("idle");
    return { seconds, transcript };
  }

  dismissError(): void {
    if (this.state !== "error") return;
    this.error = null;
    this.setState("idle");
  }
}
