/**
 * M3 内容冒烟测试：加载编译产物 story.json，用引擎从头模拟通关。
 * 目的：证明 19 选择 / 57 选项齐全，且第四章四条路由各自可达（四个结局）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/step';
import type { Story } from '../src/engine/types';

const story: Story = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'public', 'story', 'story.json'), 'utf8'),
);

/** 按给定按键序列（对应 E01…E19 的 A/B/C）自动通关，返回结局 id 与终局变量 */
function play(keys: string[]): { ending: string; vars: Record<string, number> } {
  const eng = createEngine(story);
  let state = eng.initialState();
  let pendingKey: string | null = null;
  let ci = 0;
  for (let guard = 0; guard < 500000; guard++) {
    const input = pendingKey
      ? ({ type: 'choose', key: pendingKey } as const)
      : ({ type: 'advance' } as const);
    pendingKey = null;
    const r = eng.step(state, input);
    state = r.state;
    let ended: string | null = null;
    for (const e of r.events) {
      if (e.type === 'showChoice') pendingKey = keys[ci++] ?? 'A';
      else if (e.type === 'ending') ended = e.id;
    }
    if (ended) return { ending: ended, vars: state.vars };
  }
  throw new Error('未能到达结局');
}

describe('story.json 内容', () => {
  it('章数、节点数、选择数、选项数正确', () => {
    expect(story.chapters.length).toBe(4);
    const nodeList = Object.values(story.nodes).filter((n) => !n.id.endsWith('__route'));
    expect(nodeList.length).toBe(27);
    const choiceNodes = nodeList.filter((n) => n.next.kind === 'choice');
    expect(choiceNodes.length).toBe(19);
    let opts = 0;
    for (const n of choiceNodes) if (n.next.kind === 'choice') opts += n.next.options.length;
    expect(opts).toBe(57);
  });

  it('起点与第一章首节一致', () => {
    expect(story.start).toBe('ch01_S1');
  });
});

describe('第四章四条路由各自可达', () => {
  // 依次对应 E01…E19
  const NO_CASE = ['A', 'A', 'A', 'C', 'B', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'C', 'A', 'A', 'A', 'A'];
  const ROUTE_3P = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'C', 'A', 'A', 'A', 'A', 'C', 'C', 'A', 'A', 'A'];
  const SHIRO = ['A', 'B', 'A', 'A', 'B', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'C', 'C', 'A', 'A', 'A', 'A'];
  const MERURU = ['A', 'A', 'A', 'A', 'B', 'A', 'A', 'A', 'C', 'A', 'A', 'A', 'A', 'B', 'B', 'A', 'A', 'A', 'A'];

  it('三把尺全满 → 无第一案（全员篇）', () => {
    const { ending, vars } = play(NO_CASE);
    expect(vars['hiro.explore']).toBeGreaterThanOrEqual(2);
    expect(vars['meruru.explore']).toBeGreaterThanOrEqual(2);
    expect(vars['reia.explore']).toBeGreaterThanOrEqual(2);
    expect(ending).toBe('END_ch04_no_case');
  });

  it('蕾雅尺不足 → 诺亚蕾雅案', () => {
    const { ending, vars } = play(ROUTE_3P);
    expect(vars['reia.explore']).toBeLessThan(2);
    expect(ending).toBe('END_ch04_3p');
  });

  it('希罗尺不足且蕾雅尺达标 → 希罗反杀案', () => {
    const { ending, vars } = play(SHIRO);
    expect(vars['reia.explore']).toBeGreaterThanOrEqual(2);
    expect(vars['hiro.explore']).toBeLessThan(2);
    expect(ending).toBe('END_ch04_shiro');
  });

  it('梅露露尺不足、其余达标 → 梅露露之死案', () => {
    const { ending, vars } = play(MERURU);
    expect(vars['hiro.explore']).toBeGreaterThanOrEqual(2);
    expect(vars['reia.explore']).toBeGreaterThanOrEqual(2);
    expect(vars['meruru.explore']).toBeLessThan(2);
    expect(ending).toBe('END_ch04_meruru');
  });
});
