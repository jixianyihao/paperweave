import { useState } from "react";
import { Link } from "react-router-dom";
import { refetchMetadata, aiSummarize } from "../api/endpoints";
import { ApiError, type SseFrame } from "../api/client";
import { parseCreators } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";

export default function PreviewPanel() {
  const item = useLibraryStore((s) => s.items.find((i) => i.id === s.selectedId));
  const upsertItem = useLibraryStore((s) => s.upsertItem);
  const pushToast = useToastStore((s) => s.push);
  const [retrying, setRetrying] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  const retry = async () => {
    if (!item) return;
    setRetrying(true);
    try {
      const res = await refetchMetadata(item.id);
      upsertItem(res.item);
      pushToast(res.metadata_status === "complete" ? "元数据已更新" : "元数据抓取仍未成功", res.metadata_status === "complete" ? "success" : "error");
    } catch (e) {
      pushToast(e instanceof ApiError ? `重试失败：${e.message}` : "重试失败：该条目没有 DOI 或 arXiv ID", "error");
    } finally {
      setRetrying(false);
    }
  };

  const genSummary = async () => {
    if (!item) return;
    const text = item.abstract ?? item.title;
    setAiSummary("");
    setSummarizing(true);
    try {
      await aiSummarize(
        { text, itemId: item.id, level: "bullets" },
        (frame: SseFrame) => {
          if (typeof frame.delta === "string") setAiSummary((s) => s + frame.delta);
        },
      );
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : "AI 摘要生成失败（未配置模型？）", "error");
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <aside
      aria-label="AI 预览面板"
      className="w-80 shrink-0 bg-cream dark:bg-dcream border-l border-line dark:border-dline p-4 overflow-y-auto"
    >
      {!item ? (
        <p className="text-sm text-muted dark:text-dmuted">选中左侧条目查看详情</p>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-bold leading-snug">{item.title}</h2>
          <Link
            to={`/read/${item.id}`}
            className="block rounded bg-navy dark:bg-dnavy px-3 py-2 text-center text-sm text-paper dark:text-dpaper hover:opacity-90"
          >
            打开阅读 →
          </Link>
          <dl className="text-sm flex flex-col gap-1">
            <div>
              <dt className="inline text-muted dark:text-dmuted">作者：</dt>
              <dd className="inline">{parseCreators(item).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="inline text-muted dark:text-dmuted">年份：</dt>
              <dd className="inline">{item.year ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-muted dark:text-dmuted">发表：</dt>
              <dd className="inline">{item.venue ?? "—"}</dd>
            </div>
            {item.doi && (
              <div>
                <dt className="inline text-muted dark:text-dmuted">DOI：</dt>
                <dd className="inline break-all">
                  <a className="text-navy dark:text-dnavy hover:underline" target="_blank" rel="noreferrer" href={`https://doi.org/${item.doi}`}>
                    {item.doi}
                  </a>
                </dd>
              </div>
            )}
            {item.arxiv_id && (
              <div>
                <dt className="inline text-muted dark:text-dmuted">arXiv：</dt>
                <dd className="inline">
                  <a className="text-navy dark:text-dnavy hover:underline" target="_blank" rel="noreferrer" href={`https://arxiv.org/abs/${item.arxiv_id}`}>
                    {item.arxiv_id}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="inline text-muted dark:text-dmuted">PDF：</dt>
              <dd className="inline">{item.file_path ? "已下载" : "无"}</dd>
            </div>
          </dl>

          {item.metadata_status === "failed" && (
            <div className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-2">
              <p className="text-xs text-red-700 dark:text-red-300 mb-1">元数据抓取失败</p>
              <button
                type="button"
                disabled={retrying}
                onClick={() => void retry()}
                className="text-xs px-2 py-1 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper disabled:opacity-50"
              >
                {retrying ? "重试中…" : "重试元数据"}
              </button>
            </div>
          )}

          <section>
            <h3 className="text-xs uppercase tracking-wide text-muted dark:text-dmuted mb-1">摘要</h3>
            <p className="text-sm leading-relaxed">{item.abstract ?? "（无摘要）"}</p>
          </section>

          <section aria-label="AI 摘要" className="rounded border border-dashed border-line dark:border-dline p-2">
            <h3 className="text-xs uppercase tracking-wide text-muted dark:text-dmuted mb-1">AI 摘要</h3>
            {aiSummary ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}{summarizing && <span className="animate-pulse">▍</span>}</p>
            ) : (
              <p className="text-xs text-muted dark:text-dmuted mb-1">基于摘要生成要点速览。</p>
            )}
            <button
              type="button"
              disabled={summarizing}
              onClick={() => void genSummary()}
              className="mt-1 text-xs px-2 py-1 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper disabled:opacity-50"
            >
              {summarizing ? "生成中…" : aiSummary ? "重新生成" : "生成 AI 摘要"}
            </button>
          </section>
        </div>
      )}
    </aside>
  );
}
