import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useVoicePrefs } from "../voice/prefs";
import VoiceSection from "./VoiceSection";

const STORAGE_KEY = "pw-voice-prefs";

beforeEach(() => {
  localStorage.clear();
  useVoicePrefs.setState({ enabled: true, showUsage: true });
});

describe("VoiceSection 语音设置", () => {
  test("渲染启用开关与消耗指示开关（默认均开）", () => {
    render(<VoiceSection />);
    const enable = screen.getByLabelText("启用语音模式");
    const usage = screen.getByLabelText("显示消耗指示");
    expect(enable).toBeChecked();
    expect(usage).toBeChecked();
  });

  test("切换开关写入 store 并持久化 localStorage", () => {
    render(<VoiceSection />);
    fireEvent.click(screen.getByLabelText("启用语音模式"));
    expect(useVoicePrefs.getState().enabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ enabled: false, showUsage: true });
    fireEvent.click(screen.getByLabelText("显示消耗指示"));
    expect(useVoicePrefs.getState().showUsage).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ enabled: false, showUsage: false });
  });

  test("提示语音路由在 AI 与模型分组配置", () => {
    render(<VoiceSection />);
    expect(screen.getByText(/语音摘要/)).toBeInTheDocument();
  });
});
