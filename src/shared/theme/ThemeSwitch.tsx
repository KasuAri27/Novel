/** 浅色 / 深色 / 跟随系统 三段开关。 */
import { useThemeStore, type ThemeMode } from './themeStore';

const OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '系统' },
];

export function ThemeSwitch() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div className="theme-switch" role="radiogroup" aria-label="外观">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={mode === opt.id}
          className={mode === opt.id ? 'is-on' : undefined}
          onClick={() => setMode(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
