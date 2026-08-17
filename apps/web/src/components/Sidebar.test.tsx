import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { disableMockMode, enableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import Sidebar, { buildCollectionTree } from "./Sidebar";
import { DEFAULT_FILTER, useLibraryStore } from "../stores/libraryStore";

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

describe("Sidebar 导航筛选", () => {
  test("渲染五组状态导航、集合与标签", async () => {
    await useLibraryStore.getState().loadFacets();
    render(<Sidebar />);
    expect(screen.getByText("全部文献")).toBeInTheDocument();
    expect(screen.getByText("待读")).toBeInTheDocument();
    expect(screen.getByText("在读")).toBeInTheDocument();
    expect(screen.getByText("已读")).toBeInTheDocument();
    expect(screen.getByText("收藏")).toBeInTheDocument();
    expect(screen.getByText("预训练模型")).toBeInTheDocument();
    expect(screen.getByText(/nlp/)).toBeInTheDocument();
  });

  test("点击「待读」设置 status=unread 筛选并加载对应条目", async () => {
    render(<Sidebar />);
    screen.getByText("待读").click();
    expect(useLibraryStore.getState().filter).toEqual({ kind: "status", status: "unread" });
    await waitFor(() => expect(useLibraryStore.getState().items.length).toBeGreaterThan(0));
    expect(useLibraryStore.getState().items.every((i) => i.reading_status === "unread")).toBe(true);
  });

  test("点击标签筛选对应条目", async () => {
    await useLibraryStore.getState().loadFacets();
    render(<Sidebar />);
    screen.getByText(/nlp/).click();
    expect(useLibraryStore.getState().filter).toEqual({ kind: "tag", tag: "nlp" });
    await waitFor(() => expect(useLibraryStore.getState().items.length).toBe(3));
  });

  test("当前筛选项有 aria-current 高亮", () => {
    render(<Sidebar />);
    expect(screen.getByText("全部文献").closest("button")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("收藏").closest("button")).not.toHaveAttribute("aria-current");
  });
});

describe("buildCollectionTree", () => {
  test("按 parent_id 展开为深度优先序并带缩进深度", () => {
    const tree = buildCollectionTree([
      { id: "b", parent_id: "a", name: "child", item_count: 1 },
      { id: "a", parent_id: null, name: "root", item_count: 2 },
      { id: "c", parent_id: null, name: "root2", item_count: 0 },
    ]);
    expect(tree.map((n) => [n.name, n.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["root2", 0],
    ]);
  });
});
