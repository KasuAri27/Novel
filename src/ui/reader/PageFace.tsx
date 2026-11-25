/**
 * 将节点正文按屏幕高度切成「一屏一页」（CSS 多栏分页）。
 * pageIndex = 'last' 用于回退时落在上一节点末页；null 表示对开空页。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Line } from '../../engine/types';
import { StoryLine } from './StoryLine';

export interface PageMetrics {
  count: number;
  choiceOverflow: boolean;
}

interface Props {
  paragraphs: Line[];
  pageIndex: number | 'last' | null;
  onPageCount?: (metrics: PageMetrics) => void;
}

export function PageFace({ paragraphs, pageIndex, onPageCount }: Props) {
  const clipRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const onCountRef = useRef(onPageCount);
  onCountRef.current = onPageCount;
  const lastReportedRef = useRef<PageMetrics | null>(null);

  const [metrics, setMetrics] = useState({ count: 1, width: 0 });

  const report = useCallback((next: PageMetrics) => {
    const prev = lastReportedRef.current;
    if (prev && prev.count === next.count && prev.choiceOverflow === next.choiceOverflow) return;
    lastReportedRef.current = next;
    onCountRef.current?.(next);
  }, []);

  const measure = useCallback(() => {
    if (paragraphs.length === 0) {
      const w = clipRef.current?.clientWidth ?? 0;
      setMetrics((prev) => (prev.count === 1 && prev.width === w ? prev : { count: 1, width: w }));
      report({ count: 1, choiceOverflow: false });
      return;
    }
    const clip = clipRef.current;
    const flow = flowRef.current;
    if (!clip || !flow) return;
    const w = clip.clientWidth;
    if (w <= 0) return;
    flow.style.columnWidth = `${w}px`;
    flow.style.width = `${w}px`;
    const sw = flow.scrollWidth;
    const count = Math.max(1, Math.ceil(sw / w - 0.02));
    let choiceOverflow = count > 1;
    if (!choiceOverflow) {
      const lastP = flow.lastElementChild as HTMLElement | null;
      const spreadH = clip.closest('.book-spread')?.clientHeight ?? clip.clientHeight;
      const choiceBudget = Math.max(0, spreadH * 0.38 - 52);
      const contentH = lastP ? lastP.getBoundingClientRect().bottom - flow.getBoundingClientRect().top : 0;
      choiceOverflow = contentH > choiceBudget;
    }
    setMetrics((prev) => (prev.count === count && prev.width === w ? prev : { count, width: w }));
    report({ count, choiceOverflow });
  }, [paragraphs, report]);

  useLayoutEffect(() => {
    if (pageIndex === null) return;
    let alive = true;
    measure();
    const clip = clipRef.current;
    if (!clip) return;
    const ro = new ResizeObserver(() => {
      if (alive) measure();
    });
    ro.observe(clip);
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measure, pageIndex]);

  // 对开右栏可能暂时没有正文，不要把左页内容夹过来重复显示
  if (pageIndex === null) {
    return <div className="page-clip" />;
  }

  if (paragraphs.length === 0) {
    return (
      <div className="page-clip" ref={clipRef}>
        <p className="dim">（本页暂无正文，点按右侧继续。）</p>
      </div>
    );
  }

  const idx = pageIndex === 'last' ? Math.max(0, metrics.count - 1) : Math.max(0, pageIndex);
  const ready = metrics.width > 0;

  return (
    <div className="page-clip" ref={clipRef}>
      <div
        className="page-flow"
        ref={flowRef}
        style={{
          transform: ready ? `translate3d(-${idx * metrics.width}px,0,0)` : undefined,
          // 未量完宽时不要把第 0 栏露在右页上
          visibility: !ready && idx > 0 ? 'hidden' : undefined,
        }}
      >
        {paragraphs.map((ln, i) => (
          <StoryLine key={i} line={ln} />
        ))}
      </div>
    </div>
  );
}
