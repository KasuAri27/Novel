/** 阅读器翻页决策：节点内视觉分页 vs 引擎推进（下一节点 / 回退）。 */

export type FlipDir = 'next' | 'prev';

export type TurnPlan =
  | { kind: 'local'; nextIndex: number }
  | { kind: 'engine-next' }
  | { kind: 'engine-prev' }
  | { kind: 'engine-pick'; choiceId: string }
  | { kind: 'blocked' };

export interface SpreadSlots {
  left: number | null;
  right: number | null;
  showChoices: boolean;
}

/** 与 CSS 对开书页断点一致：PC 一展两页，窄屏一展一页。 */
export const SPREAD_MIN_WIDTH = 721;

export function lastVisualIndex(
  textPageCount: number,
  hasChoices = false,
  perSpread = 1,
  choiceOverflow = false,
): number {
  const n = Math.max(1, textPageCount);
  const step = Math.max(1, perSpread);
  const textSpreads = Math.ceil(n / step);
  // PC 上最后一展已铺满两页正文时，选项单独再占一展；
  // 窄屏单页时若正文超出选项页上半部容量，同样让选项单占一展，避免正文被裁切或重排闪烁
  if (hasChoices && ((step >= 2 && n % step === 0) || (step < 2 && choiceOverflow))) {
    return textSpreads;
  }
  return Math.max(0, textSpreads - 1);
}

/** 把 visualIndex（展）映射成左右栏的正文页码。 */
export function spreadSlots(
  visualIndex: number,
  textPageCount: number,
  hasChoices: boolean,
  perSpread = 1,
  choiceOverflow = false,
): SpreadSlots {
  const n = Math.max(1, textPageCount);
  const last = lastVisualIndex(n, hasChoices, perSpread, choiceOverflow);
  const idx = Math.min(Math.max(0, visualIndex), last);
  const step = Math.max(1, perSpread);

  if (step < 2) {
    if (hasChoices && choiceOverflow && idx >= n) {
      return { left: null, right: null, showChoices: true };
    }
    return {
      left: Math.min(idx, n - 1),
      right: null,
      showChoices: Boolean(hasChoices && idx >= last),
    };
  }

  const textSpreads = Math.ceil(n / 2);
  if (hasChoices && n % 2 === 0 && idx >= textSpreads) {
    return { left: null, right: null, showChoices: true };
  }

  const left = idx * 2;
  const right = left + 1;
  return {
    left: left < n ? left : null,
    right: right < n ? right : null,
    showChoices: Boolean(hasChoices && right >= n),
  };
}

export function resolveTurn(opts: {
  dir: FlipDir;
  visualIndex: number;
  textPageCount: number;
  hasChoices: boolean;
  canRewind: boolean;
  perSpread?: number;
  choiceOverflow?: boolean;
}): TurnPlan {
  const { dir, visualIndex, textPageCount, hasChoices, canRewind } = opts;
  const perSpread = opts.perSpread ?? 1;
  const choiceOverflow = opts.choiceOverflow ?? false;
  const last = lastVisualIndex(textPageCount, hasChoices, perSpread, choiceOverflow);
  const idx = Math.min(Math.max(0, visualIndex), last);

  if (dir === 'next') {
    if (idx < last) return { kind: 'local', nextIndex: idx + 1 };
    if (hasChoices) return { kind: 'blocked' };
    return { kind: 'engine-next' };
  }

  if (idx > 0) return { kind: 'local', nextIndex: idx - 1 };
  if (!canRewind) return { kind: 'blocked' };
  return { kind: 'engine-prev' };
}
