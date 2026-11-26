/** 选项面板：读完一段后出现。卡片带字母，PC 上可按 A/B/C 或 1/2/3 直接选择。 */
import type { Choice } from '../../../core/engine/types';

export function choiceLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

export function ChoicesPane({
  choices,
  onPick,
  nudge = false,
  measure = false,
}: {
  choices: Choice[];
  onPick?: (id: string) => void;
  /** 读者想翻过选项页时轻轻闪一下，提示需要先做选择 */
  nudge?: boolean;
  /** 仅供测量高度：不可交互、不进无障碍树 */
  measure?: boolean;
}) {
  if (choices.length === 0) {
    return <div className="choices-pane choices-pane-empty" />;
  }
  return (
    <article
      className={`choices-pane${nudge ? ' is-nudged' : ''}`}
      aria-hidden={measure || undefined}
      aria-label={measure ? undefined : '选择'}
    >
      <h2 className="choices-kicker">选择</h2>
      <div className="choices">
        {choices.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="choice-card no-turn"
            tabIndex={measure ? -1 : undefined}
            aria-keyshortcuts={measure ? undefined : `${choiceLetter(i)} ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onPick?.(c.id);
            }}
          >
            <span className="choice-letter">{choiceLetter(i)}</span>
            <span className="choice-label">{c.label}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
