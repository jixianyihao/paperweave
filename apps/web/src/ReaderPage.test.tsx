import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { disableMockMode, enableMockMode } from "./api/client";
import { resetMockData } from "./api/mock";
import ReaderPage from "./ReaderPage";
import { lastMockBridge, resetMockBridges } from "./reader/__mocks__/bridge";

vi.mock("./reader/bridge", async () => await import("./reader/__mocks__/bridge"));

function renderReader(itemId: string) {
  return render(
    <MemoryRouter initialEntries={[`/read/${itemId}`]}>
      <Routes>
        <Route path="/read/:itemId" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SEL = {
  text: "self-attention mechanism",
  page: 2,
  rect: { x: 200, y: 300, width: 100, height: 20 },
  position: { page: 2, rects: [] },
};

beforeEach(() => {
  resetMockData();
  resetMockBridges();
  enableMockMode();
  return () => disableMockMode();
});

describe("ReaderPage 布局与加载", () => {
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

  test("右栏时间流加载既有标注（四种类型）", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(screen.getByText("高亮")).toBeInTheDocument());
    expect(screen.getByText("笔记")).toBeInTheDocument();
    expect(screen.getByText("摘要")).toBeInTheDocument();
    expect(screen.getByText("语音速览")).toBeInTheDocument();
    expect(screen.getByLabelText("全文问答输入")).toBeInTheDocument();
  });
});

describe("ReaderPage 桥接与浮动菜单", () => {
  test("iframe 挂载后 attach 桥；卸载时 dispose", async () => {
    const { unmount } = renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    expect(lastMockBridge()!.iframe.title).toBe("reader");
    unmount();
    expect(lastMockBridge()!.disposed).toBe(true);
  });

  test("选区事件 → 浮动菜单按 iframe 偏移定位显示", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(screen.getByTitle("reader")).toBeInTheDocument());
    const iframe = screen.getByTitle("reader");
    iframe.getBoundingClientRect = () =>
      ({ x: 100, y: 50, left: 100, top: 50, width: 800, height: 700, right: 900, bottom: 750, toJSON: () => ({}) }) as DOMRect;
    act(() => lastMockBridge()!.emitSelection(SEL));
    const menu = screen.getByRole("menu", { name: "选中操作" });
    // left = 100+200+50-160 = 190；top = 50+300-44-8 = 298（jsdom 视口 1024x768）
    expect(menu.style.left).toBe("190px");
    expect(menu.style.top).toBe("298px");
    act(() => lastMockBridge()!.emitSelectionCleared());
    expect(screen.queryByRole("menu", { name: "选中操作" })).not.toBeInTheDocument();
  });

  test("点「摘要」：SSE 流式结果显示为时间流新条目（落库后重拉）", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    act(() => lastMockBridge()!.emitSelection(SEL));
    fireEvent.click(screen.getByRole("menuitem", { name: "摘要" }));
    // 菜单关闭 + 选区清除
    expect(screen.queryByRole("menu", { name: "选中操作" })).not.toBeInTheDocument();
    expect(lastMockBridge()!.clearCalls).toBe(1);
    await waitFor(() =>
      expect(screen.getAllByTestId("timeline-entry").some((el) => el.textContent?.includes("mock 摘要"))).toBe(true),
    );
  });

  test("点「解释」→ 选难度档位 → 生成 ai_explain 条目", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    act(() => lastMockBridge()!.emitSelection(SEL));
    fireEvent.click(screen.getByRole("menuitem", { name: "解释" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /小白/ }));
    await waitFor(() =>
      expect(screen.getAllByTestId("timeline-entry").some((el) => el.textContent?.includes("mock 解释"))).toBe(true),
    );
  });

  test("点「笔记」→ 内联输入保存 → 时间流出现笔记条目", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    act(() => lastMockBridge()!.emitSelection(SEL));
    fireEvent.click(screen.getByRole("menuitem", { name: "笔记" }));
    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "我的批注" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    await waitFor(() => expect(screen.getByText("我的批注")).toBeInTheDocument());
  });

  test("点「追问」→ 创建 ai_qa 标注并默认展开对话线程", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    act(() => lastMockBridge()!.emitSelection(SEL));
    fireEvent.click(screen.getByRole("menuitem", { name: "追问" }));
    await waitFor(() => expect(screen.getByLabelText("追问输入")).toBeInTheDocument());
    expect(screen.getByText("问答")).toBeInTheDocument();
  });

  test("「↩ 跳回原文」调桥 jumpTo（无 position 按页）", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(screen.getByText("高亮")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /跳回原文/ })[0]);
    expect(lastMockBridge()!.jumpToCalls).toContainEqual({ page: 1 });
  });

  test("带 position 的条目跳回用 position 透传", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    act(() => lastMockBridge()!.emitSelection(SEL));
    fireEvent.click(screen.getByRole("menuitem", { name: "笔记" }));
    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    await waitFor(() => expect(screen.getByText("n")).toBeInTheDocument());
    const entryEl = screen.getByText("n").closest("[data-entry-id]")!;
    fireEvent.click(within(entryEl as HTMLElement).getByRole("button", { name: /跳回原文/ }));
    expect(lastMockBridge()!.jumpToCalls).toContainEqual({ position: SEL.position });
  });
});

describe("ReaderPage 全文问答", () => {
  test("底部提问 → 流式回答 + 引用锚点点击调 jumpTo", async () => {
    renderReader("attn0001");
    await waitFor(() => expect(lastMockBridge()).toBeTruthy());
    fireEvent.change(screen.getByLabelText("全文问答输入"), { target: { value: "核心是什么？" } });
    fireEvent.click(screen.getByRole("button", { name: "提问" }));
    await waitFor(() => expect(screen.getByText(/mock 问答/)).toBeInTheDocument());
    // 结构化引用 chips
    const chips = await screen.findAllByTitle(/Transformer/);
    expect(chips.length).toBeGreaterThan(0);
    fireEvent.click(chips[0]);
    expect(lastMockBridge()!.jumpToCalls.some((c) => typeof c.page === "number")).toBe(true);
  });
});
