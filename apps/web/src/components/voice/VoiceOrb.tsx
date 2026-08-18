// 全局悬浮语音球（右下角）+ ⌘⇧V 快捷键：任何页面可唤起/挂断。
// 会话结束：上报时长（usage_log task=voice）→ toast 显示时长 →
// transcript 非空且有打开论文时，走 /api/ai/summarize 生成 voice_digest 标注。
import { useEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { aiSummarize, createAnnotation, reportVoiceUsage } from "../../api/endpoints";
import { VoiceSession, defaultVoiceDeps, type VoiceState } from "../../lib/voiceSession";
import { useToastStore } from "../../stores/toastStore";
import { useVoicePrefs } from "./prefs";

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

export interface VoiceOrbProps {
  /** 测试注入：伪造 WebRTC 依赖的会话工厂；生产默认 defaultVoiceDeps */
  sessionFactory?: () => VoiceSession;
}

const ORB_BASE =
  "w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors outline-none focus-visible:ring-2";

function orbClass(state: VoiceState): string {
  switch (state) {
    case "listening":
      return `${ORB_BASE} bg-navy text-paper dark:bg-dnavy dark:text-dpaper animate-pulse`;
    case "speaking":
      return `${ORB_BASE} bg-navy text-paper dark:bg-dnavy dark:text-dpaper ring-4 ring-navy/30 dark:ring-dnavy/30`;
    case "connecting":
      return `${ORB_BASE} bg-muted text-paper dark:bg-dmuted dark:text-dpaper animate-pulse`;
    case "error":
      return `${ORB_BASE} bg-red-700 text-paper dark:bg-red-800`;
    default:
      return `${ORB_BASE} bg-navy text-paper dark:bg-dnavy dark:text-dpaper hover:opacity-90`;
  }
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
    </svg>
  );
}

export default function VoiceOrb({ sessionFactory }: VoiceOrbProps) {
  const enabled = useVoicePrefs((s) => s.enabled);
  const showUsage = useVoicePrefs((s) => s.showUsage);
  const push = useToastStore((s) => s.push);
  const match = useMatch("/read/:itemId");
  const itemId = match?.params.itemId;

  const [state, setState] = useState<VoiceState>("idle");
  const [, setTick] = useState(0);

  const sessionRef = useRef<VoiceSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = sessionFactory ? sessionFactory() : new VoiceSession(defaultVoiceDeps());
  }
  const session = sessionRef.current;

  // 最新值经 ref 供事件回调使用，避免闭包过期
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const showUsageRef = useRef(showUsage);
  showUsageRef.current = showUsage;

  useEffect(() => {
    const unsubscribe = session.subscribe((st) => {
      setState(st);
      if (st === "error" && session.error) push(session.error, "error");
    });
    return () => {
      unsubscribe();
      if (session.state !== "idle") void session.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const active = state === "connecting" || state === "listening" || state === "speaking";

  // 会话期间每秒刷新计时显示
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  async function makeDigest(transcript: string): Promise<void> {
    const target = itemIdRef.current;
    if (!transcript.trim() || !target) return;
    let acc = "";
    let failed = false;
    try {
      // 不带 itemId 调 summarize，避免后端落 ai_summary 标注；digest 由前端存为 voice_digest
      await aiSummarize({ text: transcript }, (f) => {
        if (f.error) failed = true;
        if (f.delta) acc += f.delta;
      });
      if (failed || !acc.trim()) {
        push("语音速览生成失败", "error");
        return;
      }
      await createAnnotation(target, { type: "voice_digest", content: acc });
      push("已生成语音速览", "success");
    } catch {
      push("语音速览生成失败", "error");
    }
  }

  async function toggle(): Promise<void> {
    const s = sessionRef.current;
    if (!s) return;
    if (s.state === "idle") {
      const ctx = itemIdRef.current ? { itemId: itemIdRef.current } : {};
      await s.start(ctx);
    } else if (s.state === "error") {
      s.dismissError();
    } else {
      const end = await s.stop();
      if (end.seconds > 0) {
        if (showUsageRef.current) push(`语音会话结束，时长 ${formatDuration(end.seconds)}`, "info");
        void reportVoiceUsage(end.seconds).catch(() => undefined);
        void makeDigest(end.transcript);
      }
    }
  }

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // ⌘⇧V 全局快捷键：唤起/挂断
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  if (!enabled) return null;

  const label =
    state === "idle" ? "开始语音会话" : state === "error" ? "语音会话错误，点击复位" : "结束语音会话";

  return (
    <div aria-label="语音模式" className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {active && showUsage && (
        <div
          aria-label="会话计时"
          className="rounded bg-cream dark:bg-dcream border border-line dark:border-dline px-2 py-1 text-xs text-muted dark:text-dmuted"
        >
          {formatDuration(session.elapsedSeconds())}
        </div>
      )}
      <button type="button" aria-label={label} onClick={() => void toggle()} className={orbClass(state)}>
        <MicIcon />
      </button>
    </div>
  );
}
