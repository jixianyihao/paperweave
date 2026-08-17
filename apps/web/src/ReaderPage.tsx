// 阅读器页（契约 流B-1/3/5）：中栏 iframe reader（zotero/reader），右栏统一时间流面板。
// 桥接经 attachReaderBridge（流 A 提供；测试用 __mocks__ 替身）：选区 → 浮动菜单 → AI SSE → 时间流新条目。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isMockMode } from "./api/client";
import type { SseFrame } from "./api/client";
import {
  aiExplain,
  aiSummarize,
  aiTranslate,
  askItem,
  createAnnotation,
  getItem,
  listAnnotations,
} from "./api/endpoints";
import type { Annotation, Citation, ExplainLevel, Item } from "./api/types";
import { attachReaderBridge, type ReaderSelection } from "./reader/bridge";
import { ReaderBridgeContext, type ReaderBridgeApi } from "./reader/bridgeContext";
import { useToastStore } from "./stores/toastStore";
import AskBox from "./components/reader/AskBox";
import FloatingMenu from "./components/reader/FloatingMenu";
import Timeline, { type TimelineEntry } from "./components/reader/Timeline";
import { menuPosition } from "./components/reader/menuPosition";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; item: Item };

interface ActiveSelection {
  sel: ReaderSelection;
  pos: { left: number; top: number };
}

/** 浮动菜单估算尺寸（用于定位钳制；解释/笔记展开后略高，V1 按一行估算） */
const MENU_SIZE = { width: 320, height: 44 };

let localSeq = 0;

function annToEntry(a: Annotation): TimelineEntry {
  return {
    id: a.id,
    type: a.type,
    page: a.page,
    content: a.content,
    created_at: a.created_at,
    sort_index: a.sort_index,
    position: a.position,
  };
}

