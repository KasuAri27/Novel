/**
 * 仿真书本阅读器：PC 对开、窄屏单页。一段连续正文翻完，选项接在末页正文下方；
 * 末页放不下时才单独占一页，并带上末尾几行正文作上下文。
 *
 * 交互：点左 / 右三分之一翻页，点中间切换菜单栏；可拖拽翻页、滚轮、方向键；
 * 出现选项时可按 A/B/C 或 1/2/3 直接选择。
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
import type { Choice, Line } from '../../../core/engine/types';
import { ChoicesPane } from './ChoicesPane';
import { FlowMeasure, PageFace, type FlowContent, type FlowMetrics } from './PageFace';
import { StoryLine } from './StoryLine';
import {
  anchorToIndex,
  CHOICE_GAP,
  EMPTY_LINE_MAP,
  indexToAnchor,
  lastIndex,
  resolveTurn,
  spreadLayout,
  spreadLines,
  SPREAD_MIN_WIDTH,
  type Anchor,
  type FlipDir,
  type PageModel,
  type Slot,
  type TurnPlan,
} from './paging';

/** 阅读器要显示的一段内容 */
export interface ReaderSheet extends FlowContent {
  /** 这次显示的唯一身份：变化即视为换了一段（重置翻页位置） */
  key: string;
  /** 页眉显示的章节名 */
  chapter: string;
  hasChoices: boolean;
  choices: Choice[];
}

/** 当前停留位置，上报给外层用于存档 / 进度 / 回顾 */
export interface ReaderPosition {
  key: string;
  anchor: Anchor;
  /** 这一展首行、末行（段内行号） */
  top: number;
  bottom: number;
  index: number;
  last: number;
}

export interface BookNav {
  goPrev: () => void;
  canGoPrev: boolean;
  focus: () => void;
}

interface Props {
  sheet: ReaderSheet;
  /** 新的一段从哪里开始看：段首 / 段尾 / 某行 */
  landing: Anchor;
  /** 本章进度 0–100 与旁边的文字 */
  percent: number;
  progressLabel: string;
  canRewind: boolean;
  /** 排版偏好签名（字号 / 行距），变化时重新分页 */
  layoutKey: string;
  peekNext: () => ReaderSheet | 'ending' | null;
  peekPrev: () => ReaderSheet | null;
  peekPick: (choiceId: string) => ReaderSheet | null;
  onEngineNext: () => void;
  onEnginePrev: () => void;
  onPick: (choiceId: string) => void;
  onPosition?: (pos: ReaderPosition) => void;
  /** 点中间：显示 / 隐藏菜单栏 */
  onToggleChrome?: () => void;
  /** 成功翻页（含跨段） */
  onFlip?: () => void;
  onNavChange?: (nav: BookNav) => void;
}

type Dest =
  | { kind: 'local'; index: number }
  | { kind: 'sheet'; sheet: ReaderSheet; anchor: Anchor }
  | { kind: 'ending' }
  | { kind: 'blank' };

interface FlipState {
  phase: 'idle' | 'dragging' | 'animating';
  dir: FlipDir;
  progress: number;
  blocked: boolean;
  dest: Dest;
  plan: TurnPlan;
}

const IDLE: FlipState = {
  phase: 'idle',
  dir: 'next',
  progress: 0,
  blocked: false,
  dest: { kind: 'blank' },
  plan: { kind: 'blocked' },
};

const TAP_SLOP = 14;
const COMPLETE_PROGRESS = 0.2;
const COMPLETE_VELOCITY = 0.42;
/** 选项页上方保留的上下文行数 */
const CONTEXT_LINES = 3;
const HINT_KEY = 'reader-hint-seen-v2';

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

function modelFor(sheet: ReaderSheet, m: FlowMetrics | null, perSpread: number): PageModel {
  return {
    pages: m?.pages ?? 1,
    hasChoices: sheet.hasChoices,
    choicesFit: m ? m.lastFill + CHOICE_GAP + m.choicesH <= m.height : false,
    perSpread,
  };
}

