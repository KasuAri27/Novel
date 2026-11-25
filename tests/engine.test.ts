import { describe, it, expect } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';
import { createInitialState, knowsFact } from '../src/core/engine/state';
import { availableChoices, advance, choose, currentLine, nextPage, rewind } from '../src/core/engine/reducer';
import { applyEffects } from '../src/core/engine/effects';

const DSL = [
  '@story id=t title=T',
  '@char 艾玛 immortal',
  '@char 梅露露',
  '@fact f_secret',
  '@node n0',
  '艾玛> 起点。',
  '艾玛> 第二行。',
  '[choice] 揭示真相 -> n_gate do know(艾玛, f_secret)',
  '@node n_gate',
  '艾玛> 一扇门。',
  '[choice] 知情才见 -> n_end when knows(艾玛, f_secret)',
  '[choice] 未知才见 -> n_end when !knows(艾玛, f_secret)',
  '@node n_end',
  '艾玛> 结束。',
  '@end E1 priority=1 when alive(艾玛)',
].join('\n');

function story() {
  const s = compileStory(DSL).stories[0];
  expect(s).toBeDefined();
  return s;
}

describe('engine: 信息差门控与推进', () => {
  it('逐行显示：advance 递增 lineIndex', () => {
    const st = story();
    let state = createInitialState(st);
    expect(currentLine(st, state)?.text).toBe('起点。');
    state = advance(state, st);
    expect(currentLine(st, state)?.text).toBe('第二行。');
  });

  it('未知情时只显示「未知才见」选项', () => {
    const st = story();
    const state = createInitialState(st);
    // 直接构造位于 n_gate 的状态
    const atGate = { ...state, currentNodeId: 'n_gate' };
    const labels = availableChoices(st, atGate).map((c) => c.label);
    expect(labels).toContain('未知才见');
    expect(labels).not.toContain('知情才见');
  });

  it('选择「揭示真相」后授予知识，门控翻转为「知情才见」', () => {
    const st = story();
    let state = createInitialState(st);
    const reveal = availableChoices(st, state).find((c) => c.label === '揭示真相');
    expect(reveal).toBeDefined();
    state = choose(state, st, reveal!.id);
    expect(state.currentNodeId).toBe('n_gate');
    expect(knowsFact(state, '艾玛', 'f_secret')).toBe(true);
    const labels = availableChoices(st, state).map((c) => c.label);
    expect(labels).toContain('知情才见');
    expect(labels).not.toContain('未知才见');
  });

  it('immortal 角色 kill 被拦截，普通角色可死亡', () => {
    const st = story();
    let state = createInitialState(st);
    state = applyEffects(state, st, [{ verb: 'kill', args: ['艾玛'] }]);
    expect(state.alive['艾玛']).toBe(true); // immortal 保护
    state = applyEffects(state, st, [{ verb: 'kill', args: ['梅露露'] }]);
    expect(state.alive['梅露露']).toBe(false);
  });

  it('回退可恢复到选择之前的状态', () => {
    const st = story();
    const before = createInitialState(st);
    const reveal = availableChoices(st, before).find((c) => c.label === '揭示真相')!;
    const after = choose(before, st, reveal.id);
    expect(after.currentNodeId).toBe('n_gate');
    expect(after.history.length).toBeGreaterThan(0);
    const back = rewind(after);
    expect(back.currentNodeId).toBe('n0');
  });
});

describe('engine: 小说模式整页翻页 nextPage', () => {
  it('含选项的节点不会被 nextPage 推进（交由选项页）', () => {
    const st = story();
    const state = createInitialState(st);
    expect(state.currentNodeId).toBe('n0');
    const after = nextPage(state, st);
    expect(after.currentNodeId).toBe('n0'); // 未变
  });

  it('叶子节点 nextPage 触发结局结算', () => {
    const st = story();
    const atLeaf = { ...createInitialState(st), currentNodeId: 'n_end' };
    const after = nextPage(atLeaf, st);
    expect(after.ended).toBe('E1');
  });
});
