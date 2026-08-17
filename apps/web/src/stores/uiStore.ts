import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  importOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setImportOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  importOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setImportOpen: (open) => set({ importOpen: open }),
}));
