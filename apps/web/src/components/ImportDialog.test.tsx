import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { disableMockMode, enableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import ImportDialog from "./ImportDialog";
import { useUiStore } from "../stores/uiStore";

beforeEach(() => {
  resetMockData();
  enableMockMode();
  useUiStore.setState({ paletteOpen: false, importOpen: true });
  return () => disableMockMode();
});

describe("导入对话框", () => {
  test("粘贴新 DOI → 显示导入结果（标题 + 已下载 PDF 徽标）", async () => {
    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText("标识符"), { target: { value: "10.1038/nature12373" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    const result = await screen.findByLabelText("导入结果");
    expect(result).toHaveTextContent("10.1038/nature12373");
    expect(result).toHaveTextContent("已下载 PDF");
    expect(result).not.toHaveTextContent("重复条目");
  });

  test("重复 DOI → 显示「重复条目」徽标", async () => {
    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText("标识符"), {
      target: { value: "10.48550/arXiv.2005.14165" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    const result = await screen.findByLabelText("导入结果");
    expect(result).toHaveTextContent("重复条目");
    expect(result).toHaveTextContent("Language Models are Few-Shot Learners");
  });

  test("空输入不可提交", () => {
    render(<ImportDialog />);
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
  });

  test("关闭按钮收起对话框", () => {
    render(<ImportDialog />);
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(useUiStore.getState().importOpen).toBe(false);
  });

  test("importOpen=false 时不渲染", () => {
    useUiStore.getState().setImportOpen(false);
    render(<ImportDialog />);
    expect(screen.queryByRole("dialog", { name: "导入文献" })).not.toBeInTheDocument();
  });
});
