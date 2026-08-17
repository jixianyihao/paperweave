import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AskBox from "./AskBox";

describe("AskBox 全文问答输入", () => {
  test("提交回调问题文本并清空输入", () => {
    const onAsk = vi.fn();
    render(<AskBox onAsk={onAsk} />);
    const input = screen.getByLabelText("全文问答输入");
    fireEvent.change(input, { target: { value: "  Transformer 的创新点？ " } });
    fireEvent.click(screen.getByRole("button", { name: "提问" }));
    expect(onAsk).toHaveBeenCalledWith("Transformer 的创新点？");
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("空问题不触发回调", () => {
    const onAsk = vi.fn();
    render(<AskBox onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "提问" }));
    expect(onAsk).not.toHaveBeenCalled();
  });

  test("disabled 时输入与按钮均禁用", () => {
    render(<AskBox onAsk={vi.fn()} disabled />);
    expect(screen.getByLabelText("全文问答输入")).toBeDisabled();
    expect(screen.getByRole("button", { name: "提问" })).toBeDisabled();
  });
});
