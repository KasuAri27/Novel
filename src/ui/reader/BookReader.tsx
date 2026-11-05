/**
 * 仿真书本阅读器：PC 对开正文、窄屏单页；选项只在读完后出现。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Choice, Line } from '../../engine/types';
import { PageFace } from './PageFace';
import { lastVisualIndex, resolveTurn, spreadSlots, SPREAD_MIN_WIDTH, type FlipDir, type TurnPlan } from './paging';

export interface PeekNode {
  lines: Line[];
  choices: Choice[];
  hasChoices: boolean;
}

export type PeekNext = PeekNode | 'ending' | null;

export interface BookNav {
  goPrev: () => void;
  canGoPrev: boolean;
}

interface Props {
  chapterLabel: string;
  percent: number;
  pageNumber: number;
  nodeId: string;
  paragraphs: Line[];
  choices: Choice[];
  hasChoices: boolean;
  canRewind: boolean;
  peekNext: PeekNext;
  peekPrev: PeekNode | null;
  peekGoto: (choiceId: string) => PeekNode;
  onEngineNext: () => void;
  onEnginePrev: () => void;
  onPick: (choiceId: string) => void;
  onNavChange?: (nav: BookNav) => void;
}

type SheetContent =
  | {
      type: 'text';
      paragraphs: Line[];
      visualIndex: number | 'last';
      hasChoices: boolean;
      choices: Choice[];
    }
  | { type: 'ending' }
  | { type: 'blank' };

interface FlipState {
  phase: 'idle' | 'dragging' | 'animating';
  dir: FlipDir;
  progress: number;
  blocked: boolean;
  dest: SheetContent;
  plan: TurnPlan;
}

const IDLE: FlipState = {
  phase: 'idle',
  dir: 'next',
  progress: 0,
  blocked: false,
  dest: { type: 'blank' },
  plan: { kind: 'blocked' },
};

const TAP_SLOP = 14;
const COMPLETE_PROGRESS = 0.2;
const COMPLETE_VELOCITY = 0.42;

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function readPerSpread(): number {
  if (typeof window === 'undefined') return 1;
  return window.matchMedia(`(min-width: ${SPREAD_MIN_WIDTH}px)`).matches ? 2 : 1;
}

function animateProgress(from: number, to: number, onFrame: (p: number) => void, onDone: () => void): () => void {
  if (prefersReducedMotion() || from === to) {
    onFrame(to);
    onDone();
    return () => {};
  }
  const duration = 260 + Math.abs(to - from) * 240;
  const start = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - (1 - t) ** 3;
    onFrame(from + (to - from) * e);
    if (t < 1) raf = requestAnimationFrame(tick);
    else onDone();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

function choiceLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

function ChoicesPane({
  choices,
  onPick,
}: {
  choices: Choice[];
  onPick?: (id: string) => void;
}) {
  if (choices.length === 0) {
    return <div className="choices-pane choices-pane-empty" />;
  }
  return (
    <article className="choices-pane">
      <h2 className="choices-kicker">选择</h2>
      <div className="choices">
        {choices.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="choice-card no-turn"
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

function SpreadView({
  content,
  perSpread,
  pageNumber,
  textPageCount,
  onPick,
}: {
  content: SheetContent;
  perSpread: number;
  pageNumber?: number;
  textPageCount?: number;
  onPick?: (id: string) => void;
}) {
  const [localCount, setLocalCount] = useState(1);
  const count = Math.max(1, textPageCount ?? localCount);

  if (content.type === 'blank') {
    return (
      <div className="book-spread">
        <div className="leaf leaf-left">
          <div className="page-clip" />
        </div>
        <div className="book-gutter" aria-hidden />
        <div className="leaf leaf-right" />
      </div>
    );
  }
  if (content.type === 'ending') {
    return (
      <div className="book-spread">
        <div className="leaf leaf-left">
          <div className="page-clip page-leaf">
            <p className="dim">纸页在此用尽。</p>
            <p>故事将翻向结局。</p>
          </div>
        </div>
        <div className="book-gutter" aria-hidden />
        <div className="leaf leaf-right" />
      </div>
    );
  }

  const vis =
    content.visualIndex === 'last'
      ? lastVisualIndex(count, content.hasChoices, perSpread)
      : content.visualIndex;
  const slots = spreadSlots(vis, count, content.hasChoices, perSpread);
  const spreadClass = [
    'book-spread',
    slots.showChoices ? 'has-choices' : '',
    perSpread >= 2 ? 'is-spread' : 'is-single',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={spreadClass}>
      {textPageCount == null && (
        <div className="page-measure" aria-hidden>
          <div className="book-spread">
            <div className="leaf leaf-left">
              <PageFace paragraphs={content.paragraphs} pageIndex={0} onPageCount={setLocalCount} />
            </div>
            <div className="book-gutter" />
            <div className="leaf leaf-right" />
          </div>
        </div>
      )}
      <div className="leaf leaf-left">
        {pageNumber != null && <div className="leaf-pagenum">{pageNumber}</div>}
        <PageFace paragraphs={content.paragraphs} pageIndex={slots.left} />
      </div>
      <div className="book-gutter" aria-hidden />
      <div className="leaf leaf-right">
        {slots.showChoices ? (
          <ChoicesPane choices={content.choices} onPick={onPick} />
        ) : (
          <PageFace paragraphs={content.paragraphs} pageIndex={slots.right} />
        )}
      </div>
    </div>
  );
}

export function BookReader(p: Props) {
  const {
    chapterLabel,
    percent,
    pageNumber,
    nodeId,
    paragraphs,
    choices,
    hasChoices,
    canRewind,
    peekNext,
    peekPrev,
    peekGoto,
    onEngineNext,
    onEnginePrev,
    onPick,
    onNavChange,
  } = p;

  const shellRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const landLastRef = useRef(false);
  const skipResetRef = useRef(false);
  const flipRef = useRef<FlipState>(IDLE);
  const cancelAnim = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const hasChoicesRef = useRef(hasChoices);
  hasChoicesRef.current = hasChoices;

  const [perSpread, setPerSpread] = useState(readPerSpread);
  const perSpreadRef = useRef(perSpread);
  perSpreadRef.current = perSpread;
  const prevSpreadRef = useRef(perSpread);

  const [textPageCount, setTextPageCount] = useState(1);
  const [visualIndex, setVisualIndex] = useState(0);
  const [landLast, setLandLast] = useState(false);
  const [flip, setFlip] = useState<FlipState>(IDLE);
  const [hint, setHint] = useState(() => {
    try {
      return sessionStorage.getItem('reader-hint-seen') !== '1';
    } catch {
      return true;
    }
  });

  flipRef.current = flip;

  const handlePageCount = useCallback((n: number) => {
    setTextPageCount(n);
    if (landLastRef.current) {
      setVisualIndex(lastVisualIndex(n, hasChoicesRef.current, perSpreadRef.current));
      landLastRef.current = false;
      setLandLast(false);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SPREAD_MIN_WIDTH}px)`);
    const sync = () => setPerSpread(mq.matches ? 2 : 1);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    if (prevSpreadRef.current === perSpread) return;
    const from = prevSpreadRef.current;
    prevSpreadRef.current = perSpread;
    setVisualIndex((i) => {
      if (from === 1 && perSpread === 2) return Math.floor(i / 2);
      if (from === 2 && perSpread === 1) return i * 2;
      return i;
    });
  }, [perSpread]);

  useLayoutEffect(() => {
    cancelAnim.current?.();
    cancelAnim.current = null;
    busyRef.current = false;
    if (skipResetRef.current) {
      skipResetRef.current = false;
      return;
    }
    setVisualIndex(0);
    setTextPageCount(1);
    setLandLast(false);
    landLastRef.current = false;
    setFlip(IDLE);
  }, [nodeId]);

  useEffect(() => {
    readerRef.current?.focus();
  }, [nodeId]);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => {
      setHint(false);
      try {
        sessionStorage.setItem('reader-hint-seen', '1');
      } catch {
        /* ignore */
      }
    }, 3600);
    return () => window.clearTimeout(t);
  }, [hint]);

  const last = lastVisualIndex(textPageCount, hasChoices, perSpread);
  const idx = Math.min(visualIndex, last);

  const currentSheet = (): SheetContent => ({
    type: 'text',
    paragraphs,
    visualIndex: landLast ? 'last' : Math.max(0, idx),
    hasChoices,
    choices,
  });

  const buildDest = (plan: TurnPlan, pickId?: string): SheetContent => {
    if (plan.kind === 'blocked') return { type: 'blank' };
    if (plan.kind === 'local') {
      return {
        type: 'text',
        paragraphs,
        visualIndex: plan.nextIndex,
        hasChoices,
        choices,
      };
    }
    if (plan.kind === 'engine-next') {
      if (peekNext === 'ending' || peekNext === null) return { type: 'ending' };
      return {
        type: 'text',
        paragraphs: peekNext.lines,
        visualIndex: 0,
        hasChoices: peekNext.hasChoices,
        choices: peekNext.choices,
      };
    }
    if (plan.kind === 'engine-prev') {
      if (!peekPrev) return { type: 'blank' };
      return {
        type: 'text',
        paragraphs: peekPrev.lines,
        visualIndex: 'last',
        hasChoices: peekPrev.hasChoices,
        choices: peekPrev.choices,
      };
    }
    const next = peekGoto(pickId ?? plan.choiceId);
    return {
      type: 'text',
      paragraphs: next.lines,
      visualIndex: 0,
      hasChoices: next.hasChoices,
      choices: next.choices,
    };
  };

  const commitPlan = (plan: TurnPlan) => {
    cancelAnim.current = null;
    setFlip(IDLE);
    busyRef.current = false;
    if (plan.kind === 'local') {
      setVisualIndex(plan.nextIndex);
      return;
    }
    if (plan.kind === 'engine-next') {
      landLastRef.current = false;
      setLandLast(false);
      setVisualIndex(0);
      onEngineNext();
      return;
    }
    if (plan.kind === 'engine-prev') {
      skipResetRef.current = true;
      landLastRef.current = true;
      setLandLast(true);
      onEnginePrev();
      return;
    }
    if (plan.kind === 'engine-pick') {
      landLastRef.current = false;
      setLandLast(false);
      setVisualIndex(0);
      onPick(plan.choiceId);
    }
  };

  const playTo = (
    from: number,
    to: number,
    base: Omit<FlipState, 'phase' | 'progress'>,
    onEnd: () => void,
  ) => {
    cancelAnim.current?.();
    busyRef.current = true;
    setFlip({ ...base, phase: 'animating', progress: from });
    cancelAnim.current = animateProgress(
      from,
      to,
      (progress) => setFlip((s) => ({ ...s, progress })),
      () => {
        cancelAnim.current = null;
        onEnd();
      },
    );
  };

  const startFlip = (dir: FlipDir) => {
    if (busyRef.current || flipRef.current.phase !== 'idle') return;
    const plan = resolveTurn({
      dir,
      visualIndex: idx,
      textPageCount,
      hasChoices,
      canRewind,
      perSpread,
    });
    const dest = buildDest(plan);
    const blocked = plan.kind === 'blocked';
    const base = { dir, blocked, dest, plan };
    if (blocked) {
      playTo(0, 0.13, base, () => {
        playTo(0.13, 0, base, () => {
          setFlip(IDLE);
          busyRef.current = false;
        });
      });
      return;
    }
    playTo(0, 1, base, () => commitPlan(plan));
  };

  const startPick = (choiceId: string) => {
    if (busyRef.current) return;
    const plan: TurnPlan = { kind: 'engine-pick', choiceId };
    const dest = buildDest(plan, choiceId);
    const base = { dir: 'next' as const, blocked: false, dest, plan };
    playTo(0, 1, base, () => commitPlan(plan));
  };

  const ptr = useRef<{
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastT: number;
    dragging: boolean;
    dir: FlipDir;
  } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.no-turn')) return;
    if (busyRef.current || flipRef.current.phase === 'animating') return;
    ptr.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastT: e.timeStamp,
      dragging: false,
      dir: 'next',
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = ptr.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;

    if (!s.dragging) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        ptr.current = null;
        return;
      }
      const dir: FlipDir = dx < 0 ? 'next' : 'prev';
      s.dragging = true;
      s.dir = dir;
      shellRef.current?.setPointerCapture(e.pointerId);
      const plan = resolveTurn({
        dir,
        visualIndex: idx,
        textPageCount,
        hasChoices,
        canRewind,
        perSpread,
      });
      setHint(false);
      setFlip({
        phase: 'dragging',
        dir,
        progress: 0,
        blocked: plan.kind === 'blocked',
        dest: buildDest(plan),
        plan,
      });
    }

    const w = shellRef.current?.clientWidth || window.innerWidth;
    const raw = s.dir === 'next' ? s.x - e.clientX : e.clientX - s.x;
    const f = flipRef.current;
    const progress = f.blocked
      ? Math.min(0.16, Math.max(0, raw / w) * 0.4)
      : Math.min(1, Math.max(0, raw / (w * 0.88)));
    setFlip((st) => ({ ...st, progress }));
  };

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    const s = ptr.current;
    if (!s || s.id !== e.pointerId) return;
    ptr.current = null;
    const w = shellRef.current?.clientWidth || window.innerWidth;

    if (!s.dragging) {
      const ratio = e.clientX / w;
      if (ratio < 0.28) {
        startFlip('prev');
      } else if (perSpread === 1 || ratio > 0.72) {
        startFlip('next');
      }
      return;
    }

    const f = flipRef.current;
    const dt = Math.max(1, e.timeStamp - s.lastT);
    const vx = (e.clientX - s.lastX) / dt;
    const fast = f.dir === 'next' ? vx < -COMPLETE_VELOCITY : vx > COMPLETE_VELOCITY;
    const complete = !f.blocked && (f.progress >= COMPLETE_PROGRESS || fast);
    const base = { dir: f.dir, blocked: f.blocked, dest: f.dest, plan: f.plan };
    if (complete) playTo(f.progress, 1, base, () => commitPlan(f.plan));
    else
      playTo(f.progress, 0, base, () => {
        setFlip(IDLE);
        busyRef.current = false;
      });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      startFlip('next');
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
      e.preventDefault();
      startFlip('prev');
    }
  };

  const startFlipRef = useRef(startFlip);
  startFlipRef.current = startFlip;

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (busyRef.current) return;
      if (Math.abs(ev.deltaY) < 20 && Math.abs(ev.deltaX) < 20) return;
      ev.preventDefault();
      const goNext = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX > 0 : ev.deltaY > 0;
      startFlipRef.current(goNext ? 'next' : 'prev');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const canGoPrev = idx > 0 || canRewind;
  useEffect(() => {
    onNavChange?.({ goPrev: () => startFlipRef.current('prev'), canGoPrev });
  }, [canGoPrev, onNavChange]);

  const flipping = flip.phase !== 'idle' && flip.progress > 0.001;
  const pFold = flip.progress;
  const curlW = 10 + 42 * Math.sin(Math.min(1, pFold) * Math.PI);
  const foldStyle = {
    '--fold': `${(1 - pFold) * 100}%`,
    '--fold-inv': `${pFold * 100}%`,
  } as CSSProperties;

  return (
    <div className="reader" ref={readerRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${chapterLabel} 阅读器`}>
      <div
        className={`book-shell${flipping ? ' is-flipping' : ''}${flip.phase === 'dragging' ? ' is-grabbing' : ''}`}
        ref={shellRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div className="book-stack" style={foldStyle}>
          {flipping && (
            <div className="sheet sheet-under">
              <SpreadView content={flip.dest} perSpread={perSpread} />
            </div>
          )}

          <div
            className={`sheet sheet-current sheet-fold-${flip.dir}`}
            style={{
              clipPath: flipping
                ? flip.dir === 'next'
                  ? `inset(0 ${pFold * 100}% 0 0)`
                  : `inset(0 0 0 ${pFold * 100}%)`
                : undefined,
            }}
          >
            <div className="page-measure" aria-hidden>
              <div className="book-spread">
                <div className="leaf leaf-left">
                  <PageFace key={`m:${nodeId}`} paragraphs={paragraphs} pageIndex={0} onPageCount={handlePageCount} />
                </div>
                <div className="book-gutter" />
                <div className="leaf leaf-right" />
              </div>
            </div>
            <SpreadView
              key={`v:${nodeId}`}
              content={currentSheet()}
              perSpread={perSpread}
              pageNumber={pageNumber}
              textPageCount={textPageCount}
              onPick={startPick}
            />
          </div>

          {flipping && (
            <>
              <div
                className={`book-cast book-cast-${flip.dir}`}
                style={{ opacity: 0.15 + 0.55 * Math.sin(pFold * Math.PI) }}
              />
              <div
                className={`book-curl book-curl-${flip.dir}`}
                style={{
                  width: curlW,
                  opacity: pFold < 0.03 || pFold > 0.97 ? 0 : 1,
                }}
              />
            </>
          )}
        </div>

        {hint && <div className="reader-hint no-turn">左右滑动翻页</div>}
      </div>

      <footer className="reader-progress no-turn">
        <div className="reader-progress-track" aria-hidden>
          <div className="reader-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span>{percent}%</span>
      </footer>
    </div>
  );
}
