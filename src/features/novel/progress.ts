/**
 * 阅读进度：章节归属、全书 / 本章百分比与封面摘要。只读 Story，不改引擎状态。
 *
 * 百分比按节点声明顺序、以正文行数加权估算；传入节点内行号时精确到页内位置，
 * 不传则视为该节点已读完。分支节点并排声明，所以进度在岔路处会有小幅跳动，但始终单调。
 */
import type { SaveRecord } from '../../core/engine/persistence';
import type { Story } from '../../core/engine/types';
import { formatDialogueLine } from './reader/StoryLine';

export interface AutosavePreview {
  storyId: string;
  storyTitle: string;
  chapterLabel: string;
  percent: number;
  excerpt: string;
  savedAt: number;
  ended: boolean;
}

/** 阅读位置（节点 + 节点内行号），由阅读器上报、随自动存档保存 */
export interface ReadingSpot {
  nodeId: string;
  line: number;
}

/** 章节表（阅读顺序）。节点按 `chN_` 前缀归章，s0_ 等无前缀的开篇节点归第一章。 */
const CHAPTER_LABELS = [
  '第一章 · 海平线',
  '第二章 · 无树之岛',
  '第三章 · 暴风雨前',
  '第四章 · 第二十九日',
  '第五章 · 抉择与日常',
  '第六章 · 探寻与归常',
  '第七章 · 樱落对峙',
];

export const CHAPTER_COUNT = CHAPTER_LABELS.length;

/** 节点所属章节的序号（0 起）。 */
export function chapterIndex(nodeId: string): number {
  const m = /^ch(\d+)_/.exec(nodeId);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= CHAPTER_LABELS.length ? n - 1 : 0;
}

/** 第 i 章（0 起）的标题。 */
export function chapterTitle(index: number): string {
  return CHAPTER_LABELS[index] ?? '正文';
}

/** 由节点 id 前缀推断章节标题（对应源文件里的章节注释）。 */
export function chapterLabel(nodeId: string): string {
  return chapterTitle(chapterIndex(nodeId));
}

interface Weights {
  /** 节点 → 全书中排在它之前的权重和 */
  before: Map<string, number>;
  /** 节点 → 本章中排在它之前的权重和 */
  chapterBefore: Map<string, number>;
  chapterTotal: number[];
  total: number;
}

const weightCache = new WeakMap<Story, Weights>();

function nodeWeight(story: Story, nodeId: string): number {
  return Math.max(1, story.nodes[nodeId]?.lines.length ?? 0);
}

function weights(story: Story): Weights {
  const hit = weightCache.get(story);
  if (hit) return hit;
  const before = new Map<string, number>();
  const chapterBefore = new Map<string, number>();
  const chapterTotal = new Array<number>(CHAPTER_LABELS.length).fill(0);
  let total = 0;
  for (const id of Object.keys(story.nodes)) {
    const ch = chapterIndex(id);
    const w = nodeWeight(story, id);
    before.set(id, total);
    chapterBefore.set(id, chapterTotal[ch]);
    total += w;
    chapterTotal[ch] += w;
  }
  const out = { before, chapterBefore, chapterTotal, total };
  weightCache.set(story, out);
  return out;
}

function readWithin(story: Story, nodeId: string, line?: number): number {
  const w = nodeWeight(story, nodeId);
  if (line == null) return w;
  return Math.min(w, Math.max(0, line + 1));
}

function toPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/** 全书进度百分比；line 为节点内已读到的行号（缺省 = 整节点读完）。 */
export function readingPercent(story: Story, nodeId: string, line?: number): number {
  const w = weights(story);
  const before = w.before.get(nodeId);
  if (before == null) return 0;
  return toPercent(before + readWithin(story, nodeId, line), w.total);
}

/** 本章进度百分比；line 含义同上。 */
export function chapterPercent(story: Story, nodeId: string, line?: number): number {
  const w = weights(story);
  const before = w.chapterBefore.get(nodeId);
  if (before == null) return 0;
  return toPercent(before + readWithin(story, nodeId, line), w.chapterTotal[chapterIndex(nodeId)]);
}

/** 封面摘录：指定行（缺省为当前节点第一条非空正文）。 */
export function excerptFrom(story: Story, nodeId: string, line?: number): string {
  const node = story.nodes[nodeId];
  const picked = line != null ? node?.lines[line] : undefined;
  const ln = picked?.text.trim() ? picked : node?.lines.find((l) => l.text.trim());
  if (!ln) return '';
  const fmt = formatDialogueLine(ln.speaker, ln.text);
  if (!fmt.speaker) return fmt.speech;
  return `${fmt.speaker}${fmt.action ?? ''}${fmt.speech ? `：${fmt.speech}` : ''}`;
}

/** 封面用的存档摘要；spot 为阅读器记录的页内位置（与存档对得上时才传）。 */
export function describeAutosave(record: SaveRecord, story: Story | null, spot?: ReadingSpot | null): AutosavePreview {
  const nodeId = spot?.nodeId ?? record.state.currentNodeId;
  const line = spot?.line;
  return {
    storyId: record.storyId,
    storyTitle: story?.meta.title ?? record.storyId,
    chapterLabel: chapterLabel(nodeId),
    percent: story ? readingPercent(story, nodeId, line) : 0,
    excerpt: story ? excerptFrom(story, nodeId, line) : '',
    savedAt: record.savedAt,
    ended: Boolean(record.state.ended),
  };
}