function anchorSig(a: Anchor): string {
  return typeof a === 'string' ? a : `${a.line}+${a.offset}`;
}

/** 独立选项页上方的上下文：末尾几行正文，滚到最底，紧挨着选项。 */
function ContextPane({ lines }: { lines: Line[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const tail = lines.slice(-CONTEXT_LINES);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  if (tail.length === 0) return <div className="page-clip" />;
  return (
    <div className="page-clip choice-context" ref={ref}>
      {tail.map((ln, i) => (
        <StoryLine key={i} line={ln} />
      ))}
    </div>
  );
}

/** 与显示页同尺寸的测量用书页（放在 .page-measure 里）。 */
function MeasureSpread({
  sheet,
  layoutKey,
  onMetrics,
}: {
  sheet: ReaderSheet;
  layoutKey: string;
  onMetrics: (m: FlowMetrics) => void;
}) {
  return (
    <div className="book-spread">
      <div className="leaf leaf-left">
        <FlowMeasure flow={sheet} choices={sheet.choices} layoutKey={layoutKey} onMetrics={onMetrics} />
      </div>
      <div className="book-gutter" />
      <div className="leaf leaf-right" />
    </div>
  );
}

function SheetSpread({
  sheet,
  metrics,
  model,
  index,
  onPick,
  nudge = false,
}: {
  sheet: ReaderSheet;
  metrics: FlowMetrics | null;
  model: PageModel;
  index: number;
  onPick?: (id: string) => void;
  nudge?: boolean;
}) {
  const layout = spreadLayout(index, model);
  const width = metrics?.width ?? 0;
  const choices = <ChoicesPane choices={sheet.choices} onPick={onPick} nudge={nudge} />;

  const renderSlot = (slot: Slot) => {
    switch (slot.kind) {
      case 'text':
        return (
          <PageFace
            flow={sheet}
            page={slot.page}
            width={width}
            overlay={slot.overlay && metrics ? { top: metrics.lastFill + CHOICE_GAP, content: choices } : undefined}
          />
        );
      case 'choices':
        return choices;
      case 'context':
        return <ContextPane lines={sheet.lines} />;
      default:
        return <div className="page-clip" />;
    }
  };

  const cls = [
    'book-spread',
    layout.choiceSpread ? 'choice-spread' : '',
    model.perSpread >= 2 ? 'is-spread' : 'is-single',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="leaf leaf-left">
        <div className="leaf-head">{sheet.chapter}</div>
        {renderSlot(layout.left)}
      </div>
      <div className="book-gutter" aria-hidden />
      <div className="leaf leaf-right">{renderSlot(layout.right)}</div>
    </div>
  );
}

/** 翻页时垫在下面的「另一段」：自带测量，量完再定落在哪一展。 */
function PreviewSpread({
  sheet,
  anchor,
  perSpread,
  layoutKey,
}: {
  sheet: ReaderSheet;
  anchor: Anchor;
  perSpread: number;
  layoutKey: string;
}) {
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
  const model = modelFor(sheet, metrics, perSpread);
  const index = anchorToIndex(anchor, model, metrics?.map ?? EMPTY_LINE_MAP);
  return (
    <>
      <div className="page-measure" aria-hidden>
        <MeasureSpread sheet={sheet} layoutKey={layoutKey} onMetrics={setMetrics} />
      </div>
      <SheetSpread sheet={sheet} metrics={metrics} model={model} index={index} />
    </>
  );
}

function EndingSpread() {
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

function BlankSpread() {
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

export function BookReader(p: Props) {
  const {
    sheet,
    landing,
    percent,
    progressLabel,
    canRewind,
    layoutKey,
    peekNext,
    peekPrev,
    peekPick,
    onEngineNext,
    onEnginePrev,
    onPick,
    onPosition,
    onToggleChrome,
    onFlip,
    onNavChange,
  } = p;

  const shellRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<FlipState>(IDLE);
  const cancelAnim = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const nudgeTimer = useRef<number | undefined>(undefined);

  const [perSpread, setPerSpread] = useState(readPerSpread);

  // —— 测量结果与当前位置都按 sheet.key 归属，换段后旧值自动失效 ——
  const keyRef = useRef(sheet.key);
  keyRef.current = sheet.key;
  const [measured, setMeasured] = useState<{ key: string; m: FlowMetrics } | null>(null);
  const metrics = measured && measured.key === sheet.key ? measured.m : null;
  const handleMetrics = useCallback((m: FlowMetrics) => setMeasured({ key: keyRef.current, m }), []);

  const [view, setView] = useState<{ key: string; anchor: Anchor } | null>(null);
  const anchor: Anchor = view && view.key === sheet.key ? view.anchor : landing;

  const model = modelFor(sheet, metrics, perSpread);
  const map = metrics?.map ?? EMPTY_LINE_MAP;
  const index = anchorToIndex(anchor, model, map);
  const last = lastIndex(model);
  const layout = spreadLayout(index, model);

  const [flip, setFlip] = useState<FlipState>(IDLE);
  flipRef.current = flip;
  const [nudge, setNudge] = useState(false);
  const [hint, setHint] = useState(() => {
    try {
      return sessionStorage.getItem(HINT_KEY) !== '1';
    } catch {
      return true;
    }
  });

  // 动画回调里要拿到最新的分页信息
  const latest = useRef({ sheet, model, map, index, layout });
  latest.current = { sheet, model, map, index, layout };

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SPREAD_MIN_WIDTH}px)`);
    const sync = () => setPerSpread(mq.matches ? 2 : 1);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    cancelAnim.current?.();
    cancelAnim.current = null;
    busyRef.current = false;
    setFlip(IDLE);
  }, [sheet.key]);

  useEffect(() => {
    readerRef.current?.focus({ preventScroll: true });
  }, [sheet.key]);

  useEffect(() => () => window.clearTimeout(nudgeTimer.current), []);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => {
      setHint(false);
      try {
        sessionStorage.setItem(HINT_KEY, '1');
      } catch {
        /* ignore */
      }
    }, 4200);
    return () => window.clearTimeout(t);
  }, [hint]);

  // 上报当前位置（存档 / 进度 / 回顾）
  const sig = anchorSig(anchor);
  useEffect(() => {
    if (!metrics || !onPosition) return;
    const span = spreadLines(index, model, map);
    onPosition({
      key: sheet.key,
      anchor,
      top: span?.top ?? 0,
      bottom: span?.bottom ?? 0,
      index,
      last,
    });
    // anchor / model / map 由 sig、metrics、index 完整描述
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.key, metrics, index, last, sig, onPosition]);

  const buildDest = (plan: TurnPlan): Dest => {
    switch (plan.kind) {
      case 'blocked':
        return { kind: 'blank' };
      case 'local':
        return { kind: 'local', index: plan.nextIndex };
      case 'engine-next': {
        const next = peekNext();
        if (next === 'ending') return { kind: 'ending' };
        return next ? { kind: 'sheet', sheet: next, anchor: 'start' } : { kind: 'blank' };
      }
      case 'engine-prev': {
        const prev = peekPrev();
        return prev ? { kind: 'sheet', sheet: prev, anchor: 'end' } : { kind: 'blank' };
      }
      case 'engine-pick': {
        const picked = peekPick(plan.choiceId);
        return picked ? { kind: 'sheet', sheet: picked, anchor: 'start' } : { kind: 'blank' };
      }
    }
  };

  const commitPlan = (plan: TurnPlan) => {
    cancelAnim.current = null;
    setFlip(IDLE);
    busyRef.current = false;
    onFlip?.();
    if (plan.kind === 'local') {
      const cur = latest.current;
      setView({ key: cur.sheet.key, anchor: indexToAnchor(plan.nextIndex, cur.model, cur.map) });
      return;
    }
    if (plan.kind === 'engine-next') onEngineNext();
    else if (plan.kind === 'engine-prev') onEnginePrev();
    else if (plan.kind === 'engine-pick') onPick(plan.choiceId);
  };

  const playTo = (from: number, to: number, base: Omit<FlipState, 'phase' | 'progress'>, onEnd: () => void) => {
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

  const pokeChoices = () => {
    setNudge(true);
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => setNudge(false), 720);
  };

  const startFlip = (dir: FlipDir) => {
    if (busyRef.current || flipRef.current.phase !== 'idle') return;
    const plan = resolveTurn({ dir, index, model, canRewind });
    const dest = buildDest(plan);
    const blocked = plan.kind === 'blocked';
    const base = { dir, blocked, dest, plan };
    setHint(false);
    if (blocked) {
      if (dir === 'next' && layout.showChoices) pokeChoices();
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
    const base = { dir: 'next' as const, blocked: false, dest: buildDest(plan), plan };
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
      const plan = resolveTurn({ dir, index, model, canRewind });
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

    if (!s.dragging) {
      if (e.type === 'pointercancel') return;
      const rect = shellRef.current?.getBoundingClientRect();
      const ratio = rect && rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      if (ratio < 1 / 3) startFlip('prev');
      else if (ratio > 2 / 3) startFlip('next');
      else {
        setHint(false);
        onToggleChrome?.();
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
    else {
      if (f.blocked && f.dir === 'next' && layout.showChoices) pokeChoices();
      playTo(f.progress, 0, base, () => {
        setFlip(IDLE);
        busyRef.current = false;
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // 键盘聚焦在选项按钮上时，空格 / 回车交给按钮自己
    if (target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;

    if (layout.showChoices && sheet.choices.length > 0) {
      const k = e.key.toLowerCase();
      let i = -1;
      if (/^[1-9]$/.test(k)) i = Number(k) - 1;
      else if (/^[a-z]$/.test(k)) i = k.charCodeAt(0) - 97;
      if (i >= 0 && i < sheet.choices.length) {
        e.preventDefault();
        startPick(sheet.choices[i].id);
        return;
      }
    }

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

  const canGoPrev = index > 0 || canRewind;
  useEffect(() => {
    onNavChange?.({
      goPrev: () => startFlipRef.current('prev'),
      canGoPrev,
      focus: () => readerRef.current?.focus({ preventScroll: true }),
    });
  }, [canGoPrev, onNavChange]);

  const flipping = flip.phase !== 'idle' && flip.progress > 0.001;
  const pFold = flip.progress;
  const curlW = 10 + 42 * Math.sin(Math.min(1, pFold) * Math.PI);
  const foldStyle = {
    '--fold': `${(1 - pFold) * 100}%`,
    '--fold-inv': `${pFold * 100}%`,
  } as CSSProperties;

  const renderDest = (dest: Dest) => {
    switch (dest.kind) {
      case 'local':
        return <SheetSpread sheet={sheet} metrics={metrics} model={model} index={dest.index} />;
      case 'sheet':
        return <PreviewSpread sheet={dest.sheet} anchor={dest.anchor} perSpread={perSpread} layoutKey={layoutKey} />;
      case 'ending':
        return <EndingSpread />;
      default:
        return <BlankSpread />;
    }
  };

  return (
    <div className="reader" ref={readerRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${sheet.chapter} 阅读器`}>
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
            <div className="sheet sheet-under" aria-hidden>
              {renderDest(flip.dest)}
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
              <MeasureSpread key={`m:${sheet.key}`} sheet={sheet} layoutKey={layoutKey} onMetrics={handleMetrics} />
            </div>
            <SheetSpread
              sheet={sheet}
              metrics={metrics}
              model={model}
              index={index}
              onPick={startPick}
              nudge={nudge}
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
      </div>

      {/* 首次进入时，操作提示临时占用底部进度栏的位置，不遮挡正文 */}
      <footer className="reader-progress no-turn">
        {hint ? (
          <span className="reader-hint">点两侧翻页 · 点中间显示菜单</span>
        ) : (
          <>
            <div className="reader-progress-track" aria-hidden>
              <div className="reader-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="reader-progress-label">{progressLabel}</span>
          </>
        )}
      </footer>
    </div>
  );
}
