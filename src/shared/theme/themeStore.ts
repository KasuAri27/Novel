/**
 * 阅读器外观：浅色 / 深色 / 跟随系统。仅影响 UI，与引擎状态无关。
 */
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'reader-theme-mode';

const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f5f0e5',
  dark: '#120f1c',
};

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
}

interface ThemeStore {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStore>((set) => {
  const mode = typeof window === 'undefined' ? 'system' : readStoredMode();
  const resolved = typeof window === 'undefined' ? 'light' : resolveTheme(mode);
  return {
    mode,
    resolved,
    setMode: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      const r = resolveTheme(next);
      applyResolvedTheme(r);
      set({ mode: next, resolved: r });
    },
  };
});

/** 启动时涂上主题，并在系统配色变化时同步「跟随系统」。 */
export function initTheme() {
  const sync = () => {
    const { mode } = useThemeStore.getState();
    const resolved = resolveTheme(mode);
    applyResolvedTheme(resolved);
    useThemeStore.setState({ resolved });
  };
  sync();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
}
