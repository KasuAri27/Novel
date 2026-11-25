import { describe, expect, it } from 'vitest';
import { lastVisualIndex, resolveTurn, spreadSlots } from '../src/features/novel/reader/paging';
import { formatDialogueLine } from '../src/features/novel/reader/StoryLine';

describe('阅读器视觉翻页', () => {
  it('窄屏：最后一展就是正文末页；正文超出选项页容量时单占一展放选项', () => {
    expect(lastVisualIndex(3, false, 1)).toBe(2);
    expect(lastVisualIndex(1, false, 1)).toBe(0);
    expect(lastVisualIndex(3, true, 1)).toBe(2);
    expect(lastVisualIndex(3, true, 1, true)).toBe(3);
    expect(lastVisualIndex(1, true, 1, true)).toBe(1);
  });

  it('PC 对开：4 页正文合成 2 展', () => {
    expect(lastVisualIndex(4, false, 2)).toBe(1);
    expect(lastVisualIndex(3, false, 2)).toBe(1);
    expect(lastVisualIndex(1, false, 2)).toBe(0);
  });

  it('PC 对开且选项：偶数页正文后再加一展放选项', () => {
    expect(lastVisualIndex(4, true, 2)).toBe(2);
    expect(lastVisualIndex(3, true, 2)).toBe(1);
    expect(lastVisualIndex(1, true, 2)).toBe(0);
  });

  it('PC 对开槽位：左右各一栏正文', () => {
    expect(spreadSlots(0, 4, false, 2)).toEqual({ left: 0, right: 1, showChoices: false });
    expect(spreadSlots(1, 4, false, 2)).toEqual({ left: 2, right: 3, showChoices: false });
    expect(spreadSlots(1, 3, false, 2)).toEqual({ left: 2, right: null, showChoices: false });
  });

  it('窄屏槽位：只有左栏，选项在末页（超出容量时独立一展且 left 为 null）', () => {
    expect(spreadSlots(0, 3, false, 1)).toEqual({ left: 0, right: null, showChoices: false });
    expect(spreadSlots(2, 3, true, 1)).toEqual({ left: 2, right: null, showChoices: true });
    expect(spreadSlots(2, 3, true, 1, true)).toEqual({ left: 2, right: null, showChoices: false });
    expect(spreadSlots(3, 3, true, 1, true)).toEqual({ left: null, right: null, showChoices: true });
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 2,
        textPageCount: 3,
        hasChoices: true,
        canRewind: true,
        perSpread: 1,
        choiceOverflow: true,
      }),
    ).toEqual({ kind: 'local', nextIndex: 3 });
  });

  it('PC 对开槽位：奇数末页右侧给选项', () => {
    expect(spreadSlots(1, 3, true, 2)).toEqual({ left: 2, right: null, showChoices: true });
    expect(spreadSlots(2, 4, true, 2)).toEqual({ left: null, right: null, showChoices: true });
  });

  it('节点内向后翻走 local', () => {
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 0,
        textPageCount: 3,
        hasChoices: false,
        canRewind: false,
      }),
    ).toEqual({ kind: 'local', nextIndex: 1 });
  });

  it('PC 对开首页下一展', () => {
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 0,
        textPageCount: 4,
        hasChoices: false,
        canRewind: false,
        perSpread: 2,
      }),
    ).toEqual({ kind: 'local', nextIndex: 1 });
  });

  it('正文末页且有选项 → 不能再往后翻，需点选', () => {
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 2,
        textPageCount: 3,
        hasChoices: true,
        canRewind: true,
      }),
    ).toEqual({ kind: 'blocked' });
  });

  it('正文末页且无选项 → 引擎下一节点', () => {
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 2,
        textPageCount: 3,
        hasChoices: false,
        canRewind: true,
      }),
    ).toEqual({ kind: 'engine-next' });
  });

  it('仅一页正文且有选项 → 不能再下一页', () => {
    expect(
      resolveTurn({
        dir: 'next',
        visualIndex: 0,
        textPageCount: 1,
        hasChoices: true,
        canRewind: true,
      }),
    ).toEqual({ kind: 'blocked' });
  });

  it('首页且无历史 → 上一页被挡住', () => {
    expect(
      resolveTurn({
        dir: 'prev',
        visualIndex: 0,
        textPageCount: 3,
        hasChoices: false,
        canRewind: false,
      }),
    ).toEqual({ kind: 'blocked' });
  });

  it('首页且有历史 → 引擎回退', () => {
    expect(
      resolveTurn({
        dir: 'prev',
        visualIndex: 0,
        textPageCount: 3,
        hasChoices: false,
        canRewind: true,
      }),
    ).toEqual({ kind: 'engine-prev' });
  });
});

describe('小说模式对白排版格式化', () => {
  it('旁白行保持原样', () => {
    expect(formatDialogueLine(null, '  海风拂过岛屿。  ')).toEqual({
      speaker: null,
      action: null,
      speech: '海风拂过岛屿。',
    });
  });

  it('普通对白补全双引号并保留不重复加引号', () => {
    expect(formatDialogueLine('希罗', '别急。')).toEqual({
      speaker: '希罗',
      action: null,
      speech: '“别急。”',
    });
    expect(formatDialogueLine('希罗', '“已经够了。”')).toEqual({
      speaker: '希罗',
      action: null,
      speech: '“已经够了。”',
    });
  });

  it('带前置动作与纯动作对白分别规范拆分', () => {
    expect(formatDialogueLine('艾玛', '（顿了顿）真是的……')).toEqual({
      speaker: '艾玛',
      action: '（顿了顿）',
      speech: '“真是的……”',
    });
    expect(formatDialogueLine('艾玛', '（轻轻点头）')).toEqual({
      speaker: '艾玛',
      action: '（轻轻点头）',
      speech: '',
    });
  });
});
