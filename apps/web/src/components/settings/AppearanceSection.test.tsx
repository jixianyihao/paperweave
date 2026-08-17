import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AppearanceSection from "./AppearanceSection";
import { useThemeStore } from "../../stores/themeStore";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  useThemeStore.getState().setTheme("light");
});

describe("外观设置：主题切换持久化", () => {
  test("点击「暗色」→ html.dark + localStorage", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByRole("radio", { name: /暗色/ }));
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("pw-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("radio", { name: /暗色/ })).toHaveAttribute("aria-checked", "true");
  });

  test("切回浅色后 dark class 移除", () => {
    useThemeStore.getState().setTheme("dark");
    render(<AppearanceSection />);
    fireEvent.click(screen.getByRole("radio", { name: /浅色/ }));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("pw-theme")).toBe("light");
  });
});
