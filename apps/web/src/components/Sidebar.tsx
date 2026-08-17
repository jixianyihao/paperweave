import { useLibraryStore, type LibraryFilter } from "../stores/libraryStore";

const STATUS_NAV: { filter: LibraryFilter; label: string; icon: string }[] = [
  { filter: { kind: "all" }, label: "全部文献", icon: "📁" },
  { filter: { kind: "status", status: "unread" }, label: "待读", icon: "🏷" },
  { filter: { kind: "status", status: "reading" }, label: "在读", icon: "📖" },
  { filter: { kind: "status", status: "read" }, label: "已读", icon: "✓" },
  { filter: { kind: "starred" }, label: "收藏", icon: "⭐" },
];

function sameFilter(a: LibraryFilter, b: LibraryFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface CollectionNode {
  id: string;
  name: string;
  item_count: number;
  depth: number;
}

/** 把扁平集合按 parent_id 展成深度优先的树序列表 */
export function buildCollectionTree(
  collections: { id: string; parent_id: string | null; name: string; item_count: number }[],
): CollectionNode[] {
  const byParent = new Map<string | null, typeof collections>();
  for (const c of collections) {
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }
  const out: CollectionNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ id: c.id, name: c.name, item_count: c.item_count, depth });
      visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export default function Sidebar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const collections = useLibraryStore((s) => s.collections);
  const tags = useLibraryStore((s) => s.tags);

  const tree = buildCollectionTree(collections);

  const btnCls = (active: boolean) =>
    `w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
      active
        ? "bg-navy text-paper dark:bg-dnavy dark:text-dpaper"
        : "hover:bg-hoverbg dark:hover:bg-dhover"
    }`;

  return (
    <nav aria-label="文献库导航" className="w-56 shrink-0 bg-cream dark:bg-dcream border-r border-line dark:border-dline p-3 flex flex-col gap-1 overflow-y-auto">
      <div className="text-lg font-bold mb-2 text-navy dark:text-dgold">PaperWeave</div>
      {STATUS_NAV.map((n) => (
        <button
          key={n.label}
          aria-current={sameFilter(filter, n.filter) ? "true" : undefined}
          className={btnCls(sameFilter(filter, n.filter))}
          onClick={() => setFilter(n.filter)}
        >
          {n.icon} <span>{n.label}</span>
        </button>
      ))}

      <div className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted dark:text-dmuted">集合</div>
      {tree.length === 0 && <p className="text-xs text-muted dark:text-dmuted px-2">暂无集合</p>}
      {tree.map((c) => (
        <button
          key={c.id}
          style={{ paddingLeft: `${0.5 + c.depth * 1}rem` }}
          aria-current={filter.kind === "collection" && filter.collectionId === c.id ? "true" : undefined}
          className={btnCls(filter.kind === "collection" && filter.collectionId === c.id)}
          onClick={() => setFilter({ kind: "collection", collectionId: c.id })}
        >
          <span>{c.name.trim()}</span>
          <span className="float-right text-xs text-muted dark:text-dmuted">{c.item_count}</span>
        </button>
      ))}

      <div className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted dark:text-dmuted">标签</div>
      {tags.length === 0 && <p className="text-xs text-muted dark:text-dmuted px-2">暂无标签</p>}
      <div className="flex flex-wrap gap-1 px-1">
        {tags.map((t) => {
          const active = filter.kind === "tag" && filter.tag === t.name;
          return (
            <button
              key={t.name}
              aria-current={active ? "true" : undefined}
              className={`text-xs px-2 py-0.5 rounded-full border border-line dark:border-dline ${
                active
                  ? "bg-gold text-paper dark:bg-dgold dark:text-dpaper"
                  : "hover:bg-hoverbg dark:hover:bg-dhover"
              }`}
              onClick={() => setFilter({ kind: "tag", tag: t.name })}
            >
              {t.name} ({t.item_count})
            </button>
          );
        })}
      </div>
    </nav>
  );
}
