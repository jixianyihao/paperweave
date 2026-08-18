// 设置页「语音」分组：语音模式开关 + 消耗指示开关（localStorage 持久化）。
// 语音服务商/模型路由仍在「AI 与模型」分组的「语音摘要」任务里配置。
import { useVoicePrefs } from "../voice/prefs";

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded border border-line dark:border-dline p-3 cursor-pointer">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-navy dark:accent-dnavy"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted dark:text-dmuted">{description}</span>
      </span>
    </label>
  );
}

export default function VoiceSection() {
  const enabled = useVoicePrefs((s) => s.enabled);
  const showUsage = useVoicePrefs((s) => s.showUsage);
  const setEnabled = useVoicePrefs((s) => s.setEnabled);
  const setShowUsage = useVoicePrefs((s) => s.setShowUsage);

  return (
    <section aria-label="语音设置" className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">语音</h2>
      <Toggle
        label="启用语音模式"
        description="在任何页面按 ⌘⇧V 唤起/挂断右下角语音球，与当前打开的论文语音对话。"
        checked={enabled}
        onChange={setEnabled}
      />
      <Toggle
        label="显示消耗指示"
        description="会话期间显示计时，结束时提示本次时长（时长计入用量统计）。"
        checked={showUsage}
        onChange={setShowUsage}
      />
      <p className="text-xs text-muted dark:text-dmuted">
        语音服务商与模型在「AI 与模型」分组的「语音摘要」任务路由中配置；需要 OpenAI 兼容的 realtime 端点。
      </p>
    </section>
  );
}
