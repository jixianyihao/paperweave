import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getItem } from "./api/endpoints";
import { isMockMode } from "./api/client";
import type { Item } from "./api/types";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; item: Item };

/** 阅读器入口：/read/:itemId → zotero/reader iframe，file 指向 /api/items/:id/pdf；无 PDF 显示占位 */
export default function ReaderPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    if (!itemId) {
      setState({ phase: "error", message: "缺少条目 ID" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    getItem(itemId)
      .then((item) => {
        if (!cancelled) setState({ phase: "ready", item });
      })
      .catch((e) => {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "加载失败" });
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (state.phase === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif">
        <p className="text-sm text-muted dark:text-dmuted">正在打开阅读器…</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif">
        <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
        <Link to="/" className="text-sm text-navy dark:text-dnavy underline">
          返回文献库
        </Link>
      </div>
    );
  }

  const { item } = state;
  if (!item.file_path) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif px-8 text-center">
        <h1 className="text-lg font-bold">{item.title}</h1>
        <p role="note" className="text-sm text-muted dark:text-dmuted">
          仅元数据：该条目没有本地 PDF。可在文献库中重新导入或使用 DOI/arXiv 导入以下载全文。
        </p>
        <Link to="/" className="text-sm text-navy dark:text-dnavy underline">
          返回文献库
        </Link>
      </div>
    );
  }

  // mock 模式下后端并不会真的流式返回 PDF，用内置样例代替以便演示
  const file = isMockMode()
    ? "/samples/sample.pdf"
    : `/api/items/${encodeURIComponent(item.id)}/pdf`;

  return (
    <iframe
      title="reader"
      src={`/reader/reader.html?file=${encodeURIComponent(file)}`}
      className="block w-screen h-screen border-0"
    />
  );
}
