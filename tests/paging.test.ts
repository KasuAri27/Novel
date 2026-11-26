import { describe, expect, it } from 'vitest';
import {
  anchorToIndex,
  indexToAnchor,
  lastIndex,
  resolveTurn,
  spreadLayout,
  spreadLines,
  type LineMap,
  type PageModel,
} from '../src/features/novel/reader/paging';
import { formatDialogueLine } from '../src/features/novel/reader/StoryLine';

const model = (pages: number, hasChoices = false, choicesFit = false, perSpread = 1): PageModel => ({
  pages,
  hasChoices,
  choicesFit,
  perSpread,
});

describe('阅读器分页：选项摆放', () => {
  it('窄屏：末页放得下选项就不加页，放不下才单独加一页', () => {
    expect(lastIndex(model(3))).toBe(2);
    expect(lastIndex(model(1))).toBe(0);
    expect(lastIndex(model(3, true, true))).toBe(2);
    expect(lastIndex(model(3, true, false))).toBe(3);
    expect(lastIndex(model(1, true, false))).toBe(1);
  });

  it('窄屏：选项接在末页正文下方（同一页同时出现正文和选项）', () => {
    expect(spreadLayout(2, model(3, true, true))).toEqual({
      left: { kind: 'text', page: 2, overlay: true },
      right: { kind: 'empty' },
      showChoices: true,
      choiceSpread: false,
    });
    // 放不下：末页只有正文，下一页是「上下文 + 选项」
    expect(spreadLayout(2, model(3, true, false)).showChoices).toBe(false);
    expect(spreadLayout(3, model(3, true, false))).toEqual({
      left: { kind: 'context' },
      right: { kind: 'choices' },
      showChoices: true,
      choiceSpread: true,
    });
  });

  it('PC 对开：奇数页正文时选项放末展右页', () => {
    expect(lastIndex(model(3, true, false, 2))).toBe(1);
    expect(spreadLayout(1, model(3, true, false, 2))).toEqual({
      left: { kind: 'text', page: 2, overlay: false },
      right: { kind: 'choices' },
      showChoices: true,
      choiceSpread: false,
    });
  });

  it('PC 对开：偶数页正文时选项优先接在右页正文下方，放不下才另起一展（左页给上下文）', () => {
    expect(lastIndex(model(4, true, true, 2))).toBe(1);
    expect(spreadLayout(1, model(4, true, true, 2)).right).toEqual({ kind: 'text', page: 3, overlay: true });
    expect(lastIndex(model(4, true, false, 2))).toBe(2);
    expect(spreadLayout(2, model(4, true, false, 2))).toEqual({
      left: { kind: 'context' },
      right: { kind: 'choices' },
      showChoices: true,
      choiceSpread: true,
    });
  });

  it('PC 对开：无选项时 4 页正文合成 2 展，奇数页末展右页留空', () => {
    expect(lastIndex(model(4, false, false, 2))).toBe(1);
    expect(lastIndex(model(3, false, false, 2))).toBe(1);
    expect(spreadLayout(1, model(3, false, false, 2)).right).toEqual({ kind: 'empty' });
  });
});

describe('阅读器分页：翻页决策', () => {
  it('段内向后翻走 local；末页有选项被挡住；末页无选项交给引擎', () => {
    expect(resolveTurn({ dir: 'next', index: 0, model: model(3), canRewind: false })).toEqual({
      kind: 'local',
      nextIndex: 1,
    });
    expect(resolveTurn({ dir: 'next', index: 2, model: model(3, true, true), canRewind: true })).toEqual({
      kind: 'blocked',
    });
    expect(resolveTurn({ dir: 'next', index: 2, model: model(3, true, false), canRewind: true })).toEqual({
      kind: 'local',
      nextIndex: 3,
    });
    expect(resolveTurn({ dir: 'next', index: 2, model: model(3), canRewind: true })).toEqual({
      kind: 'engine-next',
    });
  });

  it('段首往回：无历史被挡住，有历史交给引擎回退', () => {
    expect(resolveTurn({ dir: 'prev', index: 0, model: model(3), canRewind: false })).toEqual({ kind: 'blocked' });
    expect(resolveTurn({ dir: 'prev', index: 0, model: model(3), canRewind: true })).toEqual({ kind: 'engine-prev' });
    expect(resolveTurn({ dir: 'prev', index: 2, model: model(3), canRewind: false })).toEqual({
      kind: 'local',
      nextIndex: 1,
    });
  });
});

describe('阅读锚点：换字号 / 转屏 / 续读都落回同一处', () => {
  // 5 行正文排 3 页：第 1 行跨 0–1 页，第 3 行跨 1–2 页
  const map: LineMap = { first: [0, 0, 1, 1, 2], last: [0, 1, 1, 2, 2] };

  it('展序号与锚点可以互相还原', () => {
    for (const per of [1, 2]) {
      const m = model(3, false, false, per);
      for (let i = 0; i <= lastIndex(m); i++) {
        expect(anchorToIndex(indexToAnchor(i, m, map), m, map)).toBe(i);
      }
    }
  });

  it('段落跨页时用 offset 记住「续页」', () => {
    expect(indexToAnchor(1, model(3), map)).toEqual({ line: 1, offset: 1 });
    expect(anchorToIndex({ line: 1, offset: 1 }, model(3), map)).toBe(1);
    expect(anchorToIndex({ line: 1, offset: 0 }, model(3), map)).toBe(0);
  });

  it('窄屏的锚点换到 PC 对开时落在包含该页的那一展', () => {
    const anchor = indexToAnchor(2, model(3), map);
    expect(anchorToIndex(anchor, model(3, false, false, 2), map)).toBe(1);
  });

  it('start / end 分别落在第一展和最后一展（含独立选项页）', () => {
    expect(anchorToIndex('start', model(3, true, false), map)).toBe(0);
    expect(anchorToIndex('end', model(3, true, false), map)).toBe(3);
    expect(anchorToIndex('end', model(3, true, true), map)).toBe(2);
  });

  it('每展可见的首行 / 末行', () => {
    expect(spreadLines(1, model(3), map)).toEqual({ top: 1, bottom: 3 });
    expect(spreadLines(0, model(3, false, false, 2), map)).toEqual({ top: 0, bottom: 3 });
    expect(spreadLines(3, model(3, true, false), map)).toEqual({ top: 4, bottom: 4 });
    expect(spreadLines(0, model(1), { first: [], last: [] })).toBeNull();
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
