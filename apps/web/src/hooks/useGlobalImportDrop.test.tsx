import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { ApiError } from "../api/client";
import { useGlobalImportDrop } from "./useGlobalImportDrop";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";
import { importFile } from "../api/endpoints";

vi.mock("../api/endpoints", () => ({ importFile: vi.fn() }));
const importFileMock = vi.mocked(importFile);

function Harness() {
  useGlobalImportDrop();
  return null;
}

function makePdf(name = "paper.pdf"): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const okResult = {
  item: {
    id: "new00001",
    title: "Dropped Paper",
    creators: "[]",
    year: null,
    venue: null,
    doi: null,
    arxiv_id: null,
    url: null,
    abstract: null,
    file_path: "files/new00001.pdf",
    reading_status: "unread" as const,
    starred: 0 as const,
    metadata_status: "complete" as const,
    date_added: "2026-08-17 10:00:00",
    date_modified: "2026-08-17 10:00:00",
  },
  metadata_status: "complete" as const,
  duplicate: false,
};

let originalRefresh: () => Promise<void>;
const refreshSpy = vi.fn(async () => {});

beforeEach(() => {
  originalRefresh = useLibraryStore.getState().refresh;
  useLibraryStore.setState({ refresh: refreshSpy });
  useToastStore.getState().clear();
  importFileMock.mockReset();
  refreshSpy.mockClear();
});

afterEach(() => {
  useLibraryStore.setState({ refresh: originalRefresh });
});

describe("useGlobalImportDrop", () => {
  test("只接受 PDF：拖入 .txt 弹错误 toast，不上传", () => {
    render(<Harness />);
    const txt = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(window, { dataTransfer: { files: [txt], types: ["Files"] } });
    expect(importFileMock).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.some((t) => t.kind === "error" && t.message.includes("PDF"))).toBe(true);
  });

  test("PDF 上传成功：toast 汇报；refresh 在上传完成后才触发（竞态修复）", async () => {
    render(<Harness />);
    const d = deferred<typeof okResult>();
    importFileMock.mockReturnValue(d.promise);
    fireEvent.drop(window, { dataTransfer: { files: [makePdf()], types: ["Files"] } });
    // 上传未结束时 refresh 不得触发
    await waitFor(() => expect(importFileMock).toHaveBeenCalledTimes(1));
    expect(refreshSpy).not.toHaveBeenCalled();
    d.resolve(okResult);
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
    expect(
      useToastStore.getState().toasts.some((t) => t.kind === "success" && t.message.includes("Dropped Paper")),
    ).toBe(true);
  });

  test("上传失败：错误 toast，且 refresh 仍等全部上传结束后执行", async () => {
    render(<Harness />);
    const d1 = deferred<typeof okResult>();
    const d2 = deferred<typeof okResult>();
    importFileMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    fireEvent.drop(window, { dataTransfer: { files: [makePdf("a.pdf"), makePdf("b.pdf")], types: ["Files"] } });
    await waitFor(() => expect(importFileMock).toHaveBeenCalledTimes(2));
    d1.reject(new ApiError(400, "only PDF uploads are supported"));
    await new Promise((r) => setTimeout(r, 10));
    // 一个失败一个进行中：refresh 还没到时机
    expect(refreshSpy).not.toHaveBeenCalled();
    d2.resolve(okResult);
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
    expect(useToastStore.getState().toasts.some((t) => t.kind === "error")).toBe(true);
    expect(useToastStore.getState().toasts.some((t) => t.kind === "success")).toBe(true);
  });

  test("重复条目 toast 标记为重复", async () => {
    render(<Harness />);
    importFileMock.mockResolvedValue({ ...okResult, duplicate: true });
    fireEvent.drop(window, { dataTransfer: { files: [makePdf()], types: ["Files"] } });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.message.includes("重复条目"))).toBe(true),
    );
  });
});
