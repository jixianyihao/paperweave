import { useThemeStore } from "../../stores/themeStore";

/** 外观：主题切换（浅色期刊风 / 暗色），持久化 localStorage */
export default function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <section aria-label="外观设置" className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">外观</h2>
      <div role="radiogroup" aria-label="主题" className="flex gap-3">
        {(
          [
            { value: "light", label: "浅色（期刊风）", swatch: "bg-paper border-line" },
            { value: "dark", label: "暗色", swatch: "bg-dpaper border-dline" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={theme === opt.value}
            onClick={() => setTheme(opt.value)}
            className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
              theme === opt.value
                ? "border-navy dark:border-dnavy ring-1 ring-navy dark:ring-dnavy"
                : "border-line dark:border-dline hover:bg-hoverbg dark:hover:bg-dhover"
            }`}
          >
            <span className={`inline-block w-5 h-5 rounded border ${opt.swatch}`} aria-hidden />
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted dark:text-dmuted">设置保存在本地（localStorage），重启应用后保持。</p>
    </section>
  );
}
