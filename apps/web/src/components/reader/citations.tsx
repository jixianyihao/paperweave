// 引用锚点渲染：assistant 文本里的 `[P{page}]` 标记与结构化 citations 统一渲染为可点击按钮 → 桥 jumpTo。
import type { ReactNode } from "react";
import type { Citation } from "../../api/types";

const CITE_RE = /\[P(\d+)\]/g;

type Segment = { kind: "text"; value: string } | { kind: "cite"; page: number };

export function splitCitationSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    out.push({ kind: "cite", page: Number(m[1]) });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

export function CitedText({ text, onCite }: { text: string; onCite?: (page: number) => void }) {
  const nodes: ReactNode[] = splitCitationSegments(text).map((seg, i) =>
    seg.kind === "text" ? (
      <span key={i}>{seg.value}</span>
    ) : (
      <button
        key={i}
        type="button"
        disabled={!onCite}
        onClick={() => onCite?.(seg.page)}
        title={`跳到第 ${seg.page} 页`}
        className="mx-0.5 rounded px-1 text-xs font-sans text-navy dark:text-dnavy bg-cream dark:bg-dcream border border-line dark:border-dline hover:bg-hoverbg dark:hover:bg-dhover disabled:opacity-60"
      >
        P{seg.page}
      </button>
    ),
  );
  return <>{nodes}</>;
}

/** 结构化引用列表（ask done 帧 / messages.citations），chip 悬浮显示原文片段 */
export function CitationChips({ citations, onCite }: { citations: Citation[]; onCite?: (page: number) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="citation-chips">
      {citations.map((c, i) => (
        <button
          key={i}
          type="button"
          disabled={!onCite}
          onClick={() => onCite?.(c.page)}
          title={c.quote}
          className="rounded px-1.5 py-0.5 text-xs font-sans text-navy dark:text-dnavy bg-cream dark:bg-dcream border border-line dark:border-dline hover:bg-hoverbg dark:hover:bg-dhover disabled:opacity-60"
        >
          P{c.page}
        </button>
      ))}
    </div>
  );
}
