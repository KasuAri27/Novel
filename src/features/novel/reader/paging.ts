/**
 * 阅读器分页模型：把「一段连续正文 + 段尾选项」映射成可翻的页 / 展，
 * 并在「展序号」与「阅读锚点」之间换算（换字号、转屏、续读时靠锚点保持位置）。
 *
 * 选项摆放规则：
 * - 正文末页剩余空间放得下选项 → 选项直接接在末页正文下方，不额外占页；
 * - PC 对开且正文为奇数页 → 末展右页本来就空，选项放右页；
 * - 放不下 → 选项单独占一页（窄屏）/ 一展（PC），并带上末尾几段正文作上下文。
 */

export type FlipDir = 'next' | 'prev';

export type TurnPlan =
  | { kind: 'local'; nextIndex: number }
  | { kind: 'engine-next' }
  | { kind: 'engine-prev' }
  | { kind: 'engine-pick'; choiceId: string }
  | { kind: 'blocked' };

/** 与 CSS 对开书页断点一致：PC 一展两页，窄屏一展一页。 */
export const SPREAD_MIN_WIDTH = 721;

/** 选项面板与末页正文之间的留白（px） */
export const CHOICE_GAP = 20;

export interface PageModel {
  /** 正文页数（CSS 多栏的栏数），至少 1 */
  pages: number;
  /** 段尾带选项 */
  hasChoices: boolean;
  /** 选项能直接排进正文末页的空白处 */
  choicesFit: boolean;
  /** 一展几页：PC 2，窄屏 1 */
  perSpread: number;
}

export type Slot =
  | { kind: 'text'; page: number; overlay: boolean }
  | { kind: 'choices' }
  | { kind: 'context' }
  | { kind: 'empty' };

export interface SpreadLayout {
  left: Slot;
  right: Slot;
  /** 这一展能看到选项 */
  showChoices: boolean;
  /** 这一展是「上下文 + 选项」的独立选项页 */
  choiceSpread: boolean;
}

/** 每行正文落在哪些页（栏）：first[i] 起始页，last[i] 结束页 */
export interface LineMap {
  first: number[];
  last: number[];
}

/**
 * 阅读锚点：'start' 段首；'end' 段尾（含选项页）；
 * 否则为「第 line 行起始页再往后 offset 页」——段落跨页时也能落回同一页。
 */
export type Anchor = 'start' | 'end' | { line: number; offset: number };

export const EMPTY_LINE_MAP: LineMap = { first: [], last: [] };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function per(m: PageModel): number {
  return m.perSpread >= 2 ? 2 : 1;
}

/** 最后一展的序号。 */
export function lastIndex(m: PageModel): number {
  const n = Math.max(1, m.pages);
  if (per(m) === 2) {
    const spreads = Math.ceil(n / 2);
    // 偶数页正文铺满末展、选项又塞不进末页 → 选项单独再占一展
    return m.hasChoices && n % 2 === 0 && !m.choicesFit ? spreads : spreads - 1;
  }
  return m.hasChoices && !m.choicesFit ? n : n - 1;
}

/** 第 index 展的左右槽位。 */
export function spreadLayout(index: number, m: PageModel): SpreadLayout {
  const n = Math.max(1, m.pages);
  const idx = clamp(index, 0, lastIndex(m));

  if (per(m) === 2) {
    const l = idx * 2;
    const r = l + 1;
    if (l >= n) {
      return { left: { kind: 'context' }, right: { kind: 'choices' }, showChoices: true, choiceSpread: true };
    }
    const left: Slot = { kind: 'text', page: l, overlay: false };
    let right: Slot;
    if (r < n) right = { kind: 'text', page: r, overlay: m.hasChoices && m.choicesFit && r === n - 1 };
    else right = m.hasChoices ? { kind: 'choices' } : { kind: 'empty' };
    const showChoices = right.kind === 'choices' || (right.kind === 'text' && right.overlay);
    return { left, right, showChoices, choiceSpread: false };
  }

  if (idx >= n) {
    return { left: { kind: 'context' }, right: { kind: 'choices' }, showChoices: true, choiceSpread: true };
  }
  const overlay = m.hasChoices && m.choicesFit && idx === n - 1;
  return { left: { kind: 'text', page: idx, overlay }, right: { kind: 'empty' }, showChoices: overlay, choiceSpread: false };
}

export function resolveTurn(opts: { dir: FlipDir; index: number; model: PageModel; canRewind: boolean }): TurnPlan {
  const { dir, model, canRewind } = opts;
  const last = lastIndex(model);
  const idx = clamp(opts.index, 0, last);

  if (dir === 'next') {
    if (idx < last) return { kind: 'local', nextIndex: idx + 1 };
    if (model.hasChoices) return { kind: 'blocked' };
    return { kind: 'engine-next' };
  }

  if (idx > 0) return { kind: 'local', nextIndex: idx - 1 };
  if (!canRewind) return { kind: 'blocked' };
  return { kind: 'engine-prev' };
}

/** 锚点 → 展序号。 */
export function anchorToIndex(anchor: Anchor, m: PageModel, map: LineMap): number {
  const last = lastIndex(m);
  if (anchor === 'start') return 0;
  if (anchor === 'end') return last;
  const count = map.first.length;
  if (count === 0) return 0;
  const i = clamp(Math.floor(anchor.line), 0, count - 1);
  const page = Math.min(map.first[i] + Math.max(0, Math.floor(anchor.offset)), map.last[i]);
  return clamp(Math.floor(page / per(m)), 0, last);
}

/** 展序号 → 锚点（取这一展第一页顶端的那一行）。 */
export function indexToAnchor(index: number, m: PageModel, map: LineMap): Anchor {
  const last = lastIndex(m);
  if (index <= 0) return 'start';
  if (index >= last) return 'end';
  const p0 = index * per(m);
  const i = map.last.findIndex((lp) => lp >= p0);
  if (i < 0) return 'end';
  return { line: i, offset: Math.max(0, p0 - map.first[i]) };
}

/** 这一展能看到的首行与末行（选项页按段尾计）；没有正文时为 null。 */
export function spreadLines(index: number, m: PageModel, map: LineMap): { top: number; bottom: number } | null {
  const count = map.first.length;
  if (count === 0) return null;
  const n = Math.max(1, m.pages);
  const p0 = clamp(index, 0, lastIndex(m)) * per(m);
  if (p0 >= n) return { top: count - 1, bottom: count - 1 };
  const p1 = Math.min(p0 + per(m) - 1, n - 1);
  let top = map.last.findIndex((lp) => lp >= p0);
  if (top < 0) top = count - 1;
  let bottom = top;
  for (let i = top; i < count && map.first[i] <= p1; i++) bottom = i;
  return { top, bottom };
}
