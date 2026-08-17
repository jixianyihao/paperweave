import { Link, useParams } from "react-router-dom";
import AiModelsSection from "../components/settings/AiModelsSection";
import AppearanceSection from "../components/settings/AppearanceSection";

const SECTIONS = [
  { key: "general", label: "通用" },
  { key: "ai", label: "AI 与模型" },
  { key: "appearance", label: "外观" },
  { key: "storage", label: "存储" },
  { key: "shortcuts", label: "快捷键" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isSectionKey(v: string | undefined): v is SectionKey {
  return SECTIONS.some((s) => s.key === v);
}

/** 设置页骨架：/settings/:section?，本阶段实现「AI 与模型」与「外观」，其余为占位 */
export default function SettingsPage() {
  const params = useParams<{ section?: string }>();
  const section: SectionKey = isSectionKey(params.section) ? params.section : "ai";

  return (
    <div className="flex h-screen bg-paper dark:bg-dpaper text-ink dark:text-dink font-serif">
      <nav aria-label="设置分组" className="w-52 shrink-0 bg-cream dark:bg-dcream border-r border-line dark:border-dline p-3 flex flex-col gap-1">
        <Link to="/" className="text-sm text-navy dark:text-dnavy mb-2 hover:underline">
          ← 返回文献库
        </Link>
        <div className="text-lg font-bold mb-2">设置</div>
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={`/settings/${s.key}`}
            aria-current={section === s.key ? "page" : undefined}
            className={`px-2 py-1.5 rounded text-sm ${
              section === s.key
                ? "bg-navy text-paper dark:bg-dnavy dark:text-dpaper"
                : "hover:bg-hoverbg dark:hover:bg-dhover"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto p-6 max-w-3xl">
        {section === "ai" && <AiModelsSection />}
        {section === "appearance" && <AppearanceSection />}
        {(section === "general" || section === "storage" || section === "shortcuts") && (
          <p className="text-sm text-muted dark:text-dmuted">该分组将在后续阶段实现。</p>
        )}
      </main>
    </div>
  );
}
