import { parseCreators, type Item } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";

const STATUS_LABEL: Record<Item["reading_status"], string> = {
  unread: "待读",
  reading: "在读",
  read: "已读",
};

export interface ItemListProps {
  onOpen: (id: string) => void;
}

export default function ItemList({ onOpen }: ItemListProps) {
  const items = useLibraryStore((s) => s.items);
  const selectedId = useLibraryStore((s) => s.selectedId);
  const selectItem = useLibraryStore((s) => s.selectItem);
  const loading = useLibraryStore((s) => s.loading);
  const error = useLibraryStore((s) => s.error);

  if (error) {
    return <main className="flex-1 p-4 text-sm text-red-700 dark:text-red-400">加载失败：{error}</main>;
  }

  return (
    <main aria-label="条目列表" className="flex-1 min-w-0 overflow-y-auto">
      {loading && <p className="p-4 text-sm text-muted dark:text-dmuted">加载中…</p>}
      {!loading && items.length === 0 && (
        <p className="p-4 text-sm text-muted dark:text-dmuted">
          没有文献。拖拽 PDF 到窗口，或按 ⌘K 选择「导入文献」。
        </p>
      )}
      <ul role="listbox" aria-label="文献" aria-activedescendant={selectedId ?? undefined}>
        {items.map((item) => {
          const creators = parseCreators(item);
          const selected = item.id === selectedId;
          return (
            <li key={item.id} id={item.id} role="option" aria-selected={selected}>
              <button
                type="button"
                className={`w-full text-left px-3 py-2 border-b border-line dark:border-dline flex items-baseline gap-2 ${
                  selected ? "bg-hoverbg dark:bg-dhover" : "hover:bg-cream dark:hover:bg-dcream"
                }`}
                onClick={() => selectItem(item.id)}
                onDoubleClick={() => onOpen(item.id)}
              >
                <span className="w-4 shrink-0 text-gold dark:text-dgold" aria-hidden>
                  {item.starred === 1 ? "★" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted dark:text-dmuted">
                    {creators.length > 0 ? creators.join(", ") : "佚名"}
                    {item.year ? ` · ${item.year}` : ""}
                    {item.venue ? ` · ${item.venue}` : ""}
                  </span>
                </span>
                {item.metadata_status === "failed" && (
                  <span className="shrink-0 text-xs text-red-700 dark:text-red-400">元数据失败</span>
                )}
                <span className="shrink-0 text-xs px-1.5 py-0.5 rounded border border-line dark:border-dline text-muted dark:text-dmuted">
                  {STATUS_LABEL[item.reading_status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
