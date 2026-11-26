import { describe, expect, it } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';
import { createInitialState } from '../src/core/engine/state';
import { availableChoices, choose, nextPage, rewindTo } from '../src/core/engine/reducer';
import { MemoryStorage } from '../src/core/engine/persistence';
import {
  chapterOutline,
  cleanChoiceLabel,
  locate,
  readLog,
  segmentOf,
  settle,
} from '../src/features/novel/segment';
import { chapterPercent, readingPercent } from '../src/features/novel/progress';
import { loadPosition, positionMatches, savePosition } from '../src/features/novel/position';

const DSL = [
  '@story id=t title=T',
  '@char 艾玛 immortal',
  '@entry ch1_a',
  '@node ch1_a',
  '> A1',
  '> A2',
  '[goto] ch1_b',
  '@node ch1_b',
  '> B1',
  '[choice] （去左边） -> ch1_l',
  '[choice] 去右边 -> ch1_r',
  '[choice] （也去左边） -> ch1_l',
  '@node ch1_l',
  '> L1',
  '[goto] ch1_m',
  '@node ch1_r',
  '> R1',
  '[goto] ch1_m',
  '@node ch1_m',
  '> M1',
  '[goto] ch2_a',
  '@node ch2_a',
  '> C1',
  '[goto] ch2_end',
  '@node ch2_end',
  '> END',
  '@end E1 priority=1 when alive(艾玛)',
].join('\n');

function story() {
  const res = compileStory(DSL);
  expect(res.errors).toEqual([]);
  return res.stories[0];
}

function pickLabel(st: ReturnType<typeof story>, state: ReturnType<typeof createInitialState>, label: string) {
  const c = availableChoices(st, state).find((x) => x.label === label);
  expect(c).toBeDefined();
  return settle(choose(state, st, c!.id), st);
}

describe('连续排版分段', () => {
  it('开局沿 [goto] 推进到带选项的段尾，整段连续排版', () => {
    const st = story();
    const state = settle(createInitialState(st), st);
    expect(state.currentNodeId).toBe('ch1_b');
    const seg = segmentOf(st, state);
    expect(seg.key).toBe('0:ch1_a');
    expect(seg.lines.map((l) => l.text)).toEqual(['A1', 'A2', 'B1']);
    expect(seg.parts).toEqual([
      { nodeId: 'ch1_a', start: 0, count: 2 },
      { nodeId: 'ch1_b', start: 2, count: 1 },
    ]);
    expect(seg.heading).toBe('第一章 · 海平线');
    expect(seg.echo).toBeNull();
    expect(seg.hasChoices).toBe(true);
    expect(seg.choices).toHaveLength(3);
    expect(seg.endsStory).toBe(false);
  });

  it('同一状态反复取段得到同一对象（供 React 选择器缓存）', () => {
    const st = story();
    const state = settle(createInitialState(st), st);
    expect(segmentOf(st, state)).toBe(segmentOf(st, state));
  });

  it('选择后新起一段，段首带上选择回显（去掉外层括号），并在章末停下', () => {
    const st = story();
    const state = pickLabel(st, settle(createInitialState(st), st), '（去左边）');
    expect(state.currentNodeId).toBe('ch1_m');
    const seg = segmentOf(st, state);
    expect(seg.key).toBe('2:ch1_l');
    expect(seg.lines.map((l) => l.text)).toEqual(['L1', 'M1']);
    expect(seg.echo).toBe('去左边');
    expect(seg.heading).toBeNull();
    expect(seg.hasChoices).toBe(false);
    expect(seg.endsStory).toBe(false);
  });

  it('两个选项通向同一节点时，回显的是实际选中的那个', () => {
    const st = story();
    const state = pickLabel(st, settle(createInitialState(st), st), '（也去左边）');
    expect(state.lastChoice).toEqual({ nodeId: 'ch1_b', choiceId: 'c_ch1_b_2' });
    expect(segmentOf(st, state).echo).toBe('也去左边');
  });

  it('跨章换段并显示新章标题；回退到上一段末尾', () => {
    const st = story();
    const atM = pickLabel(st, settle(createInitialState(st), st), '（去左边）');
    const atCh2 = settle(nextPage(atM, st), st);
    expect(atCh2.currentNodeId).toBe('ch2_end');
    const seg = segmentOf(st, atCh2);
    expect(seg.key).toBe('4:ch2_a');
    expect(seg.heading).toBe('第二章 · 无树之岛');
    expect(seg.endsStory).toBe(true);

    const back = rewindTo(atCh2, seg.startIndex - 1);
    expect(back.currentNodeId).toBe('ch1_m');
    expect(segmentOf(st, back).key).toBe('2:ch1_l');
  });

  it('段内行号可以换算回节点与节点内行号', () => {
    const st = story();
    const seg = segmentOf(st, settle(createInitialState(st), st));
    expect(locate(seg, 0)).toEqual({ nodeId: 'ch1_a', line: 0 });
    expect(locate(seg, 1)).toEqual({ nodeId: 'ch1_a', line: 1 });
    expect(locate(seg, 2)).toEqual({ nodeId: 'ch1_b', line: 0 });
    expect(locate(seg, 99)).toEqual({ nodeId: 'ch1_b', line: 0 });
  });

  it('选项文本只去掉整对外层括号', () => {
    expect(cleanChoiceLabel('（快步追上去）')).toBe('快步追上去');
    expect(cleanChoiceLabel('(look around)')).toBe('look around');
    expect(cleanChoiceLabel('（叹气）说点什么')).toBe('（叹气）说点什么');
    expect(cleanChoiceLabel('（A）和（B）')).toBe('（A）和（B）');
    expect(cleanChoiceLabel('去右边')).toBe('去右边');
  });
});

