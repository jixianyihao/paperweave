import { describe, expect, test } from "vitest";
import { menuPosition } from "./menuPosition";

const viewport = { width: 1200, height: 800 };
const menu = { width: 320, height: 44 };

describe("menuPosition 浮动菜单定位（含 iframe 偏移）", () => {
  test("水平居中对齐选区，垂直置于选区上方，均计入 iframe 在页面中的偏移", () => {
    const iframeRect = { x: 100, y: 50, width: 800, height: 700 };
    const sel = { x: 200, y: 300, width: 100, height: 20 };
    const pos = menuPosition(iframeRect, sel, menu, viewport);
    // left = 100 + 200 + 50 - 160 = 190
    expect(pos.left).toBe(190);
    // top = 50 + 300 - 44 - 8 = 298
    expect(pos.top).toBe(298);
  });

  test("选区贴近顶部时翻到选区下方", () => {
    const iframeRect = { x: 0, y: 0, width: 800, height: 700 };
    const sel = { x: 100, y: 10, width: 100, height: 20 };
    const pos = menuPosition(iframeRect, sel, menu, viewport);
    // 上方空间不足 → top = 10 + 20 + 8 = 38
    expect(pos.top).toBe(38);
  });

  test("左/右边缘钳制在视口内", () => {
    const iframeRect = { x: 0, y: 100, width: 800, height: 600 };
    const leftSel = { x: 0, y: 200, width: 10, height: 20 };
    expect(menuPosition(iframeRect, leftSel, menu, viewport).left).toBe(8);
    const rightSel = { x: 790, y: 200, width: 10, height: 20 };
    // iframe 自身右移后，选区中心贴近视口右缘 → 钳制到 1200-320-8
    expect(menuPosition({ ...iframeRect, x: 400 }, rightSel, menu, viewport).left).toBe(1200 - 320 - 8);
  });
});
