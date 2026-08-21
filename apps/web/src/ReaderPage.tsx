// 阅读器页（契约 流B-1/3/5）：中栏 iframe reader（zotero/reader），右栏统一时间流面板。
// 桥接经 attachReaderBridge（流 A 提供；测试用 __mocks__ 替身）：选区 → 浮动菜单 → AI SSE → 时间流新条目。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isMockMode, apiUrl } from "./api/client";
import { isAbortError, type SseFrame, type SseOptions } from "./api/client";
import {
  aiExplain,
  aiExplainImage,
  aiSummarize,
  aiTranslate,
  askItem,
  createAnnotation,
  getItem,
  listAnnotations,
} from "./api/endpoints";
import type { Annotation, Citation, ExplainLevel, Item } from "./api/types";
import { attachReaderBridge, type ReaderAnnotation, type ReaderSelection } from "./reader/bridge";
import { ReaderBridgeContext, type ReaderBridgeApi } from "./reader/bridgeContext";
import { useResizableWidth } from "./hooks/useResizableWidth";
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

// 阅读器原生类型 → 后端类型。后端无 underline，归入 highlight（内容同为选中原文）；
// ink/image/text 无对应类型且无可落库文本，不同步。
const READER_TYPE_MAP: Record<string, "highlight" | "note"> = {
  highlight: "highlight",
  underline: "highlight",
  note: "note",
};

/** 去重键：type+page+position（后端 position 即 reader position 的 JSON 串） */
function syncKey(type: string, page: number | null, positionStr: string | null): string {
  return `${type}|${page ?? ""}|${positionStr ?? "null"}`;
}

function backendKey(a: Annotation): string {
  return syncKey(a.type, a.page, a.position);
}

