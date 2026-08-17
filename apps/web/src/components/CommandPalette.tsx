import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchItems } from "../api/endpoints";
import type { Item } from "../api/types";
import { useLibraryStore } from "../stores/libraryStore";
import { useThemeStore } from "../stores/themeStore";
import { useUiStore } from "../stores/uiStore";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

type Entry = { kind: "command"; command: Command } | { kind: "item"; item: Item };

/** ⌘K 命令面板：命令 + 即时搜索（GET /api/search?q=） */
export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () => [
      { id: "import", label: "导入文献", hint: "DOI / arXiv / URL", run: () => setImportOpen(true) },
      { id: "theme", label: "切换主题", hint: "浅色 / 暗色", run: toggleTheme },
      { id: "unread", label: "跳转到待读", hint: "筛选待读列表", run: () => setFilter({ kind: "status", status: "unread" }) },
      { id: "settings", label: "打开设置", hint: "/settings", run: () => navigate("/settings") },
    ],
    [setImportOpen, toggleTheme, setFilter, navigate],
  );

  // 打开时重置并聚焦
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // 防抖搜索
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchItems(q)
        .then((res) => {
          if (!cancelled) {
            setResults(res.items);
            setActive(0);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const visibleCommands = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  const entries: Entry[] = [
    ...visibleCommands.map((command): Entry => ({ kind: "command", command })),
    ...results.map((item): Entry => ({ kind: "item", item })),
  ];

  const activate = (entry: Entry) => {
    setOpen(false);
    if (entry.kind === "command") {
      entry.command.run();
    } else {
      navigate(`/read/${entry.item.id}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[active];
      if (entry) activate(entry);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="命令面板"
      className="fixed inset-0 z-40 flex items-start justify-center pt-24 bg-black/30"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[34rem] max-w-[90vw] rounded-lg border border-line dark:border-dline bg-paper dark:bg-dpaper shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索文献或输入命令…"
          aria-label="命令面板输入"
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-line dark:border-dline outline-none"
        />
        <ul role="listbox" aria-label="命令与结果" className="max-h-80 overflow-y-auto py-1">
          {entries.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted dark:text-dmuted">无匹配结果</li>
          )}
          {entries.map((entry, idx) => {
            const isActive = idx === active;
            const cls = `w-full text-left px-4 py-2 text-sm flex items-baseline gap-2 ${
              isActive ? "bg-hoverbg dark:bg-dhover" : ""
            }`;
            if (entry.kind === "command") {
              return (
                <li key={`cmd-${entry.command.id}`} role="option" aria-selected={isActive}>
                  <button type="button" className={cls} onClick={() => activate(entry)} onMouseEnter={() => setActive(idx)}>
                    <span className="text-gold dark:text-dgold">⌘</span>
                    <span>{entry.command.label}</span>
                    <span className="ml-auto text-xs text-muted dark:text-dmuted">{entry.command.hint}</span>
                  </button>
                </li>
              );
            }
            return (
              <li key={`item-${entry.item.id}`} role="option" aria-selected={isActive}>
                <button type="button" className={cls} onClick={() => activate(entry)} onMouseEnter={() => setActive(idx)}>
                  <span className="truncate">{entry.item.title}</span>
                  <span className="ml-auto text-xs text-muted dark:text-dmuted">{entry.item.year ?? ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
