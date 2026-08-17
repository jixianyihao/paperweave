import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attachReaderBridge, type ReaderSelection } from "./bridge";

function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = "/reader/reader.html?file=/samples/sample.pdf";
  document.body.appendChild(iframe);
  return iframe;
}

function postFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: iframe.contentWindow }),
  );
}

function postFromElsewhere(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const validSelectionPayload = {
  text: "hello world",
  page: 3,
  rect: { x: 10, y: 20, width: 100, height: 12 },
  position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
};

function makeHandlers() {
  return {
    onReady: vi.fn(),
    onSelection: vi.fn(),
    onSelectionCleared: vi.fn(),
  };
}

describe("attachReaderBridge", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = makeIframe();
  });

  afterEach(() => {
    iframe.remove();
  });

  it("calls onReady for a ready message from the iframe", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, { source: "pw-reader", type: "ready" });
    expect(handlers.onReady).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("parses a valid selection message and passes payload through", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, {
      source: "pw-reader",
      type: "selection",
      payload: validSelectionPayload,
    });
    expect(handlers.onSelection).toHaveBeenCalledTimes(1);
    const sel = handlers.onSelection.mock.calls[0][0] as ReaderSelection;
    expect(sel.text).toBe("hello world");
    expect(sel.page).toBe(3);
    expect(sel.rect).toEqual({ x: 10, y: 20, width: 100, height: 12 });
    expect(sel.position).toEqual(validSelectionPayload.position);
    bridge.dispose();
  });

  it("calls onSelectionCleared for selectionCleared", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, { source: "pw-reader", type: "selectionCleared" });
    expect(handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("ignores messages from a different window source", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromElsewhere({ source: "pw-reader", type: "ready" });
    expect(handlers.onReady).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("ignores messages with a wrong source tag", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, { source: "someone-else", type: "ready" });
    postFromIframe(iframe, { type: "ready" });
    postFromIframe(iframe, "pw-reader");
    postFromIframe(iframe, null);
    postFromIframe(iframe, 42);
    expect(handlers.onReady).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("ignores unknown message types", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, { source: "pw-reader", type: "explode" });
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(handlers.onSelection).not.toHaveBeenCalled();
    expect(handlers.onSelectionCleared).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it.each([
    ["missing payload", undefined],
    ["non-object payload", "nope"],
    ["non-string text", { ...validSelectionPayload, text: 5 }],
    ["non-number page", { ...validSelectionPayload, page: "3" }],
    ["NaN page", { ...validSelectionPayload, page: NaN }],
    [
      "bad rect",
      { ...validSelectionPayload, rect: { x: 0, y: 0, width: "w", height: 1 } },
    ],
    ["null rect", { ...validSelectionPayload, rect: null }],
  ])("ignores malformed selection: %s", (_label, payload) => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    postFromIframe(iframe, { source: "pw-reader", type: "selection", payload });
    expect(handlers.onSelection).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("jumpTo posts a pw-host jumpTo message to the iframe", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    const spy = vi.spyOn(iframe.contentWindow!, "postMessage");
    bridge.jumpTo({ page: 5 });
    expect(spy).toHaveBeenCalledWith(
      { source: "pw-host", type: "jumpTo", payload: { page: 5 } },
      window.location.origin,
    );
    spy.mockClear();
    const position = { pageIndex: 1, rects: [] };
    bridge.jumpTo({ position });
    expect(spy).toHaveBeenCalledWith(
      { source: "pw-host", type: "jumpTo", payload: { position } },
      window.location.origin,
    );
    bridge.dispose();
  });

  it("clearSelection posts a pw-host clearSelection message", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    const spy = vi.spyOn(iframe.contentWindow!, "postMessage");
    bridge.clearSelection();
    expect(spy).toHaveBeenCalledWith(
      { source: "pw-host", type: "clearSelection" },
      window.location.origin,
    );
    bridge.dispose();
  });

  it("dispose removes the message listener and disables posts", () => {
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(iframe, handlers);
    bridge.dispose();
    postFromIframe(iframe, { source: "pw-reader", type: "ready" });
    expect(handlers.onReady).not.toHaveBeenCalled();
    const spy = vi.spyOn(iframe.contentWindow!, "postMessage");
    bridge.jumpTo({ page: 1 });
    bridge.clearSelection();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw when the iframe has no contentWindow", () => {
    const detached = document.createElement("iframe");
    const handlers = makeHandlers();
    const bridge = attachReaderBridge(detached, handlers);
    expect(() => {
      bridge.jumpTo({ page: 1 });
      bridge.clearSelection();
      bridge.dispose();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Iframe side: scripts/reader-bootstrap.js
//
// The bootstrap is a plain browser script (copied next to reader.html by
// build-reader.sh), so these tests eval it into the jsdom window with a fake
// createReader and a fake parent window, then drive the reader's internal
// _updateState the way vendor/zotero-reader does. The contract exempts the
// reader-internal probing from unit tests, but the selection-popup dedupe is
// pure protocol logic and is covered here (review finding: rect must be part
// of the dedupe key, otherwise the host's floating menu anchor goes stale
// when the view re-emits the popup with an updated rect during scrolling).
// ---------------------------------------------------------------------------

// vitest runs with cwd = apps/web; the bootstrap lives at <repo>/scripts.
const bootstrapSrc = readFileSync(
  resolve(process.cwd(), "../../scripts/reader-bootstrap.js"),
  "utf8",
);

interface FakePopup {
  rect: [number, number, number, number];
  annotation: { text: string; position: { pageIndex: number; rects: number[][] } };
}

function makePopup(
  rect: [number, number, number, number],
  text = "hello",
): FakePopup {
  return {
    rect,
    annotation: { text, position: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
  };
}

describe("reader-bootstrap (iframe side)", () => {
  let parentPost: ReturnType<typeof vi.fn>;
  let fakeReader: {
    _updateState: ReturnType<typeof vi.fn>;
    _primaryView: { initializedPromise: Promise<void> };
    _lastView: { clearSelection: ReturnType<typeof vi.fn> };
    navigate: ReturnType<typeof vi.fn>;
  };
  let originalParent: PropertyDescriptor | undefined;

  const selectionPosts = () =>
    parentPost.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "selection" || m.type === "selectionCleared");

  function boot() {
    window.history.replaceState(
      {},
      "",
      "/reader/reader.html?file=/samples/sample.pdf",
    );
    window.eval(bootstrapSrc);
    window.dispatchEvent(new Event("DOMContentLoaded"));
  }

  beforeEach(() => {
    parentPost = vi.fn();
    originalParent = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: parentPost },
    });
    fakeReader = {
      _updateState: vi.fn(),
      _primaryView: { initializedPromise: Promise.resolve() },
      _lastView: { clearSelection: vi.fn() },
      navigate: vi.fn(),
    };
    // Mirrors upstream createReader: refuses to run twice.
    (window as unknown as Record<string, unknown>).createReader = vi.fn(() => {
      if ((window as unknown as Record<string, unknown>)._reader) {
        throw new Error("Reader is already initialized");
      }
      (window as unknown as Record<string, unknown>)._reader = fakeReader;
      return fakeReader;
    });
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)._reader;
    delete (window as unknown as Record<string, unknown>).createReader;
    if (originalParent) {
      Object.defineProperty(window, "parent", originalParent);
    }
    window.history.replaceState({}, "", "/");
  });

  it("posts ready once the primary view initializes", async () => {
    boot();
    await Promise.resolve();
    await Promise.resolve();
    expect(parentPost).toHaveBeenCalledWith(
      { source: "pw-reader", type: "ready" },
      "*",
    );
  });

  it("posts selection with contract payload shape", () => {
    boot();
    fakeReader._updateState({ primaryViewSelectionPopup: makePopup([10, 20, 110, 36]) });
    const posts = selectionPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      source: "pw-reader",
      type: "selection",
      payload: {
        text: "hello",
        page: 1,
        rect: { x: 10, y: 20, width: 100, height: 16 },
        position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
      },
    });
  });

  it("dedupes the identical popup re-emitted during scrolling", () => {
    boot();
    const popup = makePopup([10, 20, 110, 36]);
    // The view emits a NEW object with the same content while scrolling.
    fakeReader._updateState({ primaryViewSelectionPopup: popup });
    fakeReader._updateState({ primaryViewSelectionPopup: makePopup([10, 20, 110, 36]) });
    expect(selectionPosts()).toHaveLength(1);
  });

  it("re-posts selection when the rect changes (scroll anchor update)", () => {
    boot();
    fakeReader._updateState({ primaryViewSelectionPopup: makePopup([10, 20, 110, 36]) });
    fakeReader._updateState({ primaryViewSelectionPopup: makePopup([10, 5, 110, 21]) });
    const posts = selectionPosts();
    expect(posts).toHaveLength(2);
    expect(posts[1].payload.rect).toEqual({ x: 10, y: 5, width: 100, height: 16 });
  });

  it("posts selectionCleared once when the popup goes away", () => {
    boot();
    fakeReader._updateState({ primaryViewSelectionPopup: makePopup([10, 20, 110, 36]) });
    fakeReader._updateState({ primaryViewSelectionPopup: undefined });
    fakeReader._updateState({ primaryViewSelectionPopup: undefined });
    const posts = selectionPosts();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ source: "pw-reader", type: "selectionCleared" });
  });

  it("answers pw-host jumpTo (page → pageIndex) and clearSelection", async () => {
    boot();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "pw-host", type: "jumpTo", payload: { page: 3 } },
        source: window.parent as unknown as Window,
      }),
    );
    expect(fakeReader.navigate).toHaveBeenCalledWith({ pageIndex: 2 });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "pw-host", type: "clearSelection" },
        source: window.parent as unknown as Window,
      }),
    );
    expect(fakeReader._lastView.clearSelection).toHaveBeenCalled();
  });

  it("a rejecting navigate does not produce an unhandled rejection", async () => {
    boot();
    fakeReader.navigate.mockRejectedValue(new Error("boom"));
    const onUnhandled = vi.fn();
    window.addEventListener("unhandledrejection", onUnhandled);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "pw-host", type: "jumpTo", payload: { page: 3 } },
        source: window.parent as unknown as Window,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onUnhandled);
  });
});
