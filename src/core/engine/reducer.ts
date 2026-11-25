/**
 * 引擎推进器：全部为纯函数（入参 state 不被修改），便于存档/回退/测试。
 * UI 只需按动作调用这些函数并渲染返回的新 state。
 */
import type { Choice, GameState, Line, Story, StoryNode } from './types';
import { applyEffects } from './effects';
import { evalCondition } from './conditions';
import { resolveEnding } from './ending';
import { cloneState, createInitialState, snapshot } from './state';

/** 取当前节点（可能不存在，调用方需容错） */
export function getNode(story: Story, state: GameState): StoryNode | null {
  return story.nodes[state.currentNodeId] ?? null;
}

/** 当前可见的对话行（依 lineIndex），无则 null */
export function currentLine(story: Story, state: GameState): Line | null {
  const node = getNode(story, state);
  if (!node || node.lines.length === 0) return null;
  const idx = Math.min(state.lineIndex, node.lines.length - 1);
  return node.lines[idx] ?? null;
}

/** 当前节点里所有条件通过、可展示的选项 */
export function availableChoices(story: Story, state: GameState): Choice[] {
  const node = getNode(story, state);
  if (!node) return [];
  return node.choices.filter((c) => evalCondition(state, c.when));
}

/** 是否已展示完当前节点的全部文本 */
function atNodeEnd(state: GameState, node: StoryNode): boolean {
  return state.lineIndex >= node.lines.length - 1 || node.lines.length === 0;
}

/** 记录一步历史（在变更前），返回可继续修改的克隆 */
function step(state: GameState): GameState {
  const base = cloneState(state);
  base.history = [...state.history, snapshot(state)];
  return base;
}

/** 进入目标节点：应用 onEnter 效果、重置行指针 */
function enterNode(state: GameState, story: Story, nodeId: string): GameState {
  const target = story.nodes[nodeId];
  let next = cloneState(state);
  next.currentNodeId = nodeId;
  next.lineIndex = 0;
  if (target) next = applyEffects(next, story, target.onEnter);
  return next;
}

/** 前进：逐行显示 → 到节点末后按 next 推进 / 等待选择 / 叶子结算结局 */
export function advance(state: GameState, story: Story): GameState {
  if (state.ended) return state;
  const node = getNode(story, state);
  if (!node) return state;

  if (!atNodeEnd(state, node)) {
    const base = step(state);
    base.lineIndex = state.lineIndex + 1;
    return base;
  }

  // 已在节点末尾：有选项则等待玩家选择
  if (node.choices.length > 0) return state;

  if (node.next && story.nodes[node.next]) {
    const base = step(state);
    return enterNode(base, story, node.next);
  }

  // 叶子节点：结算结局
  const ending = resolveEnding(state, story);
  if (ending) {
    const base = cloneState(state);
    base.ended = ending.id;
    return base;
  }
  return state;
}

/** 选择一个选项：应用效果 → 跳转到 goto 节点 */
export function choose(state: GameState, story: Story, choiceId: string): GameState {
  if (state.ended) return state;
  const node = getNode(story, state);
  if (!node) return state;
  const choice = node.choices.find((c) => c.id === choiceId);
  // 仅允许选择当前可见（条件通过）的选项
  if (!choice || !evalCondition(state, choice.when)) return state;

  const base = step(state);
  const afterEffects = applyEffects(base, story, choice.do);
  return enterNode(afterEffects, story, choice.goto);
}

/**
 * 小说阅读模式：以「整个节点为一页」进行翻页。
 * 有选项的节点不在此推进（交由选项页选择）；否则按 [goto] 进入下一节点，
 * 叶子节点则直接结算结局。lineIndex 固定置末，表示整页已展示。
 */
export function nextPage(state: GameState, story: Story): GameState {
  if (state.ended) return state;
  const node = getNode(story, state);
  if (!node) return state;
  if (node.choices.length > 0) return state; // 需从选项页推进

  const base = step(state);
  if (node.next && story.nodes[node.next]) {
    const entered = enterNode(base, story, node.next);
    const target = story.nodes[entered.currentNodeId];
    if (target) entered.lineIndex = Math.max(0, target.lines.length - 1);
    return entered;
  }
  const ending = resolveEnding(state, story);
  if (ending) {
    base.ended = ending.id;
    return base;
  }
  return base;
}

/** 回退一步（消费历史栈） */
export function rewind(state: GameState): GameState {
  const last = state.history[state.history.length - 1];
  if (!last) return state;
  const restored: GameState = { ...last, history: state.history.slice(0, -1) };
  return restored;
}

/** 重开：回到初始状态 */
export function restart(story: Story): GameState {
  return createInitialState(story);
}

/**
 * 统一动作入口（方便 store 调用）。
 */
export function reduce(
  state: GameState,
  story: Story,
  action:
    | { type: 'advance' }
    | { type: 'choose'; choiceId: string }
    | { type: 'rewind' }
    | { type: 'restart' },
): GameState {
  switch (action.type) {
    case 'advance':
      return advance(state, story);
    case 'choose':
      return choose(state, story, action.choiceId);
    case 'rewind':
      return rewind(state);
    case 'restart':
      return restart(story);
    default:
      return state;
  }
}
