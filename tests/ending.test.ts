import { describe, it, expect } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';
import { createInitialState } from '../src/core/engine/state';
import { resolveEnding } from '../src/core/engine/ending';
import type { GameState } from '../src/core/engine/types';

const DSL = [
  '@story id=e title=E',
  '@char 艾玛 immortal',
  '@char 雪',
  '@fact 真相',
  '@node n',
  '艾玛> 只有一个节点。',
  '@end END_truth priority=100 when alive(艾玛) && knows(艾玛, 真相) && explore(雪) >= 3',
  '  title 和解线',
  '@end END_rule priority=50 when alive(艾玛) && knows(艾玛, 真相)',
  '  title 知晓线',
  '@end END_open priority=1 when alive(艾玛)',
  '  title 开放线',
].join('\n');

function story() {
  return compileStory(DSL).stories[0];
}

/** 基于初始状态手工拼装字段，专注验证结局判定 */
function stateWith(patch: Partial<GameState>): GameState {
  return { ...createInitialState(story()), ...patch };
}

describe('ending: 信息差 + 探索度 -> 优先级判定', () => {
  it('空状态命中最低优先级「开放线」', () => {
    const e = resolveEnding(stateWith({}), story());
    expect(e?.id).toBe('END_open');
  });

  it('仅知晓真相命中「知晓线」', () => {
    const st = stateWith({ knowledge: { 艾玛: ['真相'], 雪: [] } });
    expect(resolveEnding(st, story())?.id).toBe('END_rule');
  });

  it('知晓真相且探索度达标命中最高优先级「和解线」', () => {
    const st = stateWith({
      knowledge: { 艾玛: ['真相'], 雪: [] },
      exploration: { 雪: 3 },
    });
    expect(resolveEnding(st, story())?.id).toBe('END_truth');
  });

  it('探索度不足则退回到「知晓线」', () => {
    const st = stateWith({
      knowledge: { 艾玛: ['真相'], 雪: [] },
      exploration: { 雪: 2 },
    });
    expect(resolveEnding(st, story())?.id).toBe('END_rule');
  });
});
