/** 设置面板：外观与阅读操作。无存档槽位。 */
import { FONT_LABEL, useReaderPrefs, type FontSize } from './theme/readerPrefs';
import { ThemeSwitch } from './theme/ThemeSwitch';

interface Props {
  canRewind?: boolean;
  onRewind?: () => void;
  onRestart?: () => void;
  onBack?: () => void;
  /** 标题页只显示外观，阅读页再给出回退/重开 */
  showReadingActions?: boolean;
}

const FONT_OPTS: FontSize[] = ['sm', 'md', 'lg'];

export function SettingsPanel(p: Props) {
  const fontSize = useReaderPrefs((s) => s.fontSize);
  const setFontSize = useReaderPrefs((s) => s.setFontSize);
  const showReading = p.showReadingActions !== false && (p.onRewind || p.onRestart || p.onBack);

  return (
    <div className="panel-inner">
      <h4>外观</h4>
      <ThemeSwitch />

      <div className="section-gap">
        <h4>字号</h4>
        <div className="theme-switch" role="radiogroup" aria-label="字号">
          {FONT_OPTS.map((id) => (
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
      </div>

      {showReading && (
        <div className="section-gap">
          <h4>操作</h4>
          <div className="settings-actions">
            {p.onRewind && (
              <button type="button" className="ghost" disabled={!p.canRewind} onClick={p.onRewind}>
                回退一页
              </button>
            )}
            {p.onRestart && (
              <button type="button" className="ghost" onClick={p.onRestart}>
                从头阅读
              </button>
            )}
          </div>
          {p.onBack && (
            <button type="button" className="ghost settings-back" onClick={p.onBack}>
              返回标题
            </button>
          )}
        </div>
      )}
    </div>
  );
}