function readerKey(mapped: "highlight" | "note", a: ReaderAnnotation): string {
  return syncKey(mapped, a.page, JSON.stringify(a.position ?? null));
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
  const { width: timelineWidth, handle: timelineHandle } = useResizableWidth("pw-timeline-width", 384);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<ReturnType<typeof attachReaderBridge> | null>(null);
  /** 进行中 SSE 请求的 AbortController 集合；卸载时统一 abort */
  const abortersRef = useRef<Set<AbortController>>(new Set());

  // 卸载：中止全部进行中的流（避免卸载后 setState 与浪费 LLM 调用）
  useEffect(() => {
    const aborters = abortersRef.current;
    return () => {
      for (const c of aborters) c.abort();
      aborters.clear();
    };
  }, []);

  const newAborter = useCallback((): AbortController => {
    const c = new AbortController();
    abortersRef.current.add(c);
    return c;
  }, []);

  const releaseAborter = useCallback((c: AbortController) => {
    abortersRef.current.delete(c);
  }, []);

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

  /** 重拉标注列表；返回是否成功（失败时调用方须保留本地条目） */
  const refetchAnnotations = useCallback(async (id: string): Promise<boolean> => {
    try {
      setAnnotations(await listAnnotations(id));
      return true;
    } catch {
      return false;
    }
  }, []);

  // 最新标注列表的 ref：桥回调在 attach 时注册，靠它避免读到过期闭包
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  /** 已同步/同步中的阅读器标注键：reader 对同一标注会重复推送（编辑、去抖重发），防重复落库 */
  const syncedReaderKeysRef = useRef<Set<string>>(new Set());

  /** 阅读器内创建的标注（reader 工具栏高亮/笔记）→ 落库并刷新时间流（单向 reader → host） */
  const handleReaderAnnotations = useCallback(
    (readerAnns: ReaderAnnotation[]) => {
      if (!readyItem) return;
      const itemId = readyItem.id;
      const existing = new Set(annotationsRef.current.map(backendKey));
      const toCreate: { key: string; input: Parameters<typeof createAnnotation>[1] }[] = [];
      for (const a of readerAnns) {
        const mapped = READER_TYPE_MAP[a.type];
        if (!mapped) continue;
        // 高亮内容为选中原文；笔记内容为用户批注（创建瞬间批注为空则暂跳过，编辑后会重发）
        const content = mapped === "note" ? a.comment || a.text : a.text || a.comment;
        if (!content) continue;
        const key = readerKey(mapped, a);
        if (existing.has(key) || syncedReaderKeysRef.current.has(key)) continue;
        syncedReaderKeysRef.current.add(key);
        toCreate.push({
          key,
          input: {
            type: mapped,
            content,
            page: a.page,
            position: JSON.stringify(a.position ?? null),
            color: a.color,
          },
        });
      }
      if (!toCreate.length) return;
      void (async () => {
        let created = 0;
        let failed = 0;
        for (const { key, input } of toCreate) {
          try {
            await createAnnotation(itemId, input);
            created += 1;
          } catch {
            failed += 1;
            syncedReaderKeysRef.current.delete(key); // 允许后续重试
          }
        }
        const ok = await refetchAnnotations(itemId);
        if (failed > 0 || (created > 0 && !ok)) {
          pushToast("阅读器标注同步失败，时间流可能不完整", "error");
        }
      })();
    },
    [readyItem, refetchAnnotations, pushToast],
  );

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
      onAnnotationsChanged: (readerAnns) => handleReaderAnnotations(readerAnns),
      onAreaCapture: (capture) => void handleAreaCapture(capture),
    });
    bridgeRef.current = handle;
    setBridgeApi({ jumpTo: (t) => handle.jumpTo(t) });
    return () => {
      handle.dispose();
      bridgeRef.current = null;
      setBridgeApi(null);
      setSelection(null);
    };
  }, [readyItem?.file_path, readyItem?.id, handleReaderAnnotations]);

  const dismissMenu = useCallback(() => {
    setSelection(null);
    bridgeRef.current?.clearSelection();
  }, []);

  const patchLocal = useCallback((id: string, f: (e: TimelineEntry) => TimelineEntry) => {
    setLocalEntries((es) => es.map((e) => (e.id === id ? f(e) : e)));
  }, []);

  /** 区域截图（Select Area 工具的 image 标注）→ 多模态解释，流式进时间流 */
  const handleAreaCapture = useCallback(
    async (capture: { dataUrl: string; page: number; position: unknown }) => {
      if (!readyItem) return;
      localSeq += 1;
      const localId = `local-${localSeq}`;
      setLocalEntries((es) => [
        ...es,
        {
          id: localId,
          type: "ai_explain",
          page: capture.page,
          content: "",
          created_at: nowStamp(),
          sort_index: Number.MAX_SAFE_INTEGER,
          pending: true,
          question: "🖼 区域截图解释",
        },
      ]);
      const aborter = newAborter();
      let hadError = false;
      let thinkingAcc = "";
      try {
        await aiExplainImage(
          { image: capture.dataUrl, level: "grad", itemId: readyItem.id, page: capture.page },
          (frame) => {
            if (typeof frame.delta === "string") {
              patchLocal(localId, (e) => ({ ...e, content: e.content + frame.delta }));
            } else if (typeof frame.thinking === "string") {
              thinkingAcc += frame.thinking as string;
              patchLocal(localId, (e) => ({ ...e, thinking: (e.thinking ?? "") + (frame.thinking as string) }));
            } else if (frame.done) {
              if (thinkingAcc && typeof frame.annotation_id === "string") {
                thinkingByAnnRef.current.set(frame.annotation_id, thinkingAcc);
              }
            } else if (typeof frame.error === "string") {
              hadError = true;
              patchLocal(localId, (e) => ({ ...e, pending: false, error: frame.error as string }));
            }
          },
          { signal: aborter.signal },
        );
        if (!hadError) {
          const ok = await refetchAnnotations(readyItem.id);
          if (ok) {
            setLocalEntries((es) => es.filter((e) => e.id !== localId));
          } else {
            patchLocal(localId, (e) => ({ ...e, pending: false }));
          }
        }
      } catch (err) {
        if (!isAbortError(err)) {
          patchLocal(localId, (e) => ({
            ...e, pending: false, error: err instanceof Error ? err.message : "请求失败",
          }));
        }
      } finally {
        releaseAborter(aborter);
      }
    },
    [readyItem, newAborter, releaseAborter, patchLocal, refetchAnnotations],
  );

  /** 摘要/解释/翻译共用：本地 pending 条目流式填充；done 后重拉成功才撤本地条目，失败保留并轻提示 */
  const runAiAction = useCallback(
    async (
      type: Annotation["type"],
      sel: ReaderSelection,
      call: (onFrame: (f: SseFrame) => void, opts: SseOptions) => Promise<void>,
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
      const aborter = newAborter();
      let hadError = false;
      let thinkingAcc = "";
      try {
        await call(
          (frame) => {
            if (typeof frame.delta === "string") {
              patchLocal(localId, (e) => ({ ...e, content: e.content + frame.delta }));
            } else if (typeof frame.thinking === "string") {
              thinkingAcc += frame.thinking as string;
              patchLocal(localId, (e) => ({ ...e, thinking: (e.thinking ?? "") + (frame.thinking as string) }));
            } else if (frame.done) {
              if (thinkingAcc && typeof frame.annotation_id === "string") {
                thinkingByAnnRef.current.set(frame.annotation_id, thinkingAcc);
              }
            } else if (typeof frame.error === "string") {
              hadError = true;
              patchLocal(localId, (e) => ({ ...e, pending: false, error: frame.error as string }));
            }
          },
          { signal: aborter.signal },
        );
        if (!hadError) {
          // 后端已落 annotation（done 帧带 annotation_id）：重拉成功才撤本地条目；
          // 重拉失败则保留本地流式结果（pending:false），避免用户刚看的内容消失
          const ok = await refetchAnnotations(readyItem.id);
          if (ok) {
            setLocalEntries((es) => es.filter((e) => e.id !== localId));
          } else {
            patchLocal(localId, (e) => ({ ...e, pending: false }));
            pushToast("时间流同步失败，以上结果为临时展示", "error");
          }
        }
      } catch (err) {
        if (isAbortError(err)) return; // 卸载中止，静默
        patchLocal(localId, (e) => ({
          ...e,
          pending: false,
          error: err instanceof Error ? err.message : "请求失败",
        }));
      } finally {
        releaseAborter(aborter);
      }
    },
    [readyItem, dismissMenu, patchLocal, refetchAnnotations, newAborter, releaseAborter, pushToast],
  );

  const onSummarize = useCallback(() => {
    if (!selection || !readyItem) return;
    const { sel } = selection;
    void runAiAction("ai_summary", sel, (onFrame, opts) =>
      aiSummarize({ text: sel.text, itemId: readyItem.id, page: sel.page }, onFrame, opts),
    );
  }, [selection, readyItem, runAiAction]);

  const onExplain = useCallback(
    (level: ExplainLevel) => {
      if (!selection || !readyItem) return;
      const { sel } = selection;
      void runAiAction("ai_explain", sel, (onFrame, opts) =>
        aiExplain({ text: sel.text, level, itemId: readyItem.id, page: sel.page }, onFrame, opts),
      );
    },
    [selection, readyItem, runAiAction],
  );

  const onTranslate = useCallback(() => {
    if (!selection || !readyItem) return;
    const { sel } = selection;
    void runAiAction("ai_translate", sel, (onFrame, opts) =>
      aiTranslate({ text: sel.text, itemId: readyItem.id, page: sel.page }, onFrame, opts),
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
      let thinkingAcc = "";
      const aborter = newAborter();
      void askItem(
        readyItem.id,
        question,
        (frame) => {
          if (typeof frame.delta === "string") {
            patchLocal(localId, (e) => ({ ...e, content: e.content + frame.delta }));
          } else if (typeof frame.thinking === "string") {
            thinkingAcc += frame.thinking as string;
              patchLocal(localId, (e) => ({ ...e, thinking: (e.thinking ?? "") + (frame.thinking as string) }));
          } else if (typeof frame.error === "string") {
            patchLocal(localId, (e) => ({ ...e, pending: false, error: frame.error as string }));
          } else if (frame.done) {
            const citations = Array.isArray(frame.citations) ? (frame.citations as Citation[]) : undefined;
            patchLocal(localId, (e) => ({ ...e, pending: false, citations }));
          }
        },
        { signal: aborter.signal },
      )
        .catch((err) => {
          if (isAbortError(err)) return; // 卸载中止，静默
          patchLocal(localId, (e) => ({
            ...e,
            pending: false,
            error: err instanceof Error ? err.message : "请求失败",
          }));
        })
        .finally(() => {
          releaseAborter(aborter);
          setAsking(false);
        });
    },
    [readyItem, asking, patchLocal, newAborter, releaseAborter],
  );

  /** 思考过程不落库（annotation 只存正文），用 annotation_id 暂存以在重拉后恢复显示 */
  const thinkingByAnnRef = useRef<Map<string, string>>(new Map());

  const entries = useMemo(
    () => [
      ...annotations.map((a) => {
        const e = annToEntry(a);
        const thinking = thinkingByAnnRef.current.get(a.id);
        return thinking ? { ...e, thinking } : e;
      }),
      ...localEntries,
    ],
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

  // mock 模式下后端并不会真的流式返回 PDF，用内置样例代替以便演示。
  // 注意必须用 apiUrl 解析成绝对 URL：pdf.js 的 Web Worker 不执行
  // Tauri 注入的 fetch 重写，相对路径会解析到 tauri://localhost 而 404。
  const file = isMockMode()
    ? "/samples/sample.pdf"
    : apiUrl(`/api/items/${encodeURIComponent(item.id)}/pdf`);

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
          style={{ width: timelineWidth }}
          className="relative flex shrink-0 flex-col border-l border-line dark:border-dline bg-cream dark:bg-dcream"
        >
          {timelineHandle}
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
