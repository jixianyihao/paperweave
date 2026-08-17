// PaperWeave reader bridge — parent-window side.
//
// The zotero/reader runs inside an iframe (/reader/reader.html?file=...).
// scripts/reader-bootstrap.js (injected into reader.html at build time) is the
// iframe side of this bridge; both sides communicate over window.postMessage:
//
//   iframe → parent: { source: "pw-reader", type: "ready" | "selection" | "selectionCleared", payload? }
//   parent → iframe: { source: "pw-host",   type: "jumpTo" | "clearSelection", payload? }
//
// Protocol source of truth:
// docs/superpowers/plans/2026-08-17-paperweave-phase45-contract.md (流间接口 1)

export interface ReaderSelection {
  text: string;
  /** 1-based page index (pageIndex + 1). */
  page: number;
  /** Selection bounding box in iframe viewport coordinates — position floating UI with it. */
  rect: { x: number; y: number; width: number; height: number };
  /** Reader-native position object, passed through untouched; feed back to jumpTo. */
  position: unknown;
}

interface ReaderBridgeHandlers {
  onReady(): void;
  onSelection(sel: ReaderSelection): void;
  onSelectionCleared(): void;
}

export interface ReaderBridge {
  jumpTo(pageOrPosition: { page?: number; position?: unknown }): void;
  clearSelection(): void;
  dispose(): void;
}

const READER_SOURCE = "pw-reader";
const HOST_SOURCE = "pw-host";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidRect(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

function parseSelection(payload: unknown): ReaderSelection | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.text !== "string") return null;
  if (!isFiniteNumber(p.page)) return null;
  if (!isValidRect(p.rect)) return null;
  return {
    text: p.text,
    page: p.page,
    rect: p.rect as ReaderSelection["rect"],
    position: p.position,
  };
}

function targetOriginFor(iframe: HTMLIFrameElement): string {
  // The reader is served same-origin by the web app, but derive the origin from
  // the iframe src so a cross-origin reader build still gets messages.
  try {
    return new URL(iframe.src, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export function attachReaderBridge(
  iframe: HTMLIFrameElement,
  handlers: ReaderBridgeHandlers,
): ReaderBridge {
  let disposed = false;

  const onMessage = (event: MessageEvent) => {
    if (disposed) return;
    // Only trust messages coming from this exact iframe's window.
    if (event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if (data.source !== READER_SOURCE) return;
    switch (data.type) {
      case "ready":
        handlers.onReady();
        break;
      case "selection": {
        const sel = parseSelection(data.payload);
        if (sel) handlers.onSelection(sel);
        break;
      }
      case "selectionCleared":
        handlers.onSelectionCleared();
        break;
      default:
        // Unknown message type — ignore.
        break;
    }
  };

  window.addEventListener("message", onMessage);

  const post = (message: Record<string, unknown>) => {
    if (disposed) return;
    iframe.contentWindow?.postMessage(
      { source: HOST_SOURCE, ...message },
      targetOriginFor(iframe),
    );
  };

  return {
    jumpTo(pageOrPosition) {
      post({ type: "jumpTo", payload: pageOrPosition });
    },
    clearSelection() {
      post({ type: "clearSelection" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("message", onMessage);
    },
  };
}
