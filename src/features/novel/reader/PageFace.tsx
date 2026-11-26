/**
 * 正文排版：一段连续正文用 CSS 多栏切成「一屏一栏」，每一栏就是一页。
 *
 * - FlowMeasure：隐藏的测量实例，量出页数、每行落在哪几页、末页用了多高、选项面板多高；
 * - PageFace：显示某一页（把整段正文平移到对应栏），末页可在正文下方叠放选项。
 *
 * 选项叠放在末页空白处、而不是压缩正文区，所以加不加选项都不会改变分栏，也就不会重排抖动。
 */
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Choice, Line } from '../../../core/engine/types';
import { StoryLine } from './StoryLine';
import { ChoicesPane } from './ChoicesPane';
import type { LineMap } from './paging';

export interface FlowContent {
  lines: Line[];
  /** 段首章节标题 */
  heading: string | null;
  /** 段首选择回显 */
  echo: string | null;
}

export interface FlowMetrics {
  /** 页（栏）宽、高 */
  width: number;
  height: number;
  /** 正文页数 */
  pages: number;
  /** 末页正文底边距页顶的高度 */
  lastFill: number;
  /** 选项面板自然高度（无选项为 0） */
  choicesH: number;
  map: LineMap;
}

function FlowItems({ flow }: { flow: FlowContent }) {
  const empty = !flow.heading && !flow.echo && flow.lines.length === 0;
  return (
    <>
      {flow.heading && <h2 className="flow-heading">{flow.heading}</h2>}
      {flow.echo && (
        <p className="flow-echo">
          <span className="flow-echo-tag">你选择了</span>
          {flow.echo}
        </p>
      )}
      {flow.lines.map((ln, i) => (
        <StoryLine key={i} line={ln} index={i} />
      ))}
      {empty && <p className="dim">（这一页没有正文。）</p>}
    </>
  );
}

function sameMap(a: LineMap, b: LineMap): boolean {
  if (a.first.length !== b.first.length) return false;
  for (let i = 0; i < a.first.length; i++) {
    if (a.first[i] !== b.first[i] || a.last[i] !== b.last[i]) return false;
  }
  return true;
}

export function sameMetrics(a: FlowMetrics, b: FlowMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.pages === b.pages &&
    a.lastFill === b.lastFill &&
    a.choicesH === b.choicesH &&
    sameMap(a.map, b.map)
  );
}

/** 隐藏测量实例：放在与显示页同尺寸的 .page-measure 容器里。 */
export function FlowMeasure({
  flow,
  choices,
  layoutKey,
  onMetrics,
}: {
  flow: FlowContent;
  choices: Choice[];
  /** 排版偏好签名，变化时重新测量 */
  layoutKey: string;
  onMetrics: (m: FlowMetrics) => void;
}) {
  const clipRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;
  const lastRef = useRef<FlowMetrics | null>(null);

  const measure = useCallback(() => {
    const clip = clipRef.current;
    const el = flowRef.current;
    if (!clip || !el) return;
    const width = clip.clientWidth;
    const height = clip.clientHeight;
    if (width <= 0 || height <= 0) return;
    el.style.columnWidth = `${width}px`;
    el.style.width = `${width}px`;

    const pages = Math.max(1, Math.ceil(el.scrollWidth / width - 0.02));
    const origin = el.getBoundingClientRect();
    const colOf = (r: DOMRect) => Math.max(0, Math.min(pages - 1, Math.round((r.left - origin.left) / width)));
    const count = flow.lines.length;
    const first = new Array<number>(count).fill(-1);
    const last = new Array<number>(count).fill(-1);
    let lastFill = 0;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const rects = child.getClientRects();
      if (rects.length === 0) continue;
      const tail = rects[rects.length - 1];
      lastFill = tail.bottom - origin.top;
      const i = Number(child.dataset.i);
      if (Number.isInteger(i) && i >= 0 && i < count) {
        first[i] = colOf(rects[0]);
        last[i] = colOf(tail);
      }
    }
    // 理论上每行都有盒子；兜底补齐，保证数组单调
    for (let i = 0; i < count; i++) {
      if (first[i] < 0) first[i] = i > 0 ? last[i - 1] : 0;
      if (last[i] < first[i]) last[i] = first[i];
    }

    const next: FlowMetrics = {
      width,
      height,
      pages,
      lastFill: Math.ceil(lastFill),
      choicesH: Math.ceil(choicesRef.current?.offsetHeight ?? 0),
      map: { first, last },
    };
    const prev = lastRef.current;
    if (prev && sameMetrics(prev, next)) return;
    lastRef.current = next;
    onMetricsRef.current(next);
  }, [flow]);

  useLayoutEffect(() => {
    let alive = true;
    measure();
    const clip = clipRef.current;
    if (!clip) return;
    const ro = new ResizeObserver(() => {
      if (alive) measure();
    });
    ro.observe(clip);
    if (choicesRef.current) ro.observe(choicesRef.current);
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measure, choices, layoutKey]);

  return (
    <div className="page-clip" ref={clipRef}>
      <div className="page-flow" ref={flowRef}>
        <FlowItems flow={flow} />
      </div>
      {choices.length > 0 && (
        <div className="choices-overlay choices-measure" ref={choicesRef}>
          <ChoicesPane choices={choices} measure />
        </div>
      )}
    </div>
  );
}

/** 显示第 page 页；overlay 叠放在正文下方（只用于末页选项）。 */
export function PageFace({
  flow,
  page,
  width,
  overlay,
}: {
  flow: FlowContent;
  page: number;
  width: number;
  overlay?: { top: number; content: ReactNode };
}) {
  const ready = width > 0;
  return (
    <div className="page-clip">
      <div
        className="page-flow"
        aria-hidden={!ready || undefined}
        style={{
          columnWidth: ready ? `${width}px` : undefined,
          width: ready ? `${width}px` : undefined,
          transform: ready ? `translate3d(${-page * width}px,0,0)` : undefined,
          // 还没量出页宽时先藏起来，避免整段正文挤成一栏闪一下
          visibility: ready ? undefined : 'hidden',
        }}
      >
        <FlowItems flow={flow} />
      </div>
      {overlay && ready && (
        <div className="choices-overlay" style={{ top: `${overlay.top}px` }}>
          {overlay.content}
        </div>
      )}
    </div>
  );
}
