/**
 * 结局判定：纯数据驱动。
 * 到达叶子节点（无选项、无自动跳转）时，遍历 endings，
 * 用 when 条件对当前 GameState 求值，取命中且 priority 最大者。
 * 「雪是否登场」等规则全部写在剧情数据里，引擎不内置任何具体规则。
 */
import type { Ending, GameState, Story } from './types';
import { evalCondition } from './conditions';

/** 返回当前状态下命中的结局（无则 null） */
export function resolveEnding(state: GameState, story: Story): Ending | null {
  let best: Ending | null = null;
  for (const ending of story.endings) {
    if (!evalCondition(state, ending.when)) continue;
    if (!best || ending.priority > best.priority) {
      best = ending;
    }
  }
  return best;
}

/** 按 id 查找结局 */
export function findEnding(story: Story, id: string): Ending | null {
  return story.endings.find((e) => e.id === id) ?? null;
}
