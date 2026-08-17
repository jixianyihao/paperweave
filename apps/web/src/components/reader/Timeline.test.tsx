import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Timeline, { type TimelineEntry } from "./Timeline";
import { ReaderBridgeContext } from "../../reader/bridgeContext";

function entry(partial: Partial<TimelineEntry> & Pick<TimelineEntry, "id" | "type">): TimelineEntry {
  return {
    page: null,
    content: "内容",
    created_at: "2026-08-10 12:00:00",
    sort_index: 0,
    ...partial,
  };
}

function renderTimeline(entries: TimelineEntry[], onJump = vi.fn()) {
  const utils = render(
    <ReaderBridgeContext.Provider value={{ jumpTo: vi.fn() }}>
      <Timeline entries={entries} onJump={onJump} />
    </ReaderBridgeContext.Provider>,
  );
  return { ...utils, onJump };
}

describe("Timeline 时间流", () => {
  test("按 page → sort_index → created_at 排序（props 乱序也稳定）", () => {
    renderTimeline([
      entry({ id: "c", type: "note", page: 5, content: "第五页笔记" }),
      entry({ id: "a", type: "highlight", page: 1, content: "第一页高亮" }),
      entry({ id: "b", type: "ai_summary", page: 1, sort_index: 1, content: "第一页摘要" }),
      entry({ id: "d", type: "voice_digest", page: 2, content: "第二页语音" }),
    ]);
    const texts = screen.getAllByTestId("timeline-entry").map((el) => el.textContent ?? "");
    expect(texts[0]).toContain("第一页高亮");
    expect(texts[1]).toContain("第一页摘要");
    expect(texts[2]).toContain("第二页语音");
    expect(texts[3]).toContain("第五页笔记");
  });

  test("四种条目类型渲染各自标签与区分样式（token class）", () => {
    renderTimeline([
      entry({ id: "h", type: "highlight", page: 1 }),
      entry({ id: "n", type: "note", page: 1 }),
      entry({ id: "s", type: "ai_summary", page: 1 }),
      entry({ id: "v", type: "voice_digest", page: 1 }),
    ]);
    expect(document.querySelector('[data-entry-id="h"]')!.className).toContain("border-gold");
    expect(document.querySelector('[data-entry-id="n"]')!.className).toContain("border-muted");
    expect(document.querySelector('[data-entry-id="s"]')!.className).toContain("border-navy");
    expect(document.querySelector('[data-entry-id="v"]')!.className).toContain("border-ink");
    expect(screen.getByText("高亮")).toBeInTheDocument();
    expect(screen.getByText("笔记")).toBeInTheDocument();
    expect(screen.getByText("摘要")).toBeInTheDocument();
    expect(screen.getByText("语音速览")).toBeInTheDocument();
  });

  test("每条显示 P{page} 标签；点击「↩ 跳回原文」回调 onJump", () => {
    const { onJump } = renderTimeline([entry({ id: "h", type: "highlight", page: 7 })]);
    expect(screen.getByText("P7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /跳回原文/ }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0][0]).toMatchObject({ id: "h", page: 7 });
  });

  test("无页码条目不显示跳回按钮", () => {
    renderTimeline([entry({ id: "q", type: "ai_qa", page: null })]);
    expect(screen.queryByRole("button", { name: /跳回原文/ })).not.toBeInTheDocument();
  });

  test("pending 条目显示流式进行指示；error 条目显示错误", () => {
    renderTimeline([
      entry({ id: "p", type: "ai_summary", page: 2, pending: true, content: "生成中片段" }),
      entry({ id: "e", type: "ai_explain", page: 2, error: "未配置模型，请在设置中添加服务商" }),
    ]);
    expect(document.querySelector('[data-entry-id="p"]')!).toHaveTextContent("生成中片段");
    expect(document.querySelector('[data-entry-id="p"]')!.querySelector("[data-streaming]")).not.toBeNull();
    expect(document.querySelector('[data-entry-id="e"]')!).toHaveTextContent("未配置模型");
  });

  test("ai_* 条目带追问展开入口（Thread）", () => {
    renderTimeline([entry({ id: "s", type: "ai_explain", page: 3 })]);
    expect(screen.getByRole("button", { name: /追问/ })).toBeInTheDocument();
  });

  test("ai_qa 条目渲染问题与回答", () => {
    renderTimeline([
      entry({ id: "q", type: "ai_qa", question: "核心贡献是什么？", content: "自注意力机制。", page: 1 }),
    ]);
    const el = document.querySelector('[data-entry-id="q"]')!;
    expect(el).toHaveTextContent("核心贡献是什么？");
    expect(el).toHaveTextContent("自注意力机制。");
  });

  test("assistant 内容中的 [P3] 标记渲染为可点击引用锚点 → jumpTo", () => {
    const jumpTo = vi.fn();
    render(
      <ReaderBridgeContext.Provider value={{ jumpTo }}>
        <Timeline
          entries={[entry({ id: "s", type: "ai_summary", page: 1, content: "机制见 [P3] 段落。" })]}
          onJump={vi.fn()}
        />
      </ReaderBridgeContext.Provider>,
    );
    const cite = screen.getByRole("button", { name: "P3" });
    fireEvent.click(cite);
    expect(jumpTo).toHaveBeenCalledWith({ page: 3 });
  });
});
