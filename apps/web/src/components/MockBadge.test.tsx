import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { disableMockMode, enableMockMode, isMockMode } from "../api/client";
import MockBadge from "./MockBadge";
import { useLibraryStore } from "../stores/libraryStore";

let originalRefresh: () => Promise<void>;
const refreshSpy = vi.fn(async () => {});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  disableMockMode();
  originalRefresh = useLibraryStore.getState().refresh;
  useLibraryStore.setState({ refresh: refreshSpy });
  refreshSpy.mockClear();
});

afterEach(() => {
  useLibraryStore.setState({ refresh: originalRefresh });
  disableMockMode();
  sessionStorage.clear();
});

describe("MockBadge mock 模式标识", () => {
  test("非 mock 模式不渲染", () => {
    render(<MockBadge />);
    expect(screen.queryByRole("button", { name: /mock/i })).not.toBeInTheDocument();
  });

  test("mock 模式显示标识；点击退出 mock 并刷新真实数据", () => {
    enableMockMode();
    render(<MockBadge />);
    const badge = screen.getByRole("button", { name: /mock/i });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);
    expect(isMockMode()).toBe(false);
    expect(sessionStorage.getItem("pw-mock")).toBeNull();
    expect(refreshSpy).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /mock/i })).not.toBeInTheDocument();
  });
});
