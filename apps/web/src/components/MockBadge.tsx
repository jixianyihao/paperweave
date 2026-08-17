import { useState } from "react";
import { disableMockMode, isMockMode } from "../api/client";
import { useLibraryStore } from "../stores/libraryStore";

/** mock 模式可见标识：右上角浮层，点击退出 mock 并刷新真实数据 */
export default function MockBadge() {
  const [mock, setMock] = useState(isMockMode());
  if (!mock) return null;
  return (
    <button
      type="button"
      onClick={() => {
        disableMockMode();
        setMock(false);
        void useLibraryStore.getState().refresh();
      }}
      className="fixed top-2 right-2 z-50 rounded-full border border-gold bg-gold/15 text-gold dark:border-dgold dark:text-dgold px-3 py-1 text-xs font-sans shadow"
      title="当前使用内置演示数据，点击退出并连接真实后端"
    >
      Mock 模式 · 点击退出
    </button>
  );
}
