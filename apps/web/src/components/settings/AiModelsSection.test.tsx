import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { disableMockMode, enableMockMode } from "../../api/client";
import { resetMockData } from "../../api/mock";
import AiModelsSection from "./AiModelsSection";
import { useToastStore } from "../../stores/toastStore";

beforeEach(() => {
  resetMockData();
  enableMockMode();
  useToastStore.getState().clear();
  return () => disableMockMode();
});

async function renderSection() {
  render(<AiModelsSection />);
  const list = await screen.findByLabelText("服务商列表");
  await waitFor(() => expect(within(list).getByText("我的 Anthropic")).toBeInTheDocument());
  return list;
}

function rowOf(list: HTMLElement, label: string): HTMLElement {
  const el = within(list).getByText(label);
  const li = el.closest("li");
  if (!li) throw new Error(`row not found: ${label}`);
  return li;
}

describe("AiModelsSection 交互", () => {
  test("添加表单校验：无显示名禁提交；custom 无 base_url 禁提交", async () => {
    await renderSection();
    const form = screen.getByLabelText("添加服务商");
    const submit = within(form).getByRole("button", { name: "添加服务商" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("显示名"), { target: { value: "本地 Ollama" } });
    expect(submit).toBeEnabled();
    // 切到 custom → 无 base_url 禁用
    fireEvent.change(within(form).getByLabelText("类型"), { target: { value: "custom" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Base URL"), { target: { value: "http://localhost:11434/v1" } });
    expect(submit).toBeEnabled();
  });

  test("添加服务商成功后出现在列表中，并提示成功 toast", async () => {
    const list = await renderSection();
    const form = screen.getByLabelText("添加服务商");
    fireEvent.change(within(form).getByLabelText("显示名"), { target: { value: "测试 OpenAI" } });
    fireEvent.change(within(form).getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.change(within(form).getByLabelText("模型列表"), { target: { value: "gpt-4o, gpt-4o-mini" } });
    fireEvent.click(within(form).getByRole("button", { name: "添加服务商" }));
    await waitFor(() => expect(within(list).getByText("测试 OpenAI")).toBeInTheDocument());
    expect(within(rowOf(list, "测试 OpenAI")).getByText(/已配置密钥/)).toBeInTheDocument();
    expect(within(rowOf(list, "测试 OpenAI")).getByText(/gpt-4o/)).toBeInTheDocument();
    expect(useToastStore.getState().toasts.some((t) => t.kind === "success")).toBe(true);
  });

  test("测试连接：有密钥成功 toast，无密钥失败 toast", async () => {
    const list = await renderSection();
    fireEvent.click(within(rowOf(list, "我的 Anthropic")).getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "success" && t.message.includes("连接正常"))).toBe(true),
    );
    fireEvent.click(within(rowOf(list, "我的 DeepSeek")).getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error" && t.message.includes("连接失败"))).toBe(true),
    );
  });

  test("删除服务商后从列表消失，任务路由回落为内置默认", async () => {
    const list = await renderSection();
    // 先把翻译路由到 DeepSeek，再删除它
    fireEvent.change(screen.getByLabelText("翻译服务商"), { target: { value: "prov0002" } });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.message.includes("翻译"))).toBe(true),
    );
    fireEvent.click(within(rowOf(list, "我的 DeepSeek")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(within(list).queryByText("我的 DeepSeek")).not.toBeInTheDocument());
    await waitFor(() =>
      expect((screen.getByLabelText("翻译服务商") as HTMLSelectElement).value).toBe(""),
    );
  });

  test("PATCH 任务路由：选择服务商后路由保存并持久显示", async () => {
    await renderSection();
    fireEvent.change(screen.getByLabelText("摘要服务商"), { target: { value: "prov0001" } });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.kind === "success" && t.message.includes("摘要"))).toBe(true),
    );
    expect((screen.getByLabelText("摘要服务商") as HTMLSelectElement).value).toBe("prov0001");
    // 模型下拉解锁，选择模型
    const modelSelect = screen.getByLabelText("摘要模型") as HTMLSelectElement;
    expect(modelSelect.disabled).toBe(false);
    fireEvent.change(modelSelect, { target: { value: "claude-sonnet-4-20250514" } });
    await waitFor(() => expect(modelSelect.value).toBe("claude-sonnet-4-20250514"));
  });

  test("停用/启用服务商", async () => {
    const list = await renderSection();
    fireEvent.click(within(rowOf(list, "我的 Anthropic")).getByRole("button", { name: "停用" }));
    await waitFor(() => expect(within(rowOf(list, "我的 Anthropic")).getByText("（已停用）")).toBeInTheDocument());
    fireEvent.click(within(rowOf(list, "我的 Anthropic")).getByRole("button", { name: "启用" }));
    await waitFor(() => expect(within(rowOf(list, "我的 Anthropic")).queryByText("（已停用）")).not.toBeInTheDocument());
  });
});
