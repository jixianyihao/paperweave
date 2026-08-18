import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import ImportDialog from "./ImportDialog";
import MockBadge from "./MockBadge";
import Toasts from "./Toasts";
import VoiceOrb from "./voice/VoiceOrb";
import { useGlobalImportDrop } from "../hooks/useGlobalImportDrop";
import { useUiStore } from "../stores/uiStore";

/** 路由根布局：全局 chrome（⌘K、拖拽导入、toast、对话框）挂载于此 */
export default function Root() {
  useGlobalImportDrop();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUiStore.getState().togglePalette();
      }
      if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.importOpen) ui.setImportOpen(false);
        else if (ui.paletteOpen) ui.setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Outlet />
      <CommandPalette />
      <ImportDialog />
      <Toasts />
      <MockBadge />
      <VoiceOrb />
    </>
  );
}
