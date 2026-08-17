import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
