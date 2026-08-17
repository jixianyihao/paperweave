import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { disableMockMode, enableMockMode } from "../api/client";
import { resetMockData } from "../api/mock";
import SettingsPage from "./SettingsPage";

function renderSettings(path = "/settings/ai") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockData();
  enableMockMode();
  return () => disableMockMode();
});

describe("设置页", () => {
  test("分组导航渲染五个分组", () => {
    renderSettings();
    const nav = screen.getByLabelText("设置分组");
    for (const label of ["通用", "AI 与模型", "外观", "存储", "快捷键"]) {
      expect(nav).toHaveTextContent(label);
    }
  });

  test("AI 与模型分组渲染服务商列表（来自 apiFetch）与任务路由", async () => {
    renderSettings("/settings/ai");
    const list = await screen.findByLabelText("服务商列表");
    await waitFor(() => expect(within(list).getByText("我的 Anthropic")).toBeInTheDocument());
    expect(within(list).getByText("我的 DeepSeek")).toBeInTheDocument();
    // 密钥只显示 has_key 状态，绝不显示 key 本体
    expect(screen.getByText(/已配置密钥/)).toBeInTheDocument();
    expect(screen.getByText(/未配置密钥/)).toBeInTheDocument();
    // 六个任务路由
    for (const label of ["翻译", "摘要", "讲解", "问答", "语音摘要", "向量嵌入"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 服务商操作按钮
    expect(screen.getAllByRole("button", { name: "测试连接" }).length).toBe(2);
  });

  test("外观分组渲染主题切换", () => {
    renderSettings("/settings/appearance");
    expect(screen.getByRole("radiogroup", { name: "主题" })).toBeInTheDocument();
  });

  test("未实现分组显示占位", () => {
    renderSettings("/settings/storage");
    expect(screen.getByText("该分组将在后续阶段实现。")).toBeInTheDocument();
  });
});
