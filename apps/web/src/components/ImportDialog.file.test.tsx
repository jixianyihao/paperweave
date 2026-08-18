import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImportDialog from "./ImportDialog";
import { useUiStore } from "../stores/uiStore";
import { importFile, importRis } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { Item } from "../api/types";

vi.mock("../api/endpoints", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/endpoints")>();
  return { ...orig, importFile: vi.fn(), importRis: vi.fn() };
});

const importFileMock = vi.mocked(importFile);
const importRisMock = vi.mocked(importRis);

function makeItem(title: string): Item {
  return {
    id: "it0001",
    title,
    creators: "[]",
    year: null,
    venue: null,
    doi: null,
    arxiv_id: null,
    url: null,
    abstract: null,
    file_path: "files/x.pdf",
    reading_status: "unread",
    starred: 0,
    metadata_status: "complete",
    date_added: "2026-08-18 10:00:00",
    date_modified: "2026-08-18 10:00:00",
  };
}

function switchToFileMode(): HTMLElement {
  fireEvent.click(screen.getByRole("tab", { name: "上传文件" }));
  return screen.getByLabelText("选择文件");
}

function pickFiles(input: HTMLElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ paletteOpen: false, importOpen: true });
});

describe("导入对话框 · 上传文件模式", () => {
  test("切换到「上传文件」页签：显示文件选择与拖拽区", () => {
    render(<ImportDialog />);
    const input = switchToFileMode();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".pdf,.ris,.bib,.bibtex,.txt");
    expect(screen.getByText(/拖拽文件到此处/)).toBeInTheDocument();
    // 标识符输入框不再显示
    expect(screen.queryByLabelText("标识符")).not.toBeInTheDocument();
  });

  test("PDF 上传调用 /api/import/file 并显示「成功」徽标与标题", async () => {
    importFileMock.mockResolvedValue({ item: makeItem("Attention Is All You Need"), metadata_status: "complete", duplicate: false });
    render(<ImportDialog />);
    const input = switchToFileMode();
    const pdf = new File(["%PDF-1.7"], "attention.pdf", { type: "application/pdf" });
    pickFiles(input, [pdf]);
    await waitFor(() => expect(importFileMock).toHaveBeenCalledTimes(1));
    expect(importFileMock.mock.calls[0][0].name).toBe("attention.pdf");
    expect(importRisMock).not.toHaveBeenCalled();
    const results = await screen.findByLabelText("文件导入结果");
    expect(results).toHaveTextContent("attention.pdf");
    expect(results).toHaveTextContent("Attention Is All You Need");
    expect(results).toHaveTextContent("成功");
  });

  test("多个 PDF 逐个上传", async () => {
    importFileMock.mockResolvedValue({ item: makeItem("Paper"), metadata_status: "complete", duplicate: false });
    render(<ImportDialog />);
    const input = switchToFileMode();
    pickFiles(input, [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ]);
    await waitFor(() => expect(importFileMock).toHaveBeenCalledTimes(2));
    const results = await screen.findByLabelText("文件导入结果");
    expect(results).toHaveTextContent("a.pdf");
    expect(results).toHaveTextContent("b.pdf");
  });

  test("RIS 上传读取文本并调用 /api/import/ris，显示导入条数", async () => {
    importRisMock.mockResolvedValue({ imported: 3, failed: 0 });
    render(<ImportDialog />);
    const input = switchToFileMode();
    const ris = new File(["TY  - JOUR\nTI  - Foo\nER  -"], "refs.ris", { type: "text/plain" });
    pickFiles(input, [ris]);
    await waitFor(() => expect(importRisMock).toHaveBeenCalledTimes(1));
    expect(importRisMock.mock.calls[0][0]).toContain("TY  - JOUR");
    expect(importFileMock).not.toHaveBeenCalled();
    const results = await screen.findByLabelText("文件导入结果");
    expect(results).toHaveTextContent("refs.ris");
    expect(results).toHaveTextContent("成功导入 3 条");
  });

  test(".bib 文件同样走 /api/import/ris", async () => {
    importRisMock.mockResolvedValue({ imported: 1, failed: 0 });
    render(<ImportDialog />);
    const input = switchToFileMode();
    pickFiles(input, [new File(["@article{x,title={Y}}"], "refs.bib", { type: "text/plain" })]);
    await waitFor(() => expect(importRisMock).toHaveBeenCalledTimes(1));
    expect(importFileMock).not.toHaveBeenCalled();
  });

  test("重复 PDF 显示「重复」徽标", async () => {
    importFileMock.mockResolvedValue({ item: makeItem("Existing Paper"), metadata_status: "complete", duplicate: true });
    render(<ImportDialog />);
    const input = switchToFileMode();
    pickFiles(input, [new File(["x"], "dup.pdf", { type: "application/pdf" })]);
    const results = await screen.findByLabelText("文件导入结果");
    await waitFor(() => expect(results).toHaveTextContent("重复"));
  });

  test("上传失败显示失败原因", async () => {
    importFileMock.mockRejectedValue(new ApiError(400, "only PDF uploads are supported"));
    render(<ImportDialog />);
    const input = switchToFileMode();
    pickFiles(input, [new File(["x"], "bad.pdf", { type: "application/pdf" })]);
    const results = await screen.findByLabelText("文件导入结果");
    await waitFor(() => expect(results).toHaveTextContent("失败"));
    expect(results).toHaveTextContent("only PDF uploads are supported");
  });

  test("拖拽 PDF 到放置区同样触发上传", async () => {
    importFileMock.mockResolvedValue({ item: makeItem("Dropped"), metadata_status: "complete", duplicate: false });
    render(<ImportDialog />);
    switchToFileMode();
    const zone = screen.getByText(/拖拽文件到此处/).closest("[aria-label]") ?? screen.getByLabelText("文件放置区");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "drop.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(importFileMock).toHaveBeenCalledTimes(1));
  });
});
