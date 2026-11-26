/** 标题页：闭书封面为进入阅读的主点击区；点开后翻开并镜头推进。 */
import { useEffect, useRef, useState } from 'react';
import { getStory } from '../../content/registry';
import { selectSegment, useEngineStore } from './useEngineStore';
import { ImportDebugPanel } from '../../shared/ImportDebugPanel';
import { chapterLabel, chapterTitle, excerptFrom } from './progress';
import { StoryLine } from './reader/StoryLine';
import { SettingsPanel } from '../../shared/SettingsPanel';
import type { Choice, Line } from '../../core/engine/types';

type Phase = 'idle' | 'flip' | 'push';

const FLIP_MS = 400;
const PUSH_MS = 700;

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function TitleScreen() {
  const errors = useEngineStore((s) => s.compileErrors);
  const peekAutosave = useEngineStore((s) => s.peekAutosave);
  const defaultStoryId = useEngineStore((s) => s.defaultStoryId);
  const bootNewGame = useEngineStore((s) => s.bootNewGame);
  const bootContinue = useEngineStore((s) => s.bootContinue);
  const enterPlay = useEngineStore((s) => s.enterPlay);

  const save = peekAutosave();
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmNew, setConfirmNew] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const timers = useRef<number[]>([]);

  const seg = useEngineStore(selectSegment);
  const landing = useEngineStore((s) => s.landing);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const storyId = defaultStoryId();
  const fallback = storyId ? getStory(storyId) : null;
  const storyTitle = fallback?.meta.title ?? save?.storyTitle ?? '互动小说';
  const coverChapter = save?.chapterLabel ?? (fallback ? chapterLabel(fallback.entry) : storyTitle);
  const coverExcerpt =
    save?.excerpt ?? (fallback ? excerptFrom(fallback, fallback.entry) : '点右侧书本进入阅读');
  const coverPercent = save?.percent;

  // 翻书动画里的预览页：尽量与进入阅读后的第一眼一致（续读时从上次那一页的首行起）
  let openHeading: string | null = null;
  let openPreviewLines: Line[] = [];
  let openPreviewChoices: Choice[] = [];
  if (seg) {
    const a = landing.anchor;
    const from = a === 'start' ? 0 : a === 'end' ? Math.max(0, seg.lines.length - 3) : a.line;
    openHeading = from === 0 ? seg.heading : null;
    openPreviewLines = seg.lines.slice(from, from + 3);
    if (a === 'end' && seg.hasChoices) openPreviewChoices = seg.choices;
  } else if (fallback) {
    openHeading = chapterTitle(0);
    openPreviewLines = fallback.nodes[fallback.entry]?.lines ?? [];
  }
  const openChapter = seg ? chapterTitle(seg.chapter) : coverChapter;

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  const finish = () => {
    clearTimers();
    enterPlay();
  };

  const playEnter = () => {
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setPhase('flip');
    timers.current.push(window.setTimeout(() => setPhase('push'), FLIP_MS));
    timers.current.push(window.setTimeout(finish, FLIP_MS + PUSH_MS));
  };

  const onContinue = () => {
    if (phase !== 'idle') {
      finish();
      return;
    }
    if (!bootContinue()) return;
    playEnter();
  };

  const startNew = () => {
    const id = storyId;
    if (!id) return;
    if (!bootNewGame(id)) return;
    setConfirmNew(false);
    playEnter();
  };

  const onNewGame = () => {
    if (phase !== 'idle') {
      finish();
      return;
    }
    if (save) {
      setConfirmNew(true);
      return;
    }
    startNew();
  };

  const onBook = () => {
    if (phase !== 'idle') {
      finish();
      return;
    }
    if (save) onContinue();
    else onNewGame();
  };

  const busy = phase !== 'idle';

  return (
    <div className="title-screen" data-phase={phase} onClick={busy ? finish : undefined}>
      <div className="title-glow" aria-hidden />

      <div className="title-copy">
        <p className="title-kicker">互动小说</p>
        <h1>{storyTitle}</h1>
        <p className="sub">{save ? '点右侧书本进入阅读' : '文本优先的互动小说播放器'}</p>

        <div className="title-actions">
          {save && (
            <button type="button" className="title-btn title-btn-primary" onClick={onContinue}>
              继续阅读
            </button>
          )}
          <button type="button" className="title-btn" onClick={onNewGame}>
            开始新游戏
          </button>
          <button type="button" className="title-btn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
          <button type="button" className="title-btn" onClick={() => (window.location.hash = 'chat')}>
            聊天模式
          </button>
        </div>

        <ImportDebugPanel errors={errors} />
      </div>

      <div
        role="button"
        tabIndex={0}
        className="title-book"
        onClick={(e) => {
          e.stopPropagation();
          onBook();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onBook();
          }
        }}
        aria-label="翻开书本进入阅读"
      >
        <div className="title-book-open" aria-hidden={phase === 'idle'}>
          <div className="book-spread title-spread">
            <div className="leaf leaf-left">
              <div className="leaf-head">{openChapter}</div>
              {openHeading && <h2 className="flow-heading">{openHeading}</h2>}
              {openPreviewLines.slice(0, 3).map((ln, i) => (
                <StoryLine key={i} line={ln} />
              ))}
            </div>
            <div className="book-gutter" />
            <div className="leaf leaf-right">
              {openPreviewChoices.length > 0 && (
                <article className="choices-pane">
                  <h2 className="choices-kicker">选择</h2>
                  <div className="choices">
                    {openPreviewChoices.slice(0, 3).map((c, i) => (
                      <div key={c.id} className="choice-card">
                        <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                        <span className="choice-label">{c.label}</span>
                      </div>
                    ))}
                  </div>
                </article>
              )}
            </div>
          </div>
        </div>
        <div className="title-book-cover">
          <div className="title-cover-spine" />
          <div className="title-cover-body">
            <p className="title-cover-chapter">{coverChapter}</p>
            {coverPercent != null ? (
              <p className="title-cover-progress">上次读到 {coverPercent}%</p>
            ) : (
              <p className="title-cover-excerpt">{coverExcerpt}</p>
            )}
            <p className="title-cover-hint">点击翻开 →</p>
          </div>
        </div>
      </div>

      {confirmNew && (
        <div className="settings-overlay" onClick={() => setConfirmNew(false)}>
          <div
            className="confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="newgame-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="newgame-title">开始新游戏？</h2>
            <p>
              将清除当前进度并从头开始。浏览器会自动保存你的阅读位置；之后的进度会覆盖这份存档。
            </p>
            <div className="confirm-actions">
              <button type="button" className="title-btn" onClick={() => setConfirmNew(false)}>
                取消
              </button>
              <button type="button" className="title-btn title-btn-danger" onClick={startNew}>
                开始新游戏
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-sheet-head">
              <h3 id="settings-title">设置</h3>
              <button type="button" className="settings-close" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </header>
            <SettingsPanel />
          </div>
        </div>
      )}
    </div>
  );
}
