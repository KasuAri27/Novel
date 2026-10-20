import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/step';
import { parseExpr } from '../src/engine/expr';
import type { Event, Story } from '../src/engine/types';

function makeStory(): Story {
  return {
    version: 1,
    start: 'c1a',
    vars: { 'hiro.explore': { min: 0, max: 3, init: 0 } },
    facts: {},
    chapters: [
      { n: 1, title: '第一章　开端', file: 'ch01.md', nodes: ['c1a', 'c1b'] },
      { n: 2, title: '第二章　审判', file: 'ch02.md', nodes: ['c2a', 'c2b', 'c2end'] },
    ],
    nodes: {
      c1a: {
        id: 'c1a',
        chapter: 1,
        title: '开场',
        blocks: [
          { type: 'text', text: 'A1' },
          { type: 'text', text: 'A2' },
        ],
        next: { kind: 'goto', to: 'c1b' },
      },
      c1b: {
        id: 'c1b',
        chapter: 1,
        title: '选择',
        blocks: [{ type: 'text', text: 'B1' }],
        next: {
          kind: 'choice',
          id: 'E01',
          prompt: '你决定——',
          options: [
            {
              key: 'A',
              text: '加一',
              echo: [{ type: 'text', text: 'echoA' }],
              effects: [{ var: 'hiro.explore', add: 1 }],
              to: 'c2a',
            },
            { key: 'B', text: '不加', echo: [], effects: [], to: 'c2b' },
          ],
        },
      },
      c2a: {
        id: 'c2a',
        chapter: 2,
        title: '路由',
        blocks: [{ type: 'text', text: 'C1' }],
        next: {
          kind: 'route',
          rules: [{ when: parseExpr('hiro.explore >= 2'), to: 'c2end' }],
          else: 'c2b',
        },
      },
      c2b: {
        id: 'c2b',
        chapter: 2,
        title: '普通',
        blocks: [{ type: 'text', text: 'D1' }],
        next: { kind: 'goto', to: 'c2end' },
      },
      c2end: {
        id: 'c2end',
        chapter: 2,
        title: '结局',
        blocks: [{ type: 'text', text: 'Z' }],
        next: { kind: 'ending', id: 'END1' },
      },
    },
  };
}

function texts(events: Event[]): string[] {
  return events.filter((e) => e.type === 'say').map((e) => (e as { text: string }).text);
}
function types(events: Event[]): string[] {
  return events.map((e) => e.type);
}

describe('引擎 step 基本推进', () => {
  it('开局进入 start：先发章标题，再发第一段', () => {
    const eng = createEngine(makeStory());
    const r = eng.step(eng.initialState(), { type: 'advance' });
    expect(types(r.events)).toEqual(['chapterTitle', 'say']);
    expect(texts(r.events)).toEqual(['A1']);
    expect(r.state.cursor).toBe(1);
    expect(r.state.nodeId).toBe('c1a');
  });

  it('逐段推进，段落走完后按 goto 跳转', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    let r = eng.step(s, { type: 'advance' }); // A1
    s = r.state;
    r = eng.step(s, { type: 'advance' }); // A2
    expect(texts(r.events)).toEqual(['A2']);
    s = r.state;
    r = eng.step(s, { type: 'advance' }); // goto c1b → B1（同章，不再发标题）
    expect(types(r.events)).toEqual(['say']);
    expect(texts(r.events)).toEqual(['B1']);
    expect(r.state.nodeId).toBe('c1b');
  });

  it('段落走完后进入选择点，发出 showChoice', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    s = eng.step(s, { type: 'advance' }).state; // A1
    s = eng.step(s, { type: 'advance' }).state; // A2
    s = eng.step(s, { type: 'advance' }).state; // B1
    const r = eng.step(s, { type: 'advance' }); // showChoice
    expect(types(r.events)).toEqual(['showChoice']);
    const ev = r.events[0];
    if (ev.type !== 'showChoice') throw new Error('bad');
    expect(ev.id).toBe('E01');
    expect(ev.options.map((o) => o.key)).toEqual(['A', 'B']);
  });

  it('进入带背景的节点会发 setBackground（章节标题之后、正文之前）', () => {
    const story = makeStory();
    story.nodes.c1a!.bg = 'cell_day';
    const eng = createEngine(story);
    const r = eng.step(eng.initialState(), { type: 'advance' });
    expect(types(r.events)).toEqual(['chapterTitle', 'setBackground', 'say']);
    const ev = r.events.find((e) => e.type === 'setBackground');
    if (ev?.type !== 'setBackground') throw new Error('bad');
    expect(ev.id).toBe('cell_day');
  });
});

