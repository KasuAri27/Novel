import { describe, expect, it } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';
import { createInitialState } from '../src/core/engine/state';
import { AUTO_SLOT, MemoryStorage, loadAutosave, saveAutosave } from '../src/core/engine/persistence';
import { chapterLabel, describeAutosave, readingPercent } from '../src/features/novel/progress';

const DSL = [
  '@story id=t title=测试剧情',
  '@char 艾玛 immortal',
  '@entry ch1_start',
  '@node ch1_start',
  '艾玛> 第一章开头。',
  '[goto] ch2_mid',
  '@node ch2_mid',
  '走廊尽头只剩一盏灯。',
  '[goto] ch3_end',
  '@node ch3_end',
  '艾玛> 快结束了。',
].join('\n');

function story() {
  const s = compileStory(DSL).stories[0];
  expect(s).toBeDefined();
  return s;
}

describe('章节进度', () => {
  it('按节点 id 前缀给出章节名', () => {
    expect(chapterLabel('s0_breakfast')).toBe('第一章 · 海平线');
    expect(chapterLabel('ch2_night')).toBe('第二章 · 无树之岛');
    expect(chapterLabel('ch3_morning')).toBe('第三章 · 暴风雨前');
    expect(chapterLabel('ch4_split_3p')).toBe('第四章 · 第二十九日');
    expect(chapterLabel('ch5_nocase_entry')).toBe('第五章 · 抉择与日常');
    expect(chapterLabel('ch6_nocase_entry')).toBe('第六章 · 探寻与归常');
    expect(chapterLabel('ch7_nocase_entry')).toBe('第七章 · 樱落对峙');
  });

  it('按节点声明顺序估算百分比', () => {
    const st = story();
    expect(readingPercent(st, 'ch1_start')).toBe(33);
    expect(readingPercent(st, 'ch2_mid')).toBe(67);
    expect(readingPercent(st, 'ch3_end')).toBe(100);
  });
});

describe('自动存档', () => {
  it('写入 auto 槽后可以读回进度', () => {
    const st = story();
    const storage = new MemoryStorage();
    const state = createInitialState(st);
    state.currentNodeId = 'ch2_mid';
    saveAutosave(storage, state);

    const rec = loadAutosave(storage);
    expect(rec?.slot).toBe(AUTO_SLOT);
    expect(rec?.state.currentNodeId).toBe('ch2_mid');

    const preview = describeAutosave(rec!, st);
    expect(preview.chapterLabel).toBe('第二章 · 无树之岛');
    expect(preview.percent).toBe(67);
    expect(preview.excerpt).toContain('走廊尽头');
  });

  it('再次保存会覆盖同一份自动存档', () => {
    const st = story();
    const storage = new MemoryStorage();
    const a = createInitialState(st);
    saveAutosave(storage, a);
    const b = { ...createInitialState(st), currentNodeId: 'ch3_end' };
    saveAutosave(storage, b);
    expect(loadAutosave(storage)?.state.currentNodeId).toBe('ch3_end');
  });
});
