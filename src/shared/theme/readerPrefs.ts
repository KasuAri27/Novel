/**
 * 阅读字号偏好，与主题一样只影响 UI。
 */
import { create } from 'zustand';

export type FontSize = 'sm' | 'md' | 'lg';

const STORAGE_KEY = 'reader-font-size';

const FONT_PX: Record<FontSize, string> = {
  sm: '16px',
  md: '18px',
  lg: '20px',
};

export const FONT_LABEL: Record<FontSize, string> = {
  sm: '小',
  md: '中',
  lg: '大',
};

function readStoredSize(): FontSize {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'sm' || v === 'md' || v === 'lg') return v;
  } catch {
    /* ignore */
  }
  return 'md';
}

export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty('--reader-font', FONT_PX[size]);
  document.documentElement.setAttribute('data-font', size);
}

interface PrefsStore {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  cycleFontSize: () => void;
}

const ORDER: FontSize[] = ['sm', 'md', 'lg'];

export const useReaderPrefs = create<PrefsStore>((set, get) => {
  const fontSize = typeof window === 'undefined' ? 'md' : readStoredSize();
  return {
    fontSize,
    setFontSize: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      applyFontSize(next);
      set({ fontSize: next });
    },
    cycleFontSize: () => {
      const cur = get().fontSize;
      const i = ORDER.indexOf(cur);
      get().setFontSize(ORDER[(i + 1) % ORDER.length]);
    },
  };
});

export function initReaderPrefs() {
  applyFontSize(useReaderPrefs.getState().fontSize);
}
