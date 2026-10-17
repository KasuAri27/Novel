/**
 * M4 校验测试：check-story.ts 对坏数据要能逐个报出来。
 * 另对真实编译产物 public/story/story.json 做回归（当前应为 0 问题）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStory, summarize, type CheckMeta } from '../scripts/check-story';
import { parseExpr } from '../src/engine/expr';
import type { Block, Option, Story } from '../src/engine/types';

/** 最小可通关故事：三节点单线，末节点收成结局 END_1 */
function makeStory(): Story {
  const text = (s: string): Block => ({ type: 'text', text: s });
  return {
    version: 1,
    start: 'ch01_S1',
    vars: { 'a.x': { min: 0, max: 3, init: 0 }, 'b.x': { min: 0, max: 3, init: 0 } },
    facts: {},
    nodes: {
      ch01_S1: {
        id: 'ch01_S1',
        chapter: 1,
        title: '第一节',
        blocks: [text('开场。')],
        next: { kind: 'goto', to: 'ch01_S2' },
      },
      ch01_S2: {
        id: 'ch01_S2',
        chapter: 1,
        title: '第二节',
        blocks: [text('中段。')],
        next: { kind: 'goto', to: 'ch01_S3' },
      },
      ch01_S3: {
        id: 'ch01_S3',
        chapter: 1,
        title: '终节',
        blocks: [text('收尾。')],
        next: { kind: 'ending', id: 'END_1' },
      },
    },
    chapters: [
      { n: 1, title: '测试章', file: 'story/chapters/ch01.md', nodes: ['ch01_S1', 'ch01_S2', 'ch01_S3'] },
    ],
  };
}

/** 从 story 自身推 CheckMeta（假定 logic 与 md 一致、字数正常） */
function makeMeta(story: Story): CheckMeta {
  const logicChoiceIds: string[] = [];
  const logicChoiceKeys: Record<string, string[]> = {};
  for (const n of Object.values(story.nodes)) {
    if (n.next.kind === 'choice') {
      logicChoiceIds.push(n.next.id);
      logicChoiceKeys[n.next.id] = n.next.options.map((o) => o.key);
    }
  }
  const chapterChars: Record<number, number> = {};
  for (const c of story.chapters) chapterChars[c.n] = 22000;
  return { parsedNodeIds: Object.keys(story.nodes), logicChoiceIds, logicChoiceKeys, chapterChars };
}

/** 在 ch01_S2 处放一个三选项选择（回响完整、都有去向），供选择同步/效果校验用 */
function makeChoiceStory(): Story {
  const story = makeStory();
  story.nodes['ch01_S2']!.next = {
    kind: 'choice',
    id: 'E01',
    prompt: '你决定——',
    options: (['A', 'B', 'C'] as const).map(
      (key): Option => ({
        key,
        text: `选项 ${key}`,
        echo: [{ type: 'text', text: `回响 ${key}` }],
        effects: [],
        to: 'ch01_S3',
      }),
    ),
  };
  return story;
}

