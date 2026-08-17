import { useEffect, useRef, useState } from "react";
import { importIdentifier } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { IdentifierImportResult } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";
import { useUiStore } from "../stores/uiStore";

/** 全能导入框：粘贴 DOI / arXiv / URL → POST /api/import/identifier，展示结果 */
export default function ImportDialog() {
  const open = useUiStore((s) => s.importOpen);
  const setOpen = useUiStore((s) => s.setImportOpen);
  const push = useToastStore((s) => s.push);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifierImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setInput("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const value = input.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importIdentifier(value);
      setResult(res);
      push(res.duplicate ? `已存在：${res.item.title}` : `已导入：${res.item.title}`, res.duplicate ? "info" : "success");
      void useLibraryStore.getState().refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="导入文献"
      className="fixed inset-0 z-40 flex items-start justify-center pt-24 bg-black/30"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[32rem] max-w-[90vw] rounded-lg border border-line dark:border-dline bg-paper dark:bg-dpaper shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold mb-2">导入文献</h2>
        <p className="text-xs text-muted dark:text-dmuted mb-2">粘贴 DOI、arXiv 编号或论文 URL，例如 10.1038/nature12373 或 1706.03762</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="DOI / arXiv / URL"
            aria-label="标识符"
            className="flex-1 rounded border border-line dark:border-dline bg-paper dark:bg-dcream px-2 py-1.5 text-sm outline-none focus:border-navy dark:focus:border-dnavy"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-3 py-1.5 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper text-sm disabled:opacity-50"
          >
            {busy ? "导入中…" : "导入"}
          </button>
        </form>

        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}

        {result && (
          <div aria-label="导入结果" className="mt-3 rounded border border-line dark:border-dline p-3 text-sm">
            <p className="font-medium">{result.item.title}</p>
            <div className="mt-1 flex gap-2">
              {result.duplicate && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gold/15 text-gold dark:text-dgold">重复条目</span>
              )}
              {result.pdf_downloaded && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-700/10 text-green-800 dark:text-green-300">
                  已下载 PDF
                </span>
              )}
              {!result.duplicate && !result.pdf_downloaded && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-hoverbg dark:bg-dhover text-muted dark:text-dmuted">
                  仅元数据
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 text-right">
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted dark:text-dmuted hover:underline">
            关闭 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
