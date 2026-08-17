import { useState } from "react";
import { refetchMetadata } from "../api/endpoints";
import { ApiError } from "../api/client";
import { parseCreators } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";

export default function PreviewPanel() {
  const item = useLibraryStore((s) => s.items.find((i) => i.id === s.selectedId));
  const upsertItem = useLibraryStore((s) => s.upsertItem);
  const pushToast = useToastStore((s) => s.push);
  const [retrying, setRetrying] = useState(false);

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
                <dd className="inline break-all">{item.doi}</dd>
              </div>
            )}
            {item.arxiv_id && (
              <div>
                <dt className="inline text-muted dark:text-dmuted">arXiv：</dt>
                <dd className="inline">{item.arxiv_id}</dd>
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
            <p className="text-xs text-muted dark:text-dmuted">AI 摘要将在阶段 4 上线，届时可在此一键生成。</p>
          </section>
        </div>
      )}
    </aside>
  );
}
