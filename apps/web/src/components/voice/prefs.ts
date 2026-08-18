// 语音模式偏好：启用开关 + 消耗指示开关，localStorage 持久化
import { create } from "zustand";

const STORAGE_KEY = "pw-voice-prefs";

interface VoicePrefsValues {
  enabled: boolean;
  showUsage: boolean;
}

interface VoicePrefsState extends VoicePrefsValues {
  setEnabled: (v: boolean) => void;
  setShowUsage: (v: boolean) => void;
}

function readInitial(): VoicePrefsValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VoicePrefsValues>;
      return { enabled: parsed.enabled !== false, showUsage: parsed.showUsage !== false };
    }
  } catch {
    /* jsdom / 隐私模式下忽略 */
  }
  return { enabled: true, showUsage: true };
}

function persist(v: VoicePrefsValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const useVoicePrefs = create<VoicePrefsState>((set, get) => ({
  ...readInitial(),
  setEnabled: (enabled) => {
    set({ enabled });
    persist({ enabled, showUsage: get().showUsage });
  },
  setShowUsage: (showUsage) => {
    set({ showUsage });
    persist({ enabled: get().enabled, showUsage });
  },
}));
