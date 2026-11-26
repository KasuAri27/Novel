/**
 * 全屏阅读：书页铺满屏幕，菜单栏浮在顶部——点书页中间显示 / 隐藏，翻页后自动收起。
 * 菜单栏：返回 · 章节名 · Aa（阅读设置） · ☰（目录 / 回顾 / 回退 / 从头读 / 回到标题）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { selectSegment, toSheet, useEngineStore } from './useEngineStore';
import { chapterPercent } from './progress';
import { chapterOutline, locate, readLog, type ChapterEntry, type Segment } from './segment';
import { BookReader, type BookNav } from './reader/BookReader';
import { StoryLine } from './reader/StoryLine';
import type { Anchor } from './reader/paging';
import { SettingsPanel } from '../../shared/SettingsPanel';
import { selectLayoutKey, useReaderPrefs } from '../../shared/theme/readerPrefs';

type Panel =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'menu' }
  | { kind: 'toc' }
  | { kind: 'log' }
  | { kind: 'confirm-restart' }
  | { kind: 'confirm-jump'; chapter: ChapterEntry };

const NONE: Panel = { kind: 'none' };

function anchorLine(anchor: Anchor, seg: Segment): number {
  if (anchor === 'start') return 0;
  if (anchor === 'end') return Math.max(0, seg.lines.length - 1);
  return anchor.line;
}

export function PlayScreen() {
  const story = useEngineStore((s) => s.story);
  const state = useEngineStore((s) => s.state);
  const seg = useEngineStore(selectSegment);
  const seq = useEngineStore((s) => s.seq);
  const landing = useEngineStore((s) => s.landing);
  const position = useEngineStore((s) => s.position);
  const enterFromTitle = useEngineStore((s) => s.enterFromTitle);

  const pick = useEngineStore((s) => s.pick);
  const turnPage = useEngineStore((s) => s.turnPage);
  const rewind = useEngineStore((s) => s.rewind);
  const restart = useEngineStore((s) => s.restart);
  const jumpTo = useEngineStore((s) => s.jumpTo);
  const back = useEngineStore((s) => s.backToTitle);
  const setPosition = useEngineStore((s) => s.setPosition);
  const peekNextSheet = useEngineStore((s) => s.peekNextSheet);
  const peekPrevSheet = useEngineStore((s) => s.peekPrevSheet);
  const peekPickSheet = useEngineStore((s) => s.peekPickSheet);
  const layoutKey = useReaderPrefs(selectLayoutKey);

  const [panel, setPanel] = useState<Panel>(NONE);
  const [chrome, setChrome] = useState(true);
  const [nav, setNav] = useState<BookNav>({ goPrev: () => {}, canGoPrev: false, focus: () => {} });
  const onNavChange = useCallback((next: BookNav) => setNav(next), []);
  const toggleChrome = useCallback(() => setChrome((c) => !c), []);
  const hideChrome = useCallback(() => setChrome(false), []);

  const panelRef = useRef(panel);
  panelRef.current = panel;
  const navRef = useRef(nav);
  navRef.current = nav;

  const close = useCallback(() => {
    setPanel(NONE);
    window.setTimeout(() => navRef.current.focus(), 0);
  }, []);

  useEffect(() => {
    if (!enterFromTitle) return;
    const t = window.setTimeout(() => {
      useEngineStore.setState({ enterFromTitle: false });
    }, 240);
    return () => window.clearTimeout(t);
  }, [enterFromTitle]);

  // Esc：有面板先关面板，否则切换菜单栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panelRef.current.kind !== 'none') close();
      else setChrome((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const sheet = useMemo(() => (seg ? toSheet(seg, `${seq}:${seg.key}`) : null), [seg, seq]);

  if (!story || !state || !seg || !sheet) return null;

  const anchor: Anchor = landing.seq === seq ? landing.anchor : 'start';
  const pos = position && position.key === sheet.key ? position : null;
  const spot = locate(seg, pos ? pos.bottom : anchorLine(anchor, seg));
  const percent = spot.nodeId ? chapterPercent(story, spot.nodeId, spot.line) : 0;

  const open = (kind: 'settings' | 'menu' | 'toc' | 'log' | 'confirm-restart') => setPanel({ kind });

  return (
    <div className={`play-screen${chrome ? ' chrome-on' : ''}${enterFromTitle ? ' is-enter' : ''}`}>
      <header className="reader-topbar" aria-hidden={!chrome || undefined}>
        <button type="button" className="topbar-btn topbar-back" aria-label="返回标题页" onClick={back}>
          ‹ 返回
        </button>
        <h1 className="topbar-title">{sheet.chapter}</h1>
        <div className="topbar-tools">
          <button type="button" className="topbar-btn" aria-label="阅读设置" onClick={() => open('settings')}>
            Aa
          </button>
          <button type="button" className="topbar-btn" aria-label="菜单" onClick={() => open('menu')}>
            ☰
          </button>
        </div>
      </header>

      <BookReader
        sheet={sheet}
        landing={anchor}
        percent={percent}
        progressLabel={`本章 ${percent}%`}
        canRewind={seg.startIndex > 0}
        layoutKey={layoutKey}
        peekNext={peekNextSheet}
        peekPrev={peekPrevSheet}
        peekPick={peekPickSheet}
        onEngineNext={turnPage}
        onEnginePrev={rewind}
        onPick={pick}
        onPosition={setPosition}
        onToggleChrome={toggleChrome}
        onFlip={hideChrome}
        onNavChange={onNavChange}
      />

      {panel.kind === 'settings' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-sheet-head">
              <h3 id="settings-title">阅读设置</h3>
              <button type="button" className="settings-close" onClick={close}>
                完成
              </button>
            </header>
            <SettingsPanel />
          </div>
        </div>
      )}

      {panel.kind === 'menu' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div className="overflow-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => open('toc')}>
              目录
            </button>
            <button type="button" role="menuitem" onClick={() => open('log')}>
              回顾
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!nav.canGoPrev}
              onClick={() => {
                close();
                nav.goPrev();
              }}
            >
              回退一页
            </button>
            <button type="button" role="menuitem" onClick={() => open('confirm-restart')}>
              从头阅读
            </button>
            <button type="button" role="menuitem" onClick={back}>
              回到标题
            </button>
          </div>
        </div>
      )}

      {panel.kind === 'toc' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div className="side-sheet" role="dialog" aria-labelledby="toc-title" onClick={(e) => e.stopPropagation()}>
            <header className="settings-sheet-head">
              <h3 id="toc-title">目录</h3>
              <button type="button" className="settings-close" onClick={close}>
                关闭
              </button>
            </header>
            <ol className="toc-list">
              {chapterOutline(story, state).map((ch) => (
                <li key={ch.index}>
                  <button
                    type="button"
                    className={`toc-item is-${ch.status}`}
                    disabled={ch.status === 'unread'}
                    onClick={() => setPanel({ kind: 'confirm-jump', chapter: ch })}
                  >
                    <span className="toc-title">{ch.title}</span>
                    <span className="toc-status">
                      {ch.status === 'current' ? `正在读 · ${percent}%` : ch.status === 'read' ? '已读' : '未读'}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="toc-note">点已读的章节可以回到该章开头重读。进度自动保存在浏览器里。</p>
          </div>
        </div>
      )}

      {panel.kind === 'log' && (
        <div className="settings-overlay no-turn" onClick={close}>
          <div
            className="side-sheet side-sheet-wide"
            role="dialog"
            aria-labelledby="log-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-sheet-head">
              <h3 id="log-title">回顾</h3>
              <button type="button" className="settings-close" onClick={close}>
                关闭
              </button>
            </header>
            <Backlog upto={pos ? pos.bottom : anchorLine(anchor, seg)} />
          </div>
        </div>
      )}

      {panel.kind === 'confirm-restart' && (
        <ConfirmSheet
          title="从头阅读？"
          body="会回到第一章开头，当前进度和做过的选择都会被覆盖，无法恢复。"
          confirmLabel="从头阅读"
          onCancel={close}
          onConfirm={() => {
            restart();
            setChrome(false);
            close();
          }}
        />
      )}

      {panel.kind === 'confirm-jump' && (
        <ConfirmSheet
          title={`回到「${panel.chapter.title}」开头？`}
          body="这一章开头之后的阅读进度和做过的选择都会被覆盖，无法恢复。"
          confirmLabel="回到章首"
          onCancel={() => setPanel({ kind: 'toc' })}
          onConfirm={() => {
            if (panel.chapter.startIndex != null) jumpTo(panel.chapter.startIndex);
            setChrome(false);
            close();
          }}
        />
      )}
    </div>
  );
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="settings-overlay no-turn" onClick={onCancel}>
      <div
        className="confirm-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button type="button" className="title-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="title-btn title-btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 回顾：读过的正文（含章节标题与做过的选择），打开时停在最新处。 */
function Backlog({ upto }: { upto: number }) {
  const story = useEngineStore((s) => s.story);
  const state = useEngineStore((s) => s.state);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => (story && state ? readLog(story, state, upto) : []), [story, state, upto]);

  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.side-sheet');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [items]);

  return (
    <div className="backlog" ref={rootRef}>
      {items.map((it, i) => {
        if (it.kind === 'heading') {
          return (
            <h4 key={i} className="backlog-heading">
              {it.text}
            </h4>
          );
        }
        if (it.kind === 'choice') {
          return (
            <p key={i} className="backlog-choice">
              <span className="backlog-choice-tag">你选择了</span>
              {it.text}
            </p>
          );
        }
        return <StoryLine key={i} line={it.line} />;
      })}
    </div>
  );
}
