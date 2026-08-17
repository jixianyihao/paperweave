// 全文问答输入框（契约 流B-5）：固定在时间流底部，提交由 ReaderPage 走 POST /api/items/:id/ask（SSE）。
import { useState, type FormEvent } from "react";

export default function AskBox({ disabled = false, onAsk }: { disabled?: boolean; onAsk(question: string): void }) {
  const [value, setValue] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q || disabled) return;
    setValue("");
    onAsk(q);
  }

  return (
    <form onSubmit={submit} className="flex gap-1 border-t border-line dark:border-dline p-2">
      <input
        aria-label="全文问答输入"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        placeholder="就全文提问…"
        className="flex-1 rounded border border-line dark:border-dline bg-paper dark:bg-dpaper px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="rounded bg-navy dark:bg-dnavy px-3 py-1.5 text-sm text-paper dark:text-dpaper disabled:opacity-50"
      >
        提问
      </button>
    </form>
  );
}