function nowStamp(): string {
  // 与服务端 "YYYY-MM-DD HH:MM:SS" 同格式（UTC 近似即可，仅用于排序 tiebreak）
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export default function ReaderPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const pushToast = useToastStore((s) => s.push);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [localEntries, setLocalEntries] = useState<TimelineEntry[]>([]);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [bridgeApi, setBridgeApi] = useState<ReaderBridgeApi | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<ReturnType<typeof attachReaderBridge> | null>(null);

  // 加载条目
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

  const readyItem = state.phase === "ready" ? state.item : null;

  // 加载时间流标注
  useEffect(() => {
    if (!readyItem) return;
    let cancelled = false;
    listAnnotations(readyItem.id)
      .then((anns) => {
        if (!cancelled) setAnnotations(anns);
      })
      .catch(() => {
        if (!cancelled) pushToast("标注加载失败，时间流可能不完整", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [readyItem, pushToast]);

  // iframe 挂载后接桥
  useEffect(() => {
    if (!readyItem?.file_path) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handle = attachReaderBridge(iframe, {
      onReady: () => {
        /* reader 就绪；V1 无额外动作 */
      },
      onSelection: (sel) => {
        const r = iframe.getBoundingClientRect();
        const pos = menuPosition(
          { x: r.x, y: r.y, width: r.width, height: r.height },
          sel.rect,
          MENU_SIZE,
          { width: window.innerWidth, height: window.innerHeight },
        );
        setSelection({ sel, pos });
      },
      onSelectionCleared: () => setSelection(null),
    });
    bridgeRef.current = handle;
    setBridgeApi({ jumpTo: (t) => handle.jumpTo(t) });
    return () => {
      handle.dispose();
      bridgeRef.current = null;
      setBridgeApi(null);
      setSelection(null);
    };
  }, [readyItem?.file_path, readyItem?.id]);

  const dismissMenu = useCallback(() => {
    setSelection(null);
    bridgeRef.current?.clearSelection();
  }, []);

  const patchLocal = useCallback((id: string, f: (e: TimelineEntry) => TimelineEntry) => {
    setLocalEntries((es) => es.map((e) => (e.id === id ? f(e) : e)));
  }, []);

  const refetchAnnotations = useCallback(async (id: string) => {
    try {
      setAnnotations(await listAnnotations(id));
    } catch {
      /* 保留本地条目 */
    }
  }, []);

  /** 摘要/解释/翻译共用：本地 pending 条目流式填充；done 后以后端落的 annotation 为准（重拉列表） */
  const runAiAction = useCallback(
    async (
      type: Annotation["type"],
      sel: ReaderSelection,
      call: (onFrame: (f: SseFrame) => void) => Promise<void>,
    ) => {
      if (!readyItem) return;
      dismissMenu();
      localSeq += 1;
      const localId = `local-${localSeq}`;
      setLocalEntries((es) => [
        ...es,
        {
          id: localId,
          type,
          page: sel.page,
          content: "",
          created_at: nowStamp(),
          sort_index: Number.MAX_SAFE_INTEGER,
          pending: true,
        },
      ]);
      let hadError = false;
      try {
        await call((frame) => {
          if (typeof frame.delta === "string") {
            patchLocal(localId, (e) => ({ ...e, content: e.content + frame.delta }));
          } else if (typeof frame.error === "string") {
            hadError = true;
            patchLocal(localId, (e) => ({ ...e, pending: false, error: frame.error as string }));
          }
        });
        // 正常结束：后端已落 annotation（done 帧带 annotation_id）→ 重拉列表并撤掉本地临时条目
        if (!hadError) {
          setLocalEntries((es) => es.filter((e) => e.id !== localId));
          void refetchAnnotations(readyItem.id);
        }
      } catch (err) {
        patchLocal(localId, (e) => ({
          ...e,
          pending: false,
          error: err instanceof Error ? err.message : "请求失败",
        }));
      }
    },
    [readyItem, dismissMenu, patchLocal, refetchAnnotations],
  );

  const onSummarize = useCallback(() => {
    if (!selection || !readyItem) return;
    const { sel } = selection;
    void runAiAction("ai_summary", sel, (onFrame) =>
      aiSummarize({ text: sel.text, itemId: readyItem.id, page: sel.page }, onFrame),
    );
  }, [selection, readyItem, runAiAction]);

  const onExplain = useCallback(
    (level: ExplainLevel) => {
      if (!selection || !readyItem) return;
      const { sel } = selection;
      void runAiAction("ai_explain", sel, (onFrame) =>
        aiExplain({ text: sel.text, level, itemId: readyItem.id, page: sel.page }, onFrame),
      );
    },
    [selection, readyItem, runAiAction],
  );

  const onTranslate = useCallback(() => {
    if (!selection || !readyItem) return;
    const { sel } = selection;
    void runAiAction("ai_translate", sel, (onFrame) =>
      aiTranslate({ text: sel.text, itemId: readyItem.id, page: sel.page }, onFrame),
    );
  }, [selection, readyItem, runAiAction]);

  /** 追问：为选区建 ai_qa 标注（内容为选中原文），新条目默认展开对话线程 */
  const onFollowUp = useCallback(() => {
    if (!selection || !readyItem) return;
    const { sel } = selection;
    dismissMenu();
    void createAnnotation(readyItem.id, {
      type: "ai_qa",
      content: sel.text,
      page: sel.page,
      position: JSON.stringify(sel.position ?? null),
    })
      .then((ann) => {
        setAnnotations((as) => [...as, ann]);
        setOpenThreadId(ann.id);
      })
      .catch((e) => pushToast(e instanceof Error ? e.message : "创建追问失败", "error"));
  }, [selection, readyItem, dismissMenu, pushToast]);

  const onNote = useCallback(
    (text: string) => {
      if (!selection || !readyItem) return;
      const { sel } = selection;
      dismissMenu();
      void createAnnotation(readyItem.id, {
        type: "note",
        content: text,
        page: sel.page,
        position: JSON.stringify(sel.position ?? null),
      })
        .then((ann) => setAnnotations((as) => [...as, ann]))
        .catch((e) => pushToast(e instanceof Error ? e.message : "保存笔记失败", "error"));
    },
    [selection, readyItem, dismissMenu, pushToast],
  );

  /** 跳回原文：有 reader 原生 position 用 position（精确），否则按页 */
  const onJump = useCallback((entry: TimelineEntry) => {
    const b = bridgeRef.current;
    if (!b) return;
    if (entry.position) {
      try {
        b.jumpTo({ position: JSON.parse(entry.position) });
        return;
      } catch {
        /* 落回按页跳 */
      }
    }
    if (entry.page != null) b.jumpTo({ page: entry.page });
  }, []);

  /** 全文问答：本地 ai_qa 条目流式填充，done 帧带 citations */
  const onAsk = useCallback(
    (question: string) => {
      if (!readyItem || asking) return;
      setAsking(true);
      localSeq += 1;
      const localId = `local-${localSeq}`;
      setLocalEntries((es) => [
        ...es,
        {
          id: localId,
          type: "ai_qa",
          page: null,
          question,
          content: "",
          created_at: nowStamp(),
          sort_index: Number.MAX_SAFE_INTEGER,
          pending: true,
        },
      ]);
      void askItem(readyItem.id, question, (frame) => {
        if (typeof frame.delta === "string") {
          patchLocal(localId, (e) => ({ ...e, content: e.content + frame.delta }));
        } else if (typeof frame.error === "string") {
          patchLocal(localId, (e) => ({ ...e, pending: false, error: frame.error as string }));
        } else if (frame.done) {
          const citations = Array.isArray(frame.citations) ? (frame.citations as Citation[]) : undefined;
          patchLocal(localId, (e) => ({ ...e, pending: false, citations }));
        }
      })
        .catch((err) =>
          patchLocal(localId, (e) => ({
            ...e,
            pending: false,
            error: err instanceof Error ? err.message : "请求失败",
          })),
        )
        .finally(() => setAsking(false));
    },
    [readyItem, asking, patchLocal],
  );

  const entries = useMemo(
    () => [...annotations.map(annToEntry), ...localEntries],
    [annotations, localEntries],
  );

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
    <ReaderBridgeContext.Provider value={bridgeApi}>
      <div className="flex h-screen bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif">
        <div className="relative flex-1">
          <iframe
            ref={iframeRef}
            title="reader"
            src={`/reader/reader.html?file=${encodeURIComponent(file)}`}
            className="block h-full w-full border-0"
          />
          {selection && (
            <FloatingMenu
              position={selection.pos}
              selectedText={selection.sel.text}
              onSummarize={onSummarize}
              onExplain={onExplain}
              onTranslate={onTranslate}
              onFollowUp={onFollowUp}
              onNote={onNote}
            />
          )}
        </div>
        <aside
          aria-label="时间流"
          className="flex w-96 shrink-0 flex-col border-l border-line dark:border-dline bg-cream dark:bg-dcream"
        >
          <header className="border-b border-line dark:border-dline px-3 py-2">
            <h1 className="truncate text-sm font-bold" title={item.title}>
              {item.title}
            </h1>
          </header>
          <div className="flex-1 overflow-y-auto">
            <Timeline entries={entries} onJump={onJump} openThreadId={openThreadId} />
          </div>
          <AskBox disabled={asking} onAsk={onAsk} />
        </aside>
      </div>
    </ReaderBridgeContext.Provider>
  );
}
