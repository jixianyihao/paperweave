// 文献库状态：导航筛选、条目列表、选中态、集合/标签
import { create } from "zustand";
import * as api from "../api/endpoints";
import type { Collection, Item, Tag } from "../api/types";

export type LibraryFilter =
  | { kind: "all" }
  | { kind: "status"; status: "unread" | "reading" | "read" }
  | { kind: "starred" }
  | { kind: "collection"; collectionId: string }
  | { kind: "tag"; tag: string };

export const DEFAULT_FILTER: LibraryFilter = { kind: "all" };

export function filterToParams(filter: LibraryFilter): api.ItemFilterParams {
  switch (filter.kind) {
    case "all":
      return {};
    case "status":
      return { status: filter.status };
    case "starred":
      return { starred: 1 };
    case "collection":
      return { collection: filter.collectionId };
    case "tag":
      return { tag: filter.tag };
  }
}

interface LibraryState {
  filter: LibraryFilter;
  items: Item[];
  collections: Collection[];
  tags: Tag[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  setFilter: (filter: LibraryFilter) => void;
  selectItem: (id: string | null) => void;
  /** delta=+1 下一条 / -1 上一条（⌘↑↓ 与方向键共用） */
  moveSelection: (delta: 1 | -1) => void;
  selectedItem: () => Item | undefined;
  loadItems: () => Promise<void>;
  loadFacets: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 导入/重试元数据后局部更新一条 */
  upsertItem: (item: Item) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  filter: DEFAULT_FILTER,
  items: [],
  collections: [],
  tags: [],
  selectedId: null,
  loading: false,
  error: null,

  setFilter: (filter) => {
    set({ filter, selectedId: null });
    void get().loadItems();
  },

  selectItem: (id) => set({ selectedId: id }),

  moveSelection: (delta) => {
    const { items, selectedId } = get();
    if (items.length === 0) return;
    const idx = items.findIndex((i) => i.id === selectedId);
    const next = idx === -1 ? (delta === 1 ? 0 : items.length - 1) : (idx + delta + items.length) % items.length;
    set({ selectedId: items[next].id });
  },

  selectedItem: () => {
    const { items, selectedId } = get();
    return items.find((i) => i.id === selectedId);
  },

  loadItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await api.listItems(filterToParams(get().filter));
      set({ items, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : "加载失败" });
    }
  },

  loadFacets: async () => {
    try {
      const [collections, tags] = await Promise.all([api.listCollections(), api.listTags()]);
      set({ collections, tags });
    } catch {
      /* 侧边栏数据失败不阻塞主流程 */
    }
  },

  refresh: async () => {
    await Promise.all([get().loadItems(), get().loadFacets()]);
  },

  upsertItem: (item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { items: [item, ...s.items] };
      const items = [...s.items];
      items[idx] = item;
      return { items };
    }),
}));
