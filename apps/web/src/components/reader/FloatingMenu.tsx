// 选中浮动菜单（契约 流B-3/6）：选区上方定位（位置由 ReaderPage 用 menuPosition 计算），
// 摘要/翻译/追问直接触发；解释展开四档难度（默认研究生 grad）；笔记展开内联输入。
import { useState } from "react";
import type { ExplainLevel } from "../../api/types";

const LEVELS: { level: ExplainLevel; label: string }[] = [
  { level: "eli5", label: "小白" },
  { level: "undergrad", label: "本科" },
  { level: "grad", label: "研究生" },
  { level: "expert", label: "专家" },
];

export const DEFAULT_EXPLAIN_LEVEL: ExplainLevel = "grad";

export interface FloatingMenuProps {
  position: { left: number; top: number };
  selectedText: string;
  onSummarize(): void;
  onExplain(level: ExplainLevel): void;
  onTranslate(): void;
  onFollowUp(): void;
  onNote(text: string): void;
}

const itemClass =
  "rounded px-2 py-1 text-sm text-ink dark:text-dink hover:bg-hoverbg dark:hover:bg-dhover";

export default function FloatingMenu(props: FloatingMenuProps) {
  const [mode, setMode] = useState<"actions" | "explain" | "note">("actions");
  const [noteText, setNoteText] = useState("");

  return (
    <div
      role="menu"
      aria-label="选中操作"
      style={{ left: props.position.left, top: props.position.top }}
      className="absolute z-20 rounded-lg border border-line dark:border-dline bg-paper dark:bg-dcream shadow-lg"
    >
      {mode === "actions" && (
        <div className="flex items-center gap-0.5 p-1">
          <button role="menuitem" type="button" className={itemClass} onClick={props.onSummarize}>
            摘要
          </button>
          <button role="menuitem" type="button" className={itemClass} onClick={() => setMode("explain")}>
            解释
          </button>
          <button role="menuitem" type="button" className={itemClass} onClick={props.onTranslate}>
            翻译
          </button>
          <button role="menuitem" type="button" className={itemClass} onClick={props.onFollowUp}>
            追问
          </button>
          <button role="menuitem" type="button" className={itemClass} onClick={() => setMode("note")}>
            笔记
          </button>
        </div>
      )}

      {mode === "explain" && (
        <div className="flex items-center gap-0.5 p-1" aria-label="解释难度">
          {LEVELS.map(({ level, label }) => (
            <button
              key={level}
              role="menuitem"
              type="button"
              aria-current={level === DEFAULT_EXPLAIN_LEVEL}
              className={`${itemClass} ${
                level === DEFAULT_EXPLAIN_LEVEL ? "bg-cream dark:bg-dpaper font-bold" : ""
              }`}
              onClick={() => props.onExplain(level)}
            >
              {label}
              {level === DEFAULT_EXPLAIN_LEVEL ? "（默认）" : ""}
            </button>
          ))}
        </div>
      )}

      {mode === "note" && (
        <form
          className="flex items-start gap-1 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = noteText.trim();
            if (text) props.onNote(text);
          }}
        >
          <textarea
            aria-label="笔记内容"
            rows={2}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            className="w-56 rounded border border-line dark:border-dline bg-paper dark:bg-dpaper px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={!noteText.trim()}
            className="rounded bg-navy dark:bg-dnavy px-2 py-1 text-sm text-paper dark:text-dpaper disabled:opacity-50"
          >
            保存笔记
          </button>
        </form>
      )}
    </div>
  );
}
