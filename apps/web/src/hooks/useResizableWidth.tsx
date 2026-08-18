// 侧边栏宽度拖拽：左缘 6px 手柄，pointer 捕获拖拽，宽度持久化到 localStorage。
import { useCallback, useEffect, useRef, useState } from "react";

const MIN = 240;
const MAX = 640;

export function useResizableWidth(storageKey: string, initial: number) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= MIN && saved <= MAX ? saved : initial;
  });
  const dragging = useRef(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // 手柄在面板左缘：指针越往左，面板越宽
    const next = Math.min(MAX, Math.max(MIN, window.innerWidth - e.clientX));
    setWidth(next);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整侧栏宽度"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-navy/30 dark:hover:bg-dnavy/30 active:bg-navy/50"
    />
  );

  return { width, handle };
}
