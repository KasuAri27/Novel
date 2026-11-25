/**
 * GameState 工厂与只读辅助。
 */
import type { CharId, GameState, Story } from './types';

/** 关系档位键：按字典序归一，保证 rel(A,B) 与 rel(B,A) 同键 */
export function relKey(a: CharId, b: CharId): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** 判断角色是否存活（缺省视为存活） */
export function isAlive(state: GameState, id: CharId): boolean {
  return state.alive[id] !== false;
}

/** 判断某角色是否已知某事实 */
export function knowsFact(state: GameState, who: CharId, fact: string): boolean {
  const set = state.knowledge[who];
  return !!set && set.includes(fact);
}

/** 从 Story 生成初始状态：所有角色存活、探索度/关系为 0、知识为空 */
export function createInitialState(story: Story): GameState {
  const knowledge: Record<CharId, string[]> = {};
  const alive: Record<CharId, boolean> = {};
  for (const id of Object.keys(story.chars)) {
    knowledge[id] = [];
    alive[id] = true;
  }
  return {
    storyId: story.meta.id,
    currentNodeId: story.entry,
    knowledge,
    alive,
    flags: {},
    relationships: {},
    exploration: {},
    history: [],
    ended: null,
    lineIndex: 0,
  };
}

/** 深拷贝状态（历史快照、 reducer 纯函数需要） */
export function cloneState(state: GameState): GameState {
  return {
    storyId: state.storyId,
    currentNodeId: state.currentNodeId,
    knowledge: mapValues(state.knowledge, (arr) => arr.slice()),
    alive: { ...state.alive },
    flags: { ...state.flags },
    relationships: { ...state.relationships },
    exploration: { ...state.exploration },
    history: state.history,
    ended: state.ended,
    lineIndex: state.lineIndex,
  };
}

/** 剥离 history，生成可入栈的快照 */
export function snapshot(state: GameState): Omit<GameState, 'history'> {
  const { history: _history, ...rest } = cloneState(state);
  return rest;
}

function mapValues<T, R>(obj: Record<string, T>, fn: (v: T) => R): Record<string, R> {
  const out: Record<string, R> = {};
  for (const k of Object.keys(obj)) out[k] = fn(obj[k]);
  return out;
}
