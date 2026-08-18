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
  /** 远端媒体轨回调（realtime 模型的语音输出经此到达） */
  ontrack: ((ev: { streams: unknown[] }) => void) | null;
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

/** 远端音频播放句柄：stop() 停止播放并释放元素 */
export interface RemoteAudioHandle {
  stop(): void;
}

export interface VoiceSessionDeps {
  /** 后端代理协商 ephemeral token（apiFetch 入口） */
  fetchSession: (ctx: VoiceContext) => Promise<VoiceSessionInfo>;
  getUserMedia: () => Promise<MediaStreamLike>;
  createPeerConnection: () => RtcPeerConnectionLike;
  /** 把 local offer SDP POST 给 realtime 端点，返回 answer SDP */
  postSdp: (url: string, sdp: string, clientSecret: string) => Promise<string>;
  /** 播放远端音频流（ontrack 触发时调用）；缺省则不播放 */
  playRemoteStream?: (stream: unknown) => RemoteAudioHandle;
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
    playRemoteStream: (stream) => {
      // 隐藏 <audio> 播放模型语音输出；autoplay 策略失败时静默（下次用户交互后由浏览器恢复）
      const el = document.createElement("audio");
      el.autoplay = true;
      el.srcObject = stream as MediaStream;
      const playResult = el.play?.();
      playResult?.catch?.(() => undefined);
      return {
        stop: () => {
          el.pause();
          el.srcObject = null;
          el.remove();
        },
      };
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
  private remoteAudio: RemoteAudioHandle | null = null;
  private startedAt: number | null = null;
  /** start 代际：stop() 递增，挂起的 start 在每个 await 后检查并中止（防 connecting 中挂断竞态） */
  private generation = 0;

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
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    this.error = null;
    this.transcript = "";
    this.setState("connecting");
    try {
      const info = await this.deps.fetchSession(ctx);
      if (stale()) return;
      this.stream = await this.deps.getUserMedia();
      if (stale()) return this.cleanup();
      const pc = this.deps.createPeerConnection();
      this.pc = pc;
      // 远端音频：模型的语音输出经 ontrack 到达，交给播放句柄
      pc.ontrack = (ev) => {
        const stream = ev.streams?.[0];
        if (stream && this.deps.playRemoteStream && !stale()) {
          this.remoteAudio?.stop();
          this.remoteAudio = this.deps.playRemoteStream(stream);
        }
      };
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onmessage = (ev) => this.onEvent(ev.data);
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (stale()) return this.cleanup();
      const answer = await this.deps.postSdp(
        `${info.url}?model=${encodeURIComponent(info.model)}`,
        offer.sdp ?? "",
        info.client_secret,
      );
      if (stale()) return this.cleanup();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      if (stale()) return this.cleanup();
      this.startedAt = this.now();
      this.setState("listening");
    } catch (err) {
      this.cleanup();
      if (stale()) return; // stop() 已把状态置回 idle，不再覆盖
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
    try { this.remoteAudio?.stop(); } catch { /* ignore */ }
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    for (const track of this.stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    this.remoteAudio = null;
    this.dc = null;
    this.pc = null;
    this.stream = null;
  }

  /** 挂断：返回时长（秒）与 transcript；idle 状态下为安全 no-op */
  async stop(): Promise<VoiceSessionEnd> {
    this.generation += 1; // 使任何挂起的 start 在下个 await 检查点中止
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