describe('选择、效果与路由', () => {
  it('选 A：加变量、播回响、进入下一节点并换章', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state; // 到选择点
    const r = eng.step(s, { type: 'choose', key: 'A' });
    expect(types(r.events)).toEqual(['showEcho', 'chapterTitle', 'say']);
    expect(r.state.vars['hiro.explore']).toBe(1);
    expect(r.state.history).toEqual([{ choiceId: 'E01', key: 'A' }]);
    expect(r.state.nodeId).toBe('c2a');
  });

  it('路由：变量不足走 else', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state;
    s = eng.step(s, { type: 'choose', key: 'A' }).state; // c2a, hiro=1
    const r = eng.step(s, { type: 'advance' }); // C1 走完 → route → c2b
    expect(r.state.nodeId).toBe('c2b');
    expect(texts(r.events)).toEqual(['D1']);
  });

  it('路由：变量达标走规则分支，最终到结局', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state;
    s = eng.step(s, { type: 'choose', key: 'A' }).state; // c2a, hiro=1
    s.vars['hiro.explore'] = 2; // 手动拉满，模拟前面章节累计
    s = eng.step(s, { type: 'advance' }).state; // C1 → route → c2end
    expect(s.nodeId).toBe('c2end');
    const r = eng.step(s, { type: 'advance' }); // Z → ending
    expect(types(r.events)).toEqual(['ending']);
    expect((r.events[0] as { id: string }).id).toBe('END1');
  });

  it('效果夹在 min/max 内', () => {
    const story = makeStory();
    story.nodes.c1b.next = {
      kind: 'choice',
      id: 'E01',
      prompt: 'x',
      options: [{ key: 'A', text: '加很多', echo: [], effects: [{ var: 'hiro.explore', add: 99 }], to: 'c2b' }],
    };
    const eng = createEngine(story);
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state;
    const r = eng.step(s, { type: 'choose', key: 'A' });
    expect(r.state.vars['hiro.explore']).toBe(3);
  });

  it('选不存在的选项要报错', () => {
    const eng = createEngine(makeStory());
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state;
    expect(() => eng.step(s, { type: 'choose', key: 'Z' })).toThrow(/选项不存在/);
  });
});

describe('存档 / 读档 / 回退', () => {
  function toChoice(eng: ReturnType<typeof createEngine>) {
    let s = eng.initialState();
    for (let i = 0; i < 4; i++) s = eng.step(s, { type: 'advance' }).state;
    return s;
  }

  it('存档读档：哈希一致时原样恢复', () => {
    const eng = createEngine(makeStory());
    const s = eng.step(toChoice(eng), { type: 'choose', key: 'A' }).state;
    const data = eng.save(s);
    const r = eng.load(data);
    expect(r.warned).toBe(false);
    expect(r.state).toEqual(s);
  });

  it('读档：哈希不符时用 history 重放并告警', () => {
    const eng = createEngine(makeStory());
    const s = eng.step(toChoice(eng), { type: 'choose', key: 'A' }).state;
    const data = eng.save(s);
    data.storyHash = 'deadbeef'; // 模拟剧情更新
    const r = eng.load(data);
    expect(r.warned).toBe(true);
    expect(r.state.vars['hiro.explore']).toBe(1);
    expect(r.state.history).toEqual([{ choiceId: 'E01', key: 'A' }]);
    expect(r.state.nodeId).toBe('c2a');
  });

  it('回退：去掉最后一个选择后重放回到选择点', () => {
    const eng = createEngine(makeStory());
    const s = eng.step(toChoice(eng), { type: 'choose', key: 'A' }).state;
    const back = eng.rewind(s);
    expect(back.history).toEqual([]);
    expect(back.vars['hiro.explore']).toBe(0);
    expect(back.nodeId).toBe('c1b');
  });
});
