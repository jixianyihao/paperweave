import { beforeEach, describe, expect, test } from "vitest";
import { applyTheme, useThemeStore } from "./themeStore";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("themeStore", () => {
  test("默认浅色", () => {
    expect(["light", "dark"]).toContain(useThemeStore.getState().theme);
  });

  test("toggle 切换主题、写入 localStorage、切换 html.dark class", () => {
    const initial = useThemeStore.getState().theme;
    useThemeStore.getState().toggleTheme();
    const next = useThemeStore.getState().theme;
    expect(next).not.toBe(initial);
    expect(localStorage.getItem("pw-theme")).toBe(next);
    expect(document.documentElement.classList.contains("dark")).toBe(next === "dark");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe(initial);
    expect(localStorage.getItem("pw-theme")).toBe(initial);
  });

  test("setTheme 持久化并可被 applyTheme 应用到 DOM", () => {
    useThemeStore.getState().setTheme("dark");
    expect(localStorage.getItem("pw-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
