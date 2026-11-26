/** 阅读设置：字号、行距、外观。只改排版偏好，不碰阅读进度。 */
import {
  FONT_LABEL,
  FONT_OPTIONS,
  SPACING_LABEL,
  SPACING_OPTIONS,
  useReaderPrefs,
} from './theme/readerPrefs';
import { ThemeSwitch } from './theme/ThemeSwitch';

export function SettingsPanel() {
  const fontSize = useReaderPrefs((s) => s.fontSize);
  const setFontSize = useReaderPrefs((s) => s.setFontSize);
  const lineSpacing = useReaderPrefs((s) => s.lineSpacing);
  const setLineSpacing = useReaderPrefs((s) => s.setLineSpacing);

  return (
    <div className="panel-inner">
      <h4>字号</h4>
      <div className="theme-switch" role="radiogroup" aria-label="字号">
        {FONT_OPTIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={fontSize === id}
            className={fontSize === id ? 'is-on' : undefined}
            onClick={() => setFontSize(id)}
          >
            {FONT_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="section-gap">
        <h4>行距</h4>
        <div className="theme-switch" role="radiogroup" aria-label="行距">
          {SPACING_OPTIONS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={lineSpacing === id}
              className={lineSpacing === id ? 'is-on' : undefined}
              onClick={() => setLineSpacing(id)}
            >
              {SPACING_LABEL[id]}
            </button>
          ))}
        </div>
      </div>

      <div className="section-gap">
        <h4>外观</h4>
        <ThemeSwitch />
      </div>
    </div>
  );
}
