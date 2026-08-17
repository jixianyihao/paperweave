import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { disableMockMode, enableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import CommandPalette from "./CommandPalette";
import { useThemeStore } from "../stores/themeStore";
import { useUiStore } from "../stores/uiStore";
import { useLibraryStore, DEFAULT_FILTER } from "../stores/libraryStore";

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockData();
  enableMockMode();
  localStorage.removeItem("pw-theme");
  document.documentElement.classList.remove("dark");
  useUiStore.setState({ paletteOpen: false, importOpen: false });
  useLibraryStore.setState({ filter: DEFAULT_FILTER, items: [], selectedId: null });
  return () => disableMockMode();
});

describe("⌘K 命令面板", () => {
  test("关闭时不渲染；打开后显示命令列表", () => {
    renderPalette();
    expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();
    act(() => useUiStore.getState().setPaletteOpen(true));
    expect(screen.getByRole("dialog", { name: "命令面板" })).toBeInTheDocument();
    expect(screen.getByText("导入文献")).toBeInTheDocument();
    expect(screen.getByText("切换主题")).toBeInTheDocument();
    expect(screen.getByText("跳转到待读")).toBeInTheDocument();
  });

  test("输入关键词后展示搜索结果", async () => {
    useUiStore.getState().setPaletteOpen(true);
    renderPalette();
    fireEvent.change(screen.getByLabelText("命令面板输入"), { target: { value: "attention" } });
    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument());
  });

  test("「切换主题」命令切换暗色并持久化", async () => {
    useUiStore.getState().setPaletteOpen(true);
    renderPalette();
    const before = useThemeStore.getState().theme;
    fireEvent.click(screen.getByText("切换主题"));
    expect(useThemeStore.getState().theme).not.toBe(before);
    expect(localStorage.getItem("pw-theme")).toBe(useThemeStore.getState().theme);
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  test("「跳转到待读」设置 unread 筛选", () => {
    useUiStore.getState().setPaletteOpen(true);
    renderPalette();
    fireEvent.click(screen.getByText("跳转到待读"));
    expect(useLibraryStore.getState().filter).toEqual({ kind: "status", status: "unread" });
  });

  test("Escape 关闭面板", () => {
    useUiStore.getState().setPaletteOpen(true);
    renderPalette();
    fireEvent.keyDown(screen.getByLabelText("命令面板输入"), { key: "Escape" });
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  test("命令按关键词过滤", () => {
    useUiStore.getState().setPaletteOpen(true);
    renderPalette();
    fireEvent.change(screen.getByLabelText("命令面板输入"), { target: { value: "主题" } });
    expect(screen.getByText("切换主题")).toBeInTheDocument();
    expect(screen.queryByText("导入文献")).not.toBeInTheDocument();
  });
});
