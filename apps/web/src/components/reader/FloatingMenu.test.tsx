import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FloatingMenu from "./FloatingMenu";

function renderMenu(overrides: Partial<Parameters<typeof FloatingMenu>[0]> = {}) {
  const props = {
    position: { left: 190, top: 298 },
    selectedText: "self-attention",
    onSummarize: vi.fn(),
    onExplain: vi.fn(),
    onTranslate: vi.fn(),
    onFollowUp: vi.fn(),
    onNote: vi.fn(),
    ...overrides,
  };
  render(<FloatingMenu {...props} />);
  return props;
}

describe("FloatingMenu 选中浮动菜单", () => {
  test("按 position 渲染五个操作：摘要/解释/翻译/追问/笔记", () => {
    renderMenu();
    const menu = screen.getByRole("menu", { name: "选中操作" });
    expect(menu.style.left).toBe("190px");
    expect(menu.style.top).toBe("298px");
    for (const name of ["摘要", "解释", "翻译", "追问", "笔记"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  test("点击摘要/翻译/追问直接回调", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "摘要" }));
    expect(props.onSummarize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译" }));
    expect(props.onTranslate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "追问" }));
    expect(props.onFollowUp).toHaveBeenCalledTimes(1);
  });

  test("解释展开四档难度（默认研究生），点击档位回调对应 level", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "解释" }));
    const grad = screen.getByRole("menuitem", { name: /研究生/ });
    expect(grad).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: /小白/ }));
    expect(props.onExplain).toHaveBeenCalledWith("eli5");
  });

  test("点击默认档（研究生）回调 grad", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "解释" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /研究生/ }));
    expect(props.onExplain).toHaveBeenCalledWith("grad");
  });

  test("笔记展开内联输入，保存回调文本", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "笔记" }));
    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "这里要讲 attention" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    expect(props.onNote).toHaveBeenCalledWith("这里要讲 attention");
  });
});
