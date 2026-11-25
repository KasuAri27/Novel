/**
 * 效果应用：把 Effect[] 施加到状态上，返回新状态（不修改入参）。
 * immortal 角色会被 kill 拦截（如艾玛不可死亡）。
 */
import type { Effect, GameState, Story } from './types';
import { cloneState, relKey } from './state';

/** 应用一串效果，返回新状态。story 用于查 immortal 等元信息。 */
export function applyEffects(state: GameState, story: Story, effects: Effect[]): GameState {
  if (effects.length === 0) return state;
  const next = cloneState(state);
  for (const eff of effects) {
    applyOne(next, story, eff);
  }
  return next;
}

function applyOne(state: GameState, story: Story, eff: Effect): void {
  const [a, b] = eff.args;
  switch (eff.verb) {
    case 'know': {
      const set = state.knowledge[a] ?? (state.knowledge[a] = []);
      if (b && !set.includes(b)) set.push(b);
      break;
    }
    case 'forget': {
      const set = state.knowledge[a];
      if (set && b) state.knowledge[a] = set.filter((f) => f !== b);
      break;
    }
    case 'kill': {
      const ch = story.chars[a];
      // immortal 保护：不允许死亡
      if (ch && ch.immortal) break;
      state.alive[a] = false;
      break;
    }
    case 'spare': {
      state.alive[a] = true;
      break;
    }
    case 'set': {
      state.flags[a] = normalizeFlagValue(eff.value);
      break;
    }
    case 'rel': {
      const key = relKey(a, b);
      const delta = typeof eff.value === 'number' ? eff.value : Number(eff.value ?? 0);
      state.relationships[key] = (state.relationships[key] ?? 0) + delta;
      break;
    }
    case 'explore': {
      const delta = typeof eff.value === 'number' ? eff.value : Number(eff.value ?? 0);
      state.exploration[a] = (state.exploration[a] ?? 0) + delta;
      break;
    }
    default:
      // 未知动词：解析阶段已拦截，运行时忽略
      break;
  }
}

function normalizeFlagValue(v: Effect['value']): boolean | number | string {
  if (v === undefined) return true;
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    if (!Number.isNaN(n) && v.trim() !== '') return n;
    return v;
  }
  return true;
}
