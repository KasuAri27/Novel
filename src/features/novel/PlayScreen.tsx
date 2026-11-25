/**
 * 全屏阅读：顶栏 + 书页。PC 左右对开排正文，选项读完再出；窄屏单页。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  selectCurrentNode,
  selectHasChoices,
  selectParagraphs,
  selectPeekNext,
  selectPeekPrev,
  selectVisibleChoices,
  useEngineStore,
} from './useEngineStore';
import { chapterLabel, readingPercent } from './progress';
import { BookReader, type BookNav } from './reader/BookReader';
import { SettingsPanel } from '../../shared/SettingsPanel';
import { useReaderPrefs } from '../../shared/theme/readerPrefs';

type Panel = 'none' | 'settings' | 'toc' | 'menu' | 'log';

export function PlayScreen() {
  const story = useEngineStore((s) => s.story);
  const state = useEngineStore((s) => s.state);
  const node = useEngineStore(selectCurrentNode);
  const paragraphs = useEngineStore(selectParagraphs);
  const hasChoices = useEngineStore(selectHasChoices);
  const visibleChoices = useEngineStore(selectVisibleChoices);
  const peekNext = useEngineStore(selectPeekNext);
  const peekPrev = useEngineStore(selectPeekPrev);
  const enterFromTitle = useEngineStore((s) => s.enterFromTitle);

  const pick = useEngineStore((s) => s.pick);
  const turnPage = useEngineStore((s) => s.turnPage);
  const rewind = useEngineStore((s) => s.rewind);
  const restart = useEngineStore((s) => s.restart);
  const back = useEngineStore((s) => s.backToTitle);
  const cycleFont = useReaderPrefs((s) => s.cycleFontSize);

  const [panel, setPanel] = useState<Panel>('none');
  const [nav, setNav] = useState<BookNav>({ goPrev: () => {}, canGoPrev: false });
  const onNavChange = useCallback((next: BookNav) => setNav(next), []);

  useEffect(() => {
    if (!enterFromTitle) return;
    const t = window.setTimeout(() => {
      useEngineStore.setState({ enterFromTitle: false });
    }, 240);
    return () => window.clearTimeout(t);
  }, [enterFromTitle]);

  if (!story || !state || !node) return null;

  const chapter = chapterLabel(node.id);
  const percent = readingPercent(story, node.id);
  const pageNumber = state.history.length + 1;
  const canRewind = state.history.length > 0;

  const close = () => setPanel('none');

  return (
    <div className={`play-screen${enterFromTitle ? ' is-enter' : ''}`}>
      <header className="reader-topbar">
        <button type="button" className="topbar-btn" onClick={() => setPanel('toc')}>
          ← 目录
        </button>
        <h1 className="topbar-title">{chapter}</h1>
        <div className="topbar-tools">
          <button type="button" className="topbar-btn" aria-label="字号" onClick={cycleFont}>
            Aa
          </button>
          <button type="button" className="topbar-btn" aria-label="设置" onClick={() => setPanel('settings')}>
            ⚙
          </button>
          <button type="button" className="topbar-btn" aria-label="菜单" onClick={() => setPanel('menu')}>
            ☰
          </button>
        </div>
      </header>

      <BookReader
        chapterLabel={chapter}
        percent={percent}
        pageNumber={pageNumber}
        nodeId={node.id}
        paragraphs={paragraphs}
        choices={visibleChoices}
        hasChoices={hasChoices}
        canRewind={canRewind}
        peekNext={peekNext}
        peekPrev={peekPrev}
        peekGoto={(choiceId) => {
          const c = visibleChoices.find((x) => x.id === choiceId);
          const dest = c ? story.nodes[c.goto] : undefined;
          if (!dest) return { lines: [], choices: [], hasChoices: false };
          return { lines: dest.lines, choices: dest.choices, hasChoices: dest.choices.length > 0 };
        }}
        onEngineNext={turnPage}
        onEnginePrev={rewind}
        onPick={pick}
        onNavChange={onNavChange}
      />

      {panel === 'settings' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-sheet-head">
              <h3 id="settings-title">设置</h3>
              <button type="button" className="settings-close" onClick={close}>
                关闭
              </button>
            </header>
            <SettingsPanel
              canRewind={nav.canGoPrev}
              onRewind={() => {
                nav.goPrev();
                close();
              }}
              onRestart={() => {
                restart();
                close();
              }}
              onBack={() => {
                back();
              }}
            />
          </div>
        </div>
      )}

      {panel === 'menu' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div className="overflow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => setPanel('log')}>
              回顾
            </button>
            <button type="button" role="menuitem" onClick={() => setPanel('toc')}>
              目录
            </button>
            <button type="button" role="menuitem" onClick={() => setPanel('settings')}>
              设置
            </button>
            <button type="button" role="menuitem" onClick={back}>
              回到标题
            </button>
          </div>
        </div>
      )}

      {panel === 'toc' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div className="side-sheet" role="dialog" aria-labelledby="toc-title" onClick={(e) => e.stopPropagation()}>
            <header className="settings-sheet-head">
              <h3 id="toc-title">目录</h3>
              <button type="button" className="settings-close" onClick={close}>
                关闭
              </button>
            </header>
            <p className="toc-current">当前进度 · {chapter}</p>
            <p className="dim toc-note">进度已由浏览器自动保存。目录仅作浏览，不会跳过未读章节。</p>
            <button type="button" className="primary toc-back" onClick={close}>
              返回阅读
            </button>
          </div>
        </div>
      )}

      {panel === 'log' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div className="side-sheet side-sheet-wide" role="dialog" aria-labelledby="log-title" onClick={(e) => e.stopPropagation()}>
            <header className="settings-sheet-head">
              <h3 id="log-title">回顾</h3>
              <button type="button" className="settings-close" onClick={close}>
                关闭
              </button>
            </header>
            <Backlog />
          </div>
        </div>
      )}
    </div>
  );
}

/** 用历史快照拼一段最近正文，方便回看。 */
function Backlog() {
  const story = useEngineStore((s) => s.story);
  const state = useEngineStore((s) => s.state);
  if (!story || !state) return null;

  const snapshots = [...state.history, { ...state, history: undefined }];
  const recent = snapshots.slice(-12);

  return (
    <div className="backlog">
      {recent.map((snap, i) => {
        const n = story.nodes[snap.currentNodeId];
        if (!n) return null;
        return (
          <section key={`${snap.currentNodeId}-${i}`} className="backlog-node">
            {n.lines.slice(0, 4).map((ln, j) => (
              <p key={j} className={ln.speaker ? 'line-say' : 'line-narr'}>
                {ln.speaker && <span className="backlog-who">{ln.speaker}</span>}
                {ln.text}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}