describe('checkStory 坏数据', () => {
  it('最小数据没有任何 problems', () => {
    const story = makeStory();
    expect(checkStory(story, makeMeta(story)).problems).toEqual([]);
  });

  it('goto 指向不存在的节点', () => {
    const story = makeStory();
    story.nodes['ch01_S2']!.next = { kind: 'goto', to: 'ch01_NOPE' };
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('ch01_NOPE'))).toBe(true);
  });

  it('选项效果引用未声明变量', () => {
    const story = makeChoiceStory();
    const node = story.nodes['ch01_S2']!;
    if (node.next.kind !== 'choice') throw new Error('测试数据不对');
    node.next.options[0]!.effects = [{ var: 'nope.x', add: 1 }];
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('nope.x'))).toBe(true);
  });

  it('路由条件引用未声明变量', () => {
    const story = makeStory();
    story.nodes['ch01_S2']!.next = {
      kind: 'route',
      rules: [{ when: parseExpr('nope.x >= 1'), to: 'ch01_S3' }],
      else: 'ch01_S3',
    };
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('nope.x'))).toBe(true);
  });

  it('节点 id 重复', () => {
    const story = makeStory();
    const meta = makeMeta(story);
    meta.parsedNodeIds = ['ch01_S1', 'ch01_S2', 'ch01_S2', 'ch01_S3'];
    const { problems } = checkStory(story, meta);
    expect(problems.some((p) => p.includes('重复') && p.includes('ch01_S2'))).toBe(true);
  });

  it('md 里的选择在 logic.yaml 缺条目', () => {
    const story = makeChoiceStory();
    const meta = makeMeta(story);
    meta.logicChoiceIds = [];
    meta.logicChoiceKeys = {};
    const { problems } = checkStory(story, meta);
    expect(problems.some((p) => p.includes('E01') && p.includes('没有条目'))).toBe(true);
  });

  it('logic.yaml 里的选择在 md 里找不到', () => {
    const story = makeChoiceStory();
    const meta = makeMeta(story);
    meta.logicChoiceIds.push('E99');
    const { problems } = checkStory(story, meta);
    expect(problems.some((p) => p.includes('E99'))).toBe(true);
  });

  it('logic.yaml 与 md 的选项键不一致', () => {
    const story = makeChoiceStory();
    const meta = makeMeta(story);
    meta.logicChoiceKeys['E01'] = ['A', 'B', 'D'];
    const { problems } = checkStory(story, meta);
    expect(problems.some((p) => p.includes('缺选项 C'))).toBe(true);
    expect(problems.some((p) => p.includes('选项 D 在 md 里不存在'))).toBe(true);
  });

  it('孤立节点', () => {
    const story = makeStory();
    story.nodes['END_9'] = {
      id: 'END_9',
      chapter: 1,
      title: '',
      blocks: [],
      next: { kind: 'ending', id: 'END_9' },
    };
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('END_9') && p.includes('孤立'))).toBe(true);
  });

  it('走不到结局的死胡同（环）', () => {
    const story = makeStory();
    story.nodes['ch01_S2']!.next = { kind: 'goto', to: 'ch01_S1' };
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('死胡同'))).toBe(true);
  });

  it('路由漏条件判失败、重叠只提示', () => {
    const story = makeStory();
    story.nodes['ch01_S2']!.next = {
      kind: 'route',
      rules: [
        { when: parseExpr('a.x >= 2'), to: 'ch01_S3' },
        { when: parseExpr('b.x >= 2'), to: 'ch01_S3' },
      ],
      else: 'ch01_S3',
    };
    const { problems, warnings } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('不命中任何规则'))).toBe(true);
    expect(warnings.some((w) => w.includes('同时命中多条规则'))).toBe(true);
  });

  it('章节字数差太多只提示', () => {
    const story = makeStory();
    const meta = makeMeta(story);
    meta.chapterChars = { 1: 5000 };
    const { problems, warnings } = checkStory(story, meta);
    expect(problems).toEqual([]);
    expect(warnings.some((w) => w.includes('第 1 章'))).toBe(true);
  });

  it('summarize 输出统计行', () => {
    const story = makeStory();
    const lines = summarize(story, makeMeta(story));
    expect(lines.some((l) => l.startsWith('节点数：'))).toBe(true);
    expect(lines.some((l) => l.startsWith('各章字数：'))).toBe(true);
  });
});

describe('真实 story.json 回归', () => {
  const load = (): Story =>
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'public', 'story', 'story.json'), 'utf8'),
    ) as Story;

  it('当前编译产物没有真问题', () => {
    const story = load();
    expect(checkStory(story, makeMeta(story)).problems).toEqual([]);
  });

  it('把某个选项效果改成未声明变量能被抓出来', () => {
    const story = load();
    let target: { var: string } | null = null;
    outer: for (const n of Object.values(story.nodes)) {
      if (n.next.kind !== 'choice') continue;
      for (const o of n.next.options) {
        for (const e of o.effects) {
          if ('var' in e) {
            target = e;
            break outer;
          }
        }
      }
    }
    expect(target).not.toBeNull();
    target!.var = 'bogus.x';
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.some((p) => p.includes('bogus.x'))).toBe(true);
  });

  it('删掉起始节点会被抓出来', () => {
    const story = load();
    delete story.nodes['ch01_S1'];
    const { problems } = checkStory(story, makeMeta(story));
    expect(problems.length).toBeGreaterThan(0);
  });
});
