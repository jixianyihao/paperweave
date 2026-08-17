import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { disableMockMode, enableMockMode } from "./api/client";
import { resetMockData } from "./api/mock";
import ReaderPage from "./ReaderPage";

function renderReader(itemId: string) {
  return render(
    <MemoryRouter initialEntries={[`/read/${itemId}`]}>
      <Routes>
        <Route path="/read/:itemId" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockData();
  enableMockMode();
  return () => disableMockMode();
});

describe("ReaderPage", () => {
  test("有 PDF 的条目：iframe 指向 reader.html，file 参数指向条目 PDF", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(screen.getByTitle("reader")).toBeInTheDocument());
    const src = screen.getByTitle("reader").getAttribute("src") ?? "";
    expect(src).toContain("reader.html");
    // mock 模式下用样例 PDF 演示；非 mock 时指向 /api/items/:id/pdf
    expect(src).toContain(encodeURIComponent("/samples/sample.pdf"));
  });

  test("非 mock 模式下 file 指向 /api/items/:id/pdf", async () => {
    disableMockMode();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/items/attn0001") {
          return new Response(
            JSON.stringify({
              id: "attn0001",
              title: "Attention Is All You Need",
              creators: "[]",
              year: 2017,
              venue: null,
              doi: null,
              arxiv_id: null,
              url: null,
              abstract: null,
              file_path: "files/attn0001.pdf",
              reading_status: "read",
              starred: 1,
              metadata_status: "complete",
              date_added: "2026-08-10 10:00:00",
              date_modified: "2026-08-10 10:00:00",
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    renderReader("attn0001");
    await waitFor(() => expect(screen.getByTitle("reader")).toBeInTheDocument());
    const src = screen.getByTitle("reader").getAttribute("src") ?? "";
    expect(src).toContain(encodeURIComponent("/api/items/attn0001/pdf"));
    vi.unstubAllGlobals();
  });

  test("无 PDF 的条目：显示「仅元数据」占位", async () => {
    renderReader("meta0005");
    await waitFor(() => expect(screen.getByRole("note")).toBeInTheDocument());
    expect(screen.getByRole("note")).toHaveTextContent("仅元数据");
    expect(screen.queryByTitle("reader")).not.toBeInTheDocument();
  });

  test("不存在的条目：显示错误与返回链接", async () => {
    renderReader("nope0000");
    await waitFor(() => expect(screen.getByText(/item not found/i)).toBeInTheDocument());
    expect(screen.getByText("返回文献库")).toBeInTheDocument();
  });
});
