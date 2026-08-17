import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import ItemList from "../components/ItemList";
import PreviewPanel from "../components/PreviewPanel";
import Sidebar from "../components/Sidebar";
import { useLibraryStore } from "../stores/libraryStore";
import { useThemeStore } from "../stores/themeStore";
import { useUiStore } from "../stores/uiStore";

function isInteractiveTarget(target: EventTarget | null): boolean {
  // 焦点在输入框、按钮、链接等可交互元素上时，Enter/方向键归该元素处理，不做列表导航
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]') !== null
  );
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const loadItems = useLibraryStore((s) => s.loadItems);
  const loadFacets = useLibraryStore((s) => s.loadFacets);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setImportOpen = useUiStore((s) => s.setImportOpen);

  useEffect(() => {
    void loadItems();
    void loadFacets();
  }, [loadItems, loadFacets]);

  // 键盘导航：↑↓ / ⌘↑⌘↓ 移动选中，Enter 打开阅读器
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().paletteOpen || useUiStore.getState().importOpen) return;
      if (isInteractiveTarget(e.target)) return;
      const lib = useLibraryStore.getState();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        lib.moveSelection(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter" && lib.selectedId) {
        navigate(`/read/${lib.selectedId}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-screen bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-line dark:border-dline bg-cream dark:bg-dcream">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="px-2.5 py-1 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper text-sm"
          >
            导入
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="px-2.5 py-1 rounded border border-line dark:border-dline text-sm text-muted dark:text-dmuted hover:bg-hoverbg dark:hover:bg-dhover"
          >
            搜索 / 命令（⌘K）
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="切换主题"
            onClick={toggleTheme}
            className="px-2.5 py-1 rounded border border-line dark:border-dline text-sm hover:bg-hoverbg dark:hover:bg-dhover"
          >
            {theme === "dark" ? "☀ 浅色" : "☾ 暗色"}
          </button>
          <Link
            to="/settings"
            className="px-2.5 py-1 rounded border border-line dark:border-dline text-sm hover:bg-hoverbg dark:hover:bg-dhover"
          >
            设置
          </Link>
        </header>
        <ItemList onOpen={(id) => navigate(`/read/${id}`)} />
      </div>
      <PreviewPanel />
    </div>
  );
}
