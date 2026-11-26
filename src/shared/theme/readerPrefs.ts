/**
 * 阅读排版偏好（字号 / 行距），与主题一样只影响 UI，写在 <html> 的 CSS 变量上。
 */
import { create } from 'zustand';

export type FontSize = 'sm' | 'md' | 'lg' | 'xl';
export type LineSpacing = 'compact' | 'normal' | 'loose';

const FONT_KEY = 'reader-font-size';
const SPACING_KEY = 'reader-line-spacing';

const FONT_PX: Record<FontSize, string> = {
  sm: '16px',
  md: '18px',
  lg: '20px',
  xl: '22px',
};

export const FONT_LABEL: Record<FontSize, string> = {
  sm: '小',
  md: '中',
  lg: '大',
  xl: '特大',
};

export const FONT_OPTIONS: FontSize[] = ['sm', 'md', 'lg', 'xl'];

/** 行高 + 段间距（em）。「宽松」即改版前的排版。 */
const SPACING: Record<LineSpacing, { leading: string; gap: string }> = {
  compact: { leading: '1.7', gap: '0.45em' },
  normal: { leading: '1.85', gap: '0.7em' },
  loose: { leading: '2.05', gap: '1.15em' },
};

export const SPACING_LABEL: Record<LineSpacing, string> = {
  compact: '紧凑',
  normal: '标准',
  loose: '宽松',
};

export const SPACING_OPTIONS: LineSpacing[] = ['compact', 'normal', 'loose'];

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty('--reader-font', FONT_PX[size]);
  document.documentElement.setAttribute('data-font', size);
}

export function applyLineSpacing(spacing: LineSpacing) {
  const s = SPACING[spacing];
  document.documentElement.style.setProperty('--reader-leading', s.leading);
  document.documentElement.style.setProperty('--reader-para-gap', s.gap);
  document.documentElement.setAttribute('data-spacing', spacing);
}

interface PrefsStore {
  fontSize: FontSize;
  lineSpacing: LineSpacing;
  setFontSize: (size: FontSize) => void;
  setLineSpacing: (spacing: LineSpacing) => void;
}

export const useReaderPrefs = create<PrefsStore>((set) => {
  const browser = typeof window !== 'undefined';
  return {
    fontSize: browser ? readStored(FONT_KEY, FONT_OPTIONS, 'md') : 'md',
    lineSpacing: browser ? readStored(SPACING_KEY, SPACING_OPTIONS, 'normal') : 'normal',
    setFontSize: (next) => {
      store(FONT_KEY, next);
      applyFontSize(next);
      set({ fontSize: next });
    },
    setLineSpacing: (next) => {
      store(SPACING_KEY, next);
      applyLineSpacing(next);
      set({ lineSpacing: next });
    },
  };
});

/** 排版签名：任一偏好变化时阅读器据此重新分页。 */
export function selectLayoutKey(s: PrefsStore): string {
  return `${s.fontSize}|${s.lineSpacing}`;
}

export function initReaderPrefs() {
  const { fontSize, lineSpacing } = useReaderPrefs.getState();
  applyFontSize(fontSize);
  applyLineSpacing(lineSpacing);
}
