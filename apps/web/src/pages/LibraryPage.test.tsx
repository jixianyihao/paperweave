import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { disableMockMode, enableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import LibraryPage from "./LibraryPage";
import { DEFAULT_FILTER, useLibraryStore } from "../stores/libraryStore";
import { useUiStore } from "../stores/uiStore";
import { useToastStore } from "../stores/toastStore";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <LibraryPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockData();
  enableMockMode();
  localStorage.removeItem("pw-theme");
  useLibraryStore.setState({
    filter: DEFAULT_FILTER,
    items: [],
    collections: [],
    tags: [],
    selectedId: null,
    loading: false,
    error: null,
  });
  useUiStore.setState({ paletteOpen: false, importOpen: false });
  useToastStore.getState().clear();
  return () => disableMockMode();
});

describe("LibraryPage 条目选中 + 预览面板", () => {
  test("加载并渲染条目列表", async () => {
    renderPage();
    expect(await screen.findByText("Attention Is All You Need")).toBeInTheDocument();
    expect(screen.getByText("Language Models are Few-Shot Learners")).toBeInTheDocument();
  });

  test("点击条目 → 右侧预览面板显示元数据与摘要", async () => {
    renderPage();
    const title = await screen.findByText("Attention Is All You Need");
    expect(screen.getByLabelText("AI 预览面板")).toHaveTextContent("选中左侧条目查看详情");
    fireEvent.click(title);
    const panel = screen.getByLabelText("AI 预览面板");
    await waitFor(() => expect(panel).toHaveTextContent("Ashish Vaswani"));
    expect(panel).toHaveTextContent("NeurIPS");
    expect(panel).toHaveTextContent("Transformer");
    expect(panel).toHaveTextContent("AI 摘要");
  });

  test("metadata_status=failed 的条目显示「重试元数据」，点击后调用重试", async () => {
    renderPage();
    // fail0004 无 doi/arxiv → 重试会 400，应出现错误 toast 而不是崩溃
    const title = await screen.findByText("Untitled (元数据抓取失败)");
    fireEvent.click(title);
    const panel = screen.getByLabelText("AI 预览面板");
    const retryBtn = await screen.findByRole("button", { name: "重试元数据" });
    expect(panel).toHaveTextContent("元数据抓取失败");
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error")).toBe(true),
    );
  });

  test("方向键移动选中，listbox aria-activedescendant 跟随", async () => {
    renderPage();
    await screen.findByText("Attention Is All You Need");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const firstId = useLibraryStore.getState().selectedId;
    expect(firstId).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useLibraryStore.getState().selectedId).not.toBe(firstId);
    const listbox = screen.getByRole("listbox", { name: "文献" });
    expect(listbox).toHaveAttribute("aria-activedescendant", useLibraryStore.getState().selectedId);
  });
});
