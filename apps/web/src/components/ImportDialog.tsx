import { useEffect, useRef, useState } from "react";
import { importFile, importIdentifier, importRis } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { IdentifierImportResult } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";
import { useUiStore } from "../stores/uiStore";

type Mode = "identifier" | "file";

interface FileEntry {
  key: string;
  name: string;
  status: "uploading" | "success" | "duplicate" | "error";
  detail?: string;
}

const RIS_EXT = /\.(ris|bib|bibtex|txt)$/i;
const PDF_EXT = /\.pdf$/i;

let entrySeq = 0;

/** 读取文本文件内容（jsdom 的 File 无 .text()，统一走 FileReader） */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

/** 全能导入框：粘贴 DOI / arXiv / URL，或上传 PDF / RIS / BibTeX 文件 */
export default function ImportDialog() {
  const open = useUiStore((s) => s.importOpen);
  const setOpen = useUiStore((s) => s.setImportOpen);
  const push = useToastStore((s) => s.push);
  const [mode, setMode] = useState<Mode>("identifier");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifierImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode("identifier");
      setResult(null);
      setError(null);
      setInput("");
      setEntries([]);
      setDragOver(false);
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

  const patchEntry = (key: string, patch: Partial<FileEntry>) => {
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };

  const uploadFiles = async (files: File[]) => {
    const accepted = files.filter((f) => PDF_EXT.test(f.name) || RIS_EXT.test(f.name));
    const rejected = files.filter((f) => !accepted.includes(f));
    const pending = accepted.map((f): FileEntry => ({ key: `f${++entrySeq}`, name: f.name, status: "uploading" }));
    const keyOf = new Map<File, string>(accepted.map((f, i) => [f, pending[i].key]));
    setEntries((es) => [
      ...es,
      ...rejected.map((f): FileEntry => ({ key: `f${++entrySeq}`, name: f.name, status: "error", detail: "不支持的文件类型" })),
      ...pending,
    ]);
    if (accepted.length === 0) return;
    let ok = 0;
    let dup = 0;
    let failed = 0;
    // 逐个上传，保证结果顺序与选择顺序一致
    for (const file of accepted) {
      const key = keyOf.get(file)!;
      try {
        if (PDF_EXT.test(file.name)) {
          const res = await importFile(file);
          if (res.duplicate) {
            dup += 1;
            patchEntry(key, { status: "duplicate", detail: res.item.title });
          } else {
            ok += 1;
            patchEntry(key, { status: "success", detail: res.item.title });
          }
        } else {
          const content = await readFileText(file);
          const res = await importRis(content);
          if (res.imported > 0) ok += 1;
          else failed += 1;
          patchEntry(key, {
            status: res.imported > 0 ? "success" : "error",
            detail:
              res.failed > 0
                ? `成功导入 ${res.imported} 条，${res.failed} 条失败`
                : res.imported > 0
                  ? `成功导入 ${res.imported} 条`
                  : "未解析出任何条目",
          });
        }
      } catch (e) {
        failed += 1;
        patchEntry(key, { status: "error", detail: e instanceof ApiError ? e.message : "上传失败" });
      }
    }
    if (ok > 0) push(`文件导入完成：成功 ${ok} 个${dup ? `，重复 ${dup} 个` : ""}${failed ? `，失败 ${failed} 个` : ""}`, failed > 0 ? "info" : "success");
    else if (failed > 0) push("文件导入失败", "error");
    if (ok > 0 || dup > 0) void useLibraryStore.getState().refresh();
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

        <div role="tablist" aria-label="导入方式" className="mb-3 flex rounded border border-line dark:border-dline overflow-hidden text-sm">
          {(
            [
              ["identifier", "粘贴标识符"],
              ["file", "上传文件"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 px-3 py-1.5 ${
                mode === m
                  ? "bg-navy text-paper dark:bg-dnavy dark:text-dpaper"
                  : "bg-paper dark:bg-dpaper text-muted dark:text-dmuted hover:bg-hoverbg dark:hover:bg-dhover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "identifier" && (
          <>
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
          </>
        )}

        {mode === "file" && (
          <>
            <p className="text-xs text-muted dark:text-dmuted mb-2">支持 PDF（可多选）与 RIS / BibTeX 文献列表文件</p>
            <div
              aria-label="文件放置区"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void uploadFiles(Array.from(e.dataTransfer.files));
              }}
              className={`rounded border-2 border-dashed p-6 text-center text-sm ${
                dragOver
                  ? "border-navy dark:border-dnavy bg-hoverbg dark:bg-dhover"
                  : "border-line dark:border-dline"
              }`}
            >
              <p className="text-muted dark:text-dmuted mb-2">拖拽文件到此处，或</p>
              <label className="inline-block px-3 py-1.5 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper text-sm cursor-pointer">
                选择文件
                <input
                  type="file"
                  aria-label="选择文件"
                  accept=".pdf,.ris,.bib,.bibtex,.txt"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length > 0) void uploadFiles(files);
                  }}
                />
              </label>
            </div>

            {entries.length > 0 && (
              <ul aria-label="文件导入结果" className="mt-3 flex flex-col gap-1.5 text-sm max-h-56 overflow-y-auto">
                {entries.map((e) => (
                  <li key={e.key} className="rounded border border-line dark:border-dline px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate">{e.name}</span>
                      {e.status === "uploading" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-hoverbg dark:bg-dhover text-muted dark:text-dmuted">
                          上传中…
                        </span>
                      )}
                      {e.status === "success" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-700/10 text-green-800 dark:text-green-300">
                          成功
                        </span>
                      )}
                      {e.status === "duplicate" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gold/15 text-gold dark:text-dgold">重复</span>
                      )}
                      {e.status === "error" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-700/10 text-red-700 dark:text-red-400">
                          失败
                        </span>
                      )}
                    </div>
                    {e.detail && (
                      <p className={`mt-0.5 text-xs truncate ${e.status === "error" ? "text-red-700 dark:text-red-400" : "text-muted dark:text-dmuted"}`}>
                        {e.detail}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
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
