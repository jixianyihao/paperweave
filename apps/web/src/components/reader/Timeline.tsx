// 统一时间流面板（契约 流B-2）：annotations 按页混排，四种条目类型区分样式，
// 每条显示 P{page} 标签 + 「↩ 跳回原文」（经 onJump 回调，由 ReaderPage 调桥）。
import { useMemo } from "react";
import type { Annotation, Citation } from "../../api/types";
import { useReaderBridge } from "../../reader/bridgeContext";
import { CitedText, CitationChips } from "./citations";
import Thread from "./Thread";

/** 时间流条目视图模型：服务端 annotation 与本地流式条目（pending ai/问答）统一形状 */
export interface TimelineEntry {
  id: string;
  type: Annotation["type"];
  page: number | null;
  content: string;
  created_at: string;
  sort_index: number;
  position?: string | null;
  pending?: boolean;
  error?: string | null;
  question?: string; // ai_qa：用户问题，content 为回答
  citations?: Citation[]; // ask done 帧的结构化引用
  thinking?: string; // 模型思考过程（reasoning_content，仅流式期间展示，不落库）
}

const TYPE_META: Record<Annotation["type"], { label: string; border: string }> = {
  highlight: { label: "高亮", border: "border-gold dark:border-dgold" },
  note: { label: "笔记", border: "border-muted dark:border-dmuted" },
  ai_summary: { label: "摘要", border: "border-navy dark:border-dnavy" },
  ai_explain: { label: "解释", border: "border-navy dark:border-dnavy" },
  ai_translate: { label: "翻译", border: "border-navy dark:border-dnavy" },
  ai_qa: { label: "问答", border: "border-navy dark:border-dnavy" },
  voice_digest: { label: "语音速览", border: "border-ink dark:border-dink" },
};

/** 确定性排序：page（null 排最后）→ sort_index → created_at → id */
export function sortEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort(
    (a, b) =>
      (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) ||
      a.sort_index - b.sort_index ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

export default function Timeline({
  entries,
  onJump,
  openThreadId = null,
}: {
  entries: TimelineEntry[];
  onJump: (entry: TimelineEntry) => void;
  /** 新建的追问条目 id：其 Thread 挂载时默认展开 */
  openThreadId?: string | null;
}) {
  const bridge = useReaderBridge();
  const sorted = useMemo(() => sortEntries(entries), [entries]);
  const onCite = bridge ? (page: number) => bridge.jumpTo({ page }) : undefined;

  if (sorted.length === 0) {
    return <p className="p-4 text-sm text-muted dark:text-dmuted">还没有标注。选中正文开始摘要、解释、翻译或记笔记。</p>;
  }

  return (
    <ol className="flex flex-col gap-3 p-3">
      {sorted.map((e) => {
        const meta = TYPE_META[e.type];
        const isAi = e.type.startsWith("ai_");
        return (
          <li
            key={e.id}
            data-testid="timeline-entry"
            data-entry-id={e.id}
            className={`rounded border border-l-4 border-line dark:border-dline ${meta.border} bg-paper dark:bg-dcream p-3`}
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-sans">
              <span className="rounded bg-cream dark:bg-dpaper px-1.5 py-0.5 text-ink dark:text-dink">{meta.label}</span>
              {e.page != null && <span className="text-muted dark:text-dmuted">P{e.page}</span>}
              <span className="flex-1" />
              {e.page != null && (
                <button
                  type="button"
                  onClick={() => onJump(e)}
                  className="text-navy dark:text-dnavy hover:underline"
                >
                  ↩ 跳回原文
                </button>
              )}
            </div>
            {e.question && (
              <p className="mb-1 text-sm font-sans font-bold text-ink dark:text-dink">Q：{e.question}</p>
            )}
            {e.thinking && (
              <details className="mb-1 rounded bg-cream dark:bg-dpaper px-2 py-1 text-xs text-muted dark:text-dmuted" open={e.pending}>
                <summary className="cursor-pointer select-none font-sans">
                  {e.pending ? "思考中…" : "思考过程"}
                </summary>
                <div className="mt-1 whitespace-pre-wrap leading-relaxed">{e.thinking}</div>
              </details>
            )}
            {e.error ? (
              <p className="text-sm text-red-700 dark:text-red-400">{e.error}</p>
            ) : (
              <div className="text-sm leading-relaxed text-ink dark:text-dink">
                <CitedText text={e.content} onCite={onCite} markdown={isAi || e.type === "voice_digest"} />
                {e.pending && (
                  <span data-streaming className="ml-1 animate-pulse text-muted dark:text-dmuted">
                    ▍
                  </span>
                )}
              </div>
            )}
            {e.citations && <CitationChips citations={e.citations} onCite={onCite} />}
            {/* 只有已落库的 ai_* 标注（非 local-* 临时条目）才能挂追问线程 */}
            {isAi && !e.pending && !e.error && !e.id.startsWith("local-") && (
              <Thread annotationId={e.id} defaultOpen={e.id === openThreadId} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
