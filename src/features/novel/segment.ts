/**
 * 连续排版分段（小说模式）。
 *
 * 一「段」= 从一次选择（或章首 / 开篇）开始，沿 [goto] 串下去，直到带选项的节点、
 * 叶子节点或章节边界为止的若干节点。阅读器把整段正文连续排版，节点边界不再强制换页。
 *
 * 约定：小说模式下引擎状态总停在「段尾」——进入一段时用 settle() 把段内节点一次推进完
 * （各节点的 onEnter 依次生效、历史照常入栈）。段内翻页只是视觉翻页；
 * 选择、翻过段尾、回退到上一段、跳章才会改动引擎状态。
 */
import type { Choice, GameState, Line, Story } from '../../core/engine/types';
import { availableChoices, nextPage } from '../../core/engine/reducer';
import { chapterIndex, chapterTitle, type ReadingSpot } from './progress';

export interface SegmentPart {
  nodeId: string;
  /** 本节点第一行在整段中的行号 */
  start: number;
  count: number;
}

export interface Segment {
  /** 段身份：起点在路径中的下标 + 起点节点（段内推进时保持不变） */
  key: string;
  /** 起点在路径（history + 当前节点）中的下标 */
  startIndex: number;
  parts: SegmentPart[];
  lines: Line[];
  chapter: number;
  /** 段首恰好是章节开头时显示的章节标题 */
  heading: string | null;
  /** 让读者走进这一段的那次选择（已去掉外层括号） */
  echo: string | null;
  /** 段尾节点带选项（即使此刻全被条件隐藏） */
  hasChoices: boolean;
  /** 段尾此刻可见的选项 */
  choices: Choice[];
  /** 段尾是叶子节点：翻过最后一页即结算结局 */
  endsStory: boolean;
}

/** 已走过的节点序列：历史快照 + 当前节点。 */
export function pathOf(state: GameState): string[] {
  return [...state.history.map((h) => h.currentNodeId), state.currentNodeId];
}

/** 从 prev 走到 next 是否开启新的一段。 */
function isBreak(story: Story, prevId: string, nextId: string): boolean {
  if (prevId === nextId) return true;
  const prev = story.nodes[prevId];
  if (!prev || prev.choices.length > 0 || prev.next !== nextId) return true;
  return chapterIndex(prevId) !== chapterIndex(nextId);
}

/** 当前节点能否不经选择、不跨章地接到下一节点。 */
function flowsOn(story: Story, nodeId: string): boolean {
  const node = story.nodes[nodeId];
  if (!node || node.choices.length > 0 || !node.next || !story.nodes[node.next]) return false;
  return chapterIndex(node.next) === chapterIndex(nodeId);
}

/** 沿 [goto] 把引擎推进到段尾（带选项 / 叶子 / 章末）。遇到环路即停。 */
export function settle(state: GameState, story: Story): GameState {
  let cur = state;
  const seen = new Set<string>([cur.currentNodeId]);
  while (!cur.ended && flowsOn(story, cur.currentNodeId)) {
    const next = nextPage(cur, story);
    if (next.currentNodeId === cur.currentNodeId || seen.has(next.currentNodeId)) break;
    seen.add(next.currentNodeId);
    cur = next;
  }
  return cur;
}

/** 去掉选项文本外层整对括号：「（快步追上去）」→「快步追上去」。 */
export function cleanChoiceLabel(label: string): string {
  const m = /^[（(]\s*([\s\S]*?)\s*[）)]$/.exec(label.trim());
  if (!m || /[（）()]/.test(m[1])) return label.trim();
  return m[1];
}

/** 路径中各段的起点下标（升序，含 0）。 */
function segmentStarts(story: Story, path: string[]): number[] {
  const starts = [0];
  for (let i = 1; i < path.length; i++) {
    if (isBreak(story, path[i - 1], path[i])) starts.push(i);
  }
  return starts;
}

function stateAt(state: GameState, index: number): Omit<GameState, 'history'> {
  return index < state.history.length ? state.history[index] : state;
}

/** 走进第 s 步那一段时做的选择（没有则 null）。 */
function choiceInto(story: Story, state: GameState, path: string[], s: number): string | null {
  if (s <= 0) return null;
  const prev = story.nodes[path[s - 1]];
  if (!prev || prev.choices.length === 0) return null;
  const lc = stateAt(state, s).lastChoice;
  let picked = lc && lc.nodeId === prev.id ? prev.choices.find((c) => c.id === lc.choiceId) : undefined;
  if (!picked) picked = prev.choices.find((c) => c.goto === path[s]);
  return picked ? cleanChoiceLabel(picked.label) : null;
}

function headingAt(path: string[], s: number): string | null {
  if (s === 0 || chapterIndex(path[s - 1]) !== chapterIndex(path[s])) return chapterTitle(chapterIndex(path[s]));
  return null;
}

