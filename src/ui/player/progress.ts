/**
 * 阅读进度展示：章节名与百分比，仅用于封面/顶栏，不改引擎状态。
 */
import type { SaveRecord } from '../../engine/persistence';
import type { Story } from '../../engine/types';
import { formatDialogueLine } from '../reader/StoryLine';

export interface AutosavePreview {
  storyId: string;
  storyTitle: string;
  chapterLabel: string;
  percent: number;
  excerpt: string;
  savedAt: number;
  ended: boolean;
}

const CHAPTERS: { test: (id: string) => boolean; label: string }[] = [
  { test: (id) => id.startsWith('ch7_'), label: '第七章 · 樱落对峙' },
  { test: (id) => id.startsWith('ch6_'), label: '第六章 · 探寻与归常' },
  { test: (id) => id.startsWith('ch5_'), label: '第五章 · 抉择与日常' },
  { test: (id) => id.startsWith('ch4_'), label: '第四章 · 第二十九日' },
  { test: (id) => id.startsWith('ch3_'), label: '第三章 · 暴风雨前' },
  { test: (id) => id.startsWith('ch2_'), label: '第二章 · 无树之岛' },
  { test: () => true, label: '第一章 · 海平线' },
];

/** 由节点 id 前缀推断章节标题（对应源文件里的章节注释）。 */
export function chapterLabel(nodeId: string): string {
  return CHAPTERS.find((c) => c.test(nodeId))?.label ?? '正文';
}

/** 按节点在剧情中的声明顺序估算阅读百分比。 */
export function readingPercent(story: Story, nodeId: string): number {
  const ids = Object.keys(story.nodes);
  if (ids.length === 0) return 0;
  const i = ids.indexOf(nodeId);
  if (i < 0) return 0;
  return Math.round(((i + 1) / ids.length) * 100);
}

/** 封面摘录：当前节点第一条非空正文。 */
export function excerptFrom(story: Story, nodeId: string): string {
  const node = story.nodes[nodeId];
  const line = node?.lines.find((ln) => ln.text.trim());
  if (!line) return '';
  const fmt = formatDialogueLine(line.speaker, line.text);
  if (!fmt.speaker) return fmt.speech;
  return `${fmt.speaker}${fmt.action ?? ''}${fmt.speech ? `：${fmt.speech}` : ''}`;
}

export function describeAutosave(record: SaveRecord, story: Story | null): AutosavePreview {
  const nodeId = record.state.currentNodeId;
  return {
    storyId: record.storyId,
    storyTitle: story?.meta.title ?? record.storyId,
    chapterLabel: chapterLabel(nodeId),
    percent: story ? readingPercent(story, nodeId) : 0,
    excerpt: story ? excerptFrom(story, nodeId) : '',
    savedAt: record.savedAt,
    ended: Boolean(record.state.ended),
  };
}