describe('回顾与目录', () => {
  it('回顾按顺序列出章节标题、正文与做过的选择，当前段只到读到的那一行', () => {
    const st = story();
    const atM = pickLabel(st, settle(createInitialState(st), st), '（去左边）');
    const atCh2 = settle(nextPage(atM, st), st);
    const log = readLog(st, atCh2, 0).map((it) =>
      it.kind === 'line' ? it.line.text : `${it.kind}:${it.text}`,
    );
    expect(log).toEqual([
      'heading:第一章 · 海平线',
      'A1',
      'A2',
      'B1',
      'choice:去左边',
      'L1',
      'M1',
      'heading:第二章 · 无树之岛',
      'C1',
    ]);
  });

  it('回顾超长时从最近的章节标题 / 选择处截断', () => {
    const st = story();
    const atM = pickLabel(st, settle(createInitialState(st), st), '（去左边）');
    const atCh2 = settle(nextPage(atM, st), st);
    const log = readLog(st, atCh2, null, 3);
    expect(log[0]).toEqual({ kind: 'heading', text: '第二章 · 无树之岛' });
  });

  it('目录标出已读 / 正在读 / 未读，并给出跳回章首的位置', () => {
    const st = story();
    const atM = pickLabel(st, settle(createInitialState(st), st), '（去左边）');
    expect(chapterOutline(st, atM).map((c) => [c.title, c.status, c.startIndex])).toEqual([
      ['第一章 · 海平线', 'current', 0],
      ['第二章 · 无树之岛', 'unread', null],
    ]);
    const atCh2 = settle(nextPage(atM, st), st);
    expect(chapterOutline(st, atCh2).map((c) => [c.status, c.startIndex])).toEqual([
      ['read', 0],
      ['current', 4],
    ]);
    const replay = settle(rewindTo(atCh2, 0), st);
    expect(replay.currentNodeId).toBe('ch1_b');
    expect(segmentOf(st, replay).key).toBe('0:ch1_a');
  });
});

describe('进度与页内位置', () => {
  it('进度按行数加权，传入节点内行号时精确到页内', () => {
    const st = story();
    // 全书 8 行：ch1_a 的 2 行排在最前
    expect(readingPercent(st, 'ch1_a', 0)).toBe(13);
    expect(readingPercent(st, 'ch1_a')).toBe(25);
    expect(readingPercent(st, 'ch2_end')).toBe(100);
    // 第一章 6 行（含未走的 ch1_r 分支）；第二章 2 行
    expect(chapterPercent(st, 'ch1_b')).toBe(50);
    expect(chapterPercent(st, 'ch2_a', 0)).toBe(50);
  });

  it('位置记录可读回，并能判断是否与存档同一时刻', () => {
    const storage = new MemoryStorage();
    expect(loadPosition(storage)).toBeNull();
    savePosition(storage, {
      storyId: 't',
      segKey: '0:ch1_a',
      nodeId: 'ch1_b',
      historyLength: 1,
      anchor: { line: 2, offset: 0 },
      spot: { nodeId: 'ch1_b', line: 0 },
      savedAt: 1,
    });
    const pos = loadPosition(storage);
    expect(pos?.anchor).toEqual({ line: 2, offset: 0 });
    expect(positionMatches(pos, { storyId: 't', currentNodeId: 'ch1_b', history: [{}] })).toBe(true);
    expect(positionMatches(pos, { storyId: 't', currentNodeId: 'ch1_b', history: [] })).toBe(false);

    storage.setItem('inov:pos:auto', '{"storyId":"t","anchor":"sideways"}');
    expect(loadPosition(storage)).toBeNull();
  });
});
