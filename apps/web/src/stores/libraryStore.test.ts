import { beforeEach, describe, expect, test } from "vitest";
import { enableMockMode, disableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import { DEFAULT_FILTER, filterToParams, useLibraryStore } from "./libraryStore";

beforeEach(() => {
  resetMockData();
  enableMockMode();
  useLibraryStore.setState({
    filter: DEFAULT_FILTER,
    items: [],
    collections: [],
    tags: [],
    selectedId: null,
    loading: false,
    error: null,
  });
  return () => disableMockMode();
});

describe("filterToParams", () => {
  test("各筛选映射到契约查询参数", () => {
    expect(filterToParams({ kind: "all" })).toEqual({});
    expect(filterToParams({ kind: "status", status: "unread" })).toEqual({ status: "unread" });
    expect(filterToParams({ kind: "starred" })).toEqual({ starred: 1 });
    expect(filterToParams({ kind: "collection", collectionId: "c1" })).toEqual({ collection: "c1" });
    expect(filterToParams({ kind: "tag", tag: "nlp" })).toEqual({ tag: "nlp" });
  });
});

describe("libraryStore", () => {
  test("loadItems 拉取全部条目（确定性排序 date_added DESC）", async () => {
    await useLibraryStore.getState().loadItems();
    const items = useLibraryStore.getState().items;
    expect(items.length).toBe(5);
    const dates = items.map((i) => i.date_added);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test("setFilter 触发按筛选加载并清空选中", async () => {
    const store = useLibraryStore.getState();
    await store.loadItems();
    store.selectItem(useLibraryStore.getState().items[0].id);
    store.setFilter({ kind: "status", status: "unread" });
    await new Promise((r) => setTimeout(r, 20));
    const s = useLibraryStore.getState();
    expect(s.selectedId).toBeNull();
    expect(s.items.every((i) => i.reading_status === "unread")).toBe(true);
  });

  test("moveSelection 循环移动选中", async () => {
    await useLibraryStore.getState().loadItems();
    const ids = useLibraryStore.getState().items.map((i) => i.id);
    useLibraryStore.getState().moveSelection(1);
    expect(useLibraryStore.getState().selectedId).toBe(ids[0]);
    useLibraryStore.getState().moveSelection(1);
    expect(useLibraryStore.getState().selectedId).toBe(ids[1]);
    useLibraryStore.getState().moveSelection(-1);
    useLibraryStore.getState().moveSelection(-1);
    expect(useLibraryStore.getState().selectedId).toBe(ids[ids.length - 1]);
  });

  test("upsertItem 局部更新已有条目", async () => {
    await useLibraryStore.getState().loadItems();
    const first = useLibraryStore.getState().items[0];
    useLibraryStore.getState().upsertItem({ ...first, title: "改过的标题" });
    expect(useLibraryStore.getState().items[0].title).toBe("改过的标题");
  });

  test("loadFacets 加载集合与标签", async () => {
    await useLibraryStore.getState().loadFacets();
    const s = useLibraryStore.getState();
    expect(s.collections.length).toBe(2);
    expect(s.tags.map((t) => t.name)).toContain("nlp");
  });
});
