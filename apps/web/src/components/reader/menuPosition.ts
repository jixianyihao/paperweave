// 浮动菜单定位：rect 来自 iframe 视口坐标，需叠加 iframe 元素在页面中的偏移。
// 默认置于选区上方并水平居中；上方空间不足翻到下方；左右钳制在视口内。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const EDGE = 8;

export function menuPosition(
  iframeRect: Rect,
  selRect: Rect,
  menuSize: Size,
  viewport: Size,
): { left: number; top: number } {
  const centerX = iframeRect.x + selRect.x + selRect.width / 2;
  let left = centerX - menuSize.width / 2;
  left = Math.max(EDGE, Math.min(left, viewport.width - menuSize.width - EDGE));

  let top = iframeRect.y + selRect.y - menuSize.height - EDGE;
  if (top < EDGE) top = iframeRect.y + selRect.y + selRect.height + EDGE;
  top = Math.min(top, viewport.height - menuSize.height - EDGE);

  return { left: Math.round(left), top: Math.round(top) };
}
