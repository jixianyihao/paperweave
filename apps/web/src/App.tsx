const NAV = [
  { key: "all", label: "全部文献", icon: "📁" },
  { key: "unread", label: "待读", icon: "🏷" },
  { key: "starred", label: "收藏", icon: "⭐" },
  { key: "reading", label: "在读", icon: "📖" },
  { key: "read", label: "已读", icon: "✓" },
];

export default function App() {
  return (
    <div className="flex h-screen bg-paper text-ink font-serif">
      <nav className="w-56 shrink-0 bg-cream border-r border-line p-3 flex flex-col gap-1">
        <div className="text-lg font-bold mb-2">PaperWeave</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className="text-left px-2 py-1.5 rounded hover:bg-[#e8e4d8] text-sm"
          >
            {n.icon} <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="flex-1 p-4">
        <p className="text-sm text-[#8a8578]">文献列表将在阶段 2 实现</p>
      </main>
      <aside className="w-80 shrink-0 bg-cream border-l border-line p-4">
        <p className="text-sm text-[#8a8578]">AI 预览面板将在阶段 2 实现</p>
      </aside>
    </div>
  );
}
