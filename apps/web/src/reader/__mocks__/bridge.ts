// attachReaderBridge 的测试替身（契约：阶段4+5 流间接口1，真实实现由流 A 在 ../bridge.ts 提供）。
// 用法：vi.mock("../../reader/bridge", async () => await import("../../reader/__mocks__/bridge"))
// 组件测试里通过 mockBridges / lastMockBridge 拿到实例，emit* 模拟 iframe 事件，断言 jumpTo 调用。

export interface ReaderSelection {
  text: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  position: unknown;
}

export interface ReaderAnnotation {
  id: string;
  type: string;
  text: string;
  comment: string;
  color: string | null;
  page: number | null;
  pageLabel: string | null;
  position: unknown;
}

export interface BridgeHandlers {
  onReady(): void;
  onSelection(sel: ReaderSelection): void;
  onSelectionCleared(): void;
  onAnnotationsChanged(annotations: ReaderAnnotation[], deletedIds: string[]): void;
}

export interface BridgeHandle {
  jumpTo(pageOrPosition: { page?: number; position?: unknown }): void;
  clearSelection(): void;
  dispose(): void;
}

export interface MockBridge extends BridgeHandle {
  iframe: HTMLIFrameElement;
  handlers: BridgeHandlers;
  jumpToCalls: { page?: number; position?: unknown }[];
  clearCalls: number;
  disposed: boolean;
  emitReady(): void;
  emitSelection(sel: ReaderSelection): void;
  emitSelectionCleared(): void;
  emitAnnotationsChanged(annotations: ReaderAnnotation[], deletedIds?: string[]): void;
}

export const mockBridges: MockBridge[] = [];

export function attachReaderBridge(iframe: HTMLIFrameElement, handlers: BridgeHandlers): MockBridge {
  const bridge: MockBridge = {
    iframe,
    handlers,
    jumpToCalls: [],
    clearCalls: 0,
    disposed: false,
    jumpTo(target) {
      bridge.jumpToCalls.push(target);
    },
    clearSelection() {
      bridge.clearCalls += 1;
    },
    dispose() {
      bridge.disposed = true;
    },
    emitReady() {
      handlers.onReady();
    },
    emitSelection(sel) {
      handlers.onSelection(sel);
    },
    emitSelectionCleared() {
      handlers.onSelectionCleared();
    },
    emitAnnotationsChanged(annotations, deletedIds = []) {
      handlers.onAnnotationsChanged(annotations, deletedIds);
    },
  };
  mockBridges.push(bridge);
  return bridge;
}

export function lastMockBridge(): MockBridge | undefined {
  return mockBridges[mockBridges.length - 1];
}

export function resetMockBridges(): void {
  mockBridges.length = 0;
}
