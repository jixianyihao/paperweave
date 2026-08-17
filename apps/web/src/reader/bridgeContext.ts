// 阅读器桥能力的 React 上下文：ReaderPage 挂载桥后提供 jumpTo，
// 时间流/线程/问答里的「跳回原文」「引用锚点」统一经此调桥（测试里注入假实现即可，无需碰 iframe）。
import { createContext, useContext } from "react";

export interface BridgeJumpTarget {
  page?: number;
  position?: unknown;
}

export interface ReaderBridgeApi {
  jumpTo(target: BridgeJumpTarget): void;
}

export const ReaderBridgeContext = createContext<ReaderBridgeApi | null>(null);

export function useReaderBridge(): ReaderBridgeApi | null {
  return useContext(ReaderBridgeContext);
}