const segmentCache = new WeakMap<GameState, Segment>();

/** 当前状态所在的一段（按状态对象缓存，同一状态反复取得同一对象）。 */
export function segmentOf(story: Story, state: GameState): Segment {
  const hit = segmentCache.get(state);
  if (hit) return hit;

  const path = pathOf(state);
  const end = path.length - 1;
  let s = end;
  while (s > 0 && !isBreak(story, path[s - 1], path[s])) s--;

  const parts: SegmentPart[] = [];
  const lines: Line[] = [];
  for (let i = s; i <= end; i++) {
    const ls = story.nodes[path[i]]?.lines ?? [];
    parts.push({ nodeId: path[i], start: lines.length, count: ls.length });
    lines.push(...ls);
  }

  const endNode = story.nodes[path[end]];
  const hasChoices = (endNode?.choices.length ?? 0) > 0;
  const seg: Segment = {
    key: `${s}:${path[s]}`,
    startIndex: s,
    parts,
    lines,
    chapter: chapterIndex(path[s]),
    heading: headingAt(path, s),
    echo: choiceInto(story, state, path, s),
    hasChoices,
    choices: hasChoices && !state.ended ? availableChoices(story, state) : [],
    endsStory: !hasChoices && (!endNode?.next || !story.nodes[endNode.next]),
  };
  segmentCache.set(state, seg);
  return seg;
}

/** 段内第 line 行对应的节点与节点内行号。 */
export function locate(seg: Segment, line: number): ReadingSpot {
  const parts = seg.parts;
  if (parts.length === 0) return { nodeId: '', line: 0 };
  const i = Math.max(0, line);
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    if (p.count > 0 && i >= p.start) return { nodeId: p.nodeId, line: Math.min(i - p.start, p.count - 1) };
  }
  return { nodeId: parts[0].nodeId, line: -1 };
}

export type LogItem =
  | { kind: 'heading'; text: string }
  | { kind: 'choice'; text: string }
  | { kind: 'line'; line: Line };

/**
 * 回顾：按读过的顺序列出正文、章节标题与做过的选择。
 * 当前段只列到 upto 行（含）为止；maxLines 只保留最近若干行正文。
 */
export function readLog(story: Story, state: GameState, upto: number | null, maxLines = 400): LogItem[] {
  const path = pathOf(state);
  const starts = segmentStarts(story, path);
  const items: LogItem[] = [];
  starts.forEach((s, k) => {
    const e = k + 1 < starts.length ? starts[k + 1] - 1 : path.length - 1;
    const heading = headingAt(path, s);
    if (heading) items.push({ kind: 'heading', text: heading });
    const echo = choiceInto(story, state, path, s);
    if (echo) items.push({ kind: 'choice', text: echo });
    const isCurrent = k === starts.length - 1;
    let budget = isCurrent && upto != null ? upto + 1 : Infinity;
    for (let i = s; i <= e && budget > 0; i++) {
      for (const line of story.nodes[path[i]]?.lines ?? []) {
        if (budget <= 0) break;
        items.push({ kind: 'line', line });
        budget--;
      }
    }
  });

  let seen = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'line' && ++seen > maxLines) {
      // 从第一处章节标题 / 选择处截断，避免回顾以半段话开头
      let cut = i + 1;
      while (cut < items.length && items[cut].kind === 'line') cut++;
      return cut < items.length ? items.slice(cut) : items.slice(i + 1);
    }
  }
  return items;
}

export interface ChapterEntry {
  index: number;
  title: string;
  status: 'read' | 'current' | 'unread';
  /** 本章首个节点在路径中的下标（未读则 null） */
  startIndex: number | null;
}

/** 目录：剧情里出现过的章节，以及读者在每章的状态。 */
export function chapterOutline(story: Story, state: GameState): ChapterEntry[] {
  const present = new Set(Object.keys(story.nodes).map(chapterIndex));
  const path = pathOf(state);
  const current = chapterIndex(state.currentNodeId);
  const firstAt = new Map<number, number>();
  path.forEach((id, i) => {
    const ch = chapterIndex(id);
    if (!firstAt.has(ch)) firstAt.set(ch, i);
  });
  // 当前章取最近一次进入的位置（跳章重读后以新的进入点为准）
  for (let i = path.length - 1; i >= 0 && chapterIndex(path[i]) === current; i--) firstAt.set(current, i);

  return [...present]
    .sort((a, b) => a - b)
    .map((index) => {
      const startIndex = firstAt.get(index) ?? null;
      const status: ChapterEntry['status'] = index === current ? 'current' : startIndex != null ? 'read' : 'unread';
      return { index, title: chapterTitle(index), status, startIndex };
    });
}
