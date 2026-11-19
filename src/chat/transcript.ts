/**
 * 聊天模式的会话逻辑（纯函数，无 DOM / React）。
 *
 * 复用小说引擎的 advance / choose：引擎负责「走到哪一行、哪个节点」，
 * 这里负责把每一步新露出的内容记成聊天记录（log），以及撤回上一个选择。
 *
 * 会话 = { state, log }，整份可 JSON 序列化，直接作为存档。
 */
import type { Choice, GameState, Story, StoryNode } from '../engine/types';
import { advance, availableChoices, choose } from '../engine/reducer';
import { createInitialState } from '../engine/state';
import { findEnding } from '../engine/ending';

/** 选项发出后的呈现方式 */
export type PickStyle =
  /** 普通选项：作为主角的气泡发出 */
  | 'say'
  /** （…）包裹：作为斜体小字的动作描写 */
  | 'act'
  /** 【…】包裹：只跳转，不在聊天记录里留下任何内容 */
  | 'silent';

/** 一条聊天记录 */
export type ChatEntry =
  /** 角色台词 → 气泡 */
  | { kind: 'say'; speaker: string; text: string }
  /** 动作 / 环境描写 → 斜体小字 */
  | { kind: 'narr'; text: string }
  /** 玩家的选择；h = 选择前的 history 长度，撤回时据此还原 */
  | { kind: 'pick'; style: PickStyle; text: string; h: number }
  /** 结局卡片 */
  | { kind: 'end'; id: string; title: string; text: string };

export interface ChatSession {
  state: GameState;
  log: ChatEntry[];
}

/** 当前停在哪种状态，决定底部栏显示什么 */
export type ChatStatus =
  /** 还有下一条，点一下继续 */
  | 'more'
  /** 等玩家选 */
  | 'choices'
  /** 有选项但条件全不满足（剧本问题，给作者看的提示） */
  | 'no-choices'
  /** 已命中结局 */
  | 'ended'
  /** 叶子节点但没有任何结局命中（剧本问题） */
  | 'dead-end';

const BRACKETS: Array<[string, string, PickStyle]> = [
  ['（', '）', 'act'],
  ['(', ')', 'act'],
  ['【', '】', 'silent'],
  ['[', ']', 'silent'],
];

/**
 * 解析选项文字：
 *   "你在这里做什么？"   → say，按钮与气泡都显示原文
 *   "（默默站到她身边）" → act，按钮显示原文，记录里显示去掉括号的斜体描写
 *   "【去图书室】"       → silent，按钮显示「去图书室」，记录里不留痕
 * 只有整句被同一对括号完整包住才算，"（笑）好啊" 仍是 say。
 */
export function classifyChoice(label: string): { style: PickStyle; text: string; button: string } {
  const t = label.trim();
  for (const [open, close, style] of BRACKETS) {
    if (t.length > 2 && t.startsWith(open) && t.endsWith(close)) {
      const inner = t.slice(open.length, -close.length).trim();
      // 中间又出现成对括号说明不是整句包裹，例如 "（笑）好啊（摆手）"
      if (inner.includes(open) || inner.includes(close)) break;
      return { style, text: inner, button: style === 'silent' ? inner : t };
    }
  }
  return { style: 'say', text: t, button: t };
}

/**
 * 把台词拆成「正文」与「（动作）」片段，供气泡内把动作渲染成斜体小字。
 * 例："（别过脸）……随你。" → [{act:'别过脸'}, {text:'……随你。'}]
 */
export type BubblePart = { act: boolean; text: string };
export function splitActions(text: string): BubblePart[] {
  const parts: BubblePart[] = [];
  const re = /（([^（）]*)）|\(([^()]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ act: false, text: text.slice(last, m.index) });
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (inner) parts.push({ act: true, text: inner });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ act: false, text: text.slice(last) });
  return parts.filter((p) => p.act || p.text.trim() !== '');
}

/** 自动分支：选项文字为 ▸ 时不显示给玩家，条件满足就直接走（与小说剧本同一写法） */
export function isAutoChoice(label: string): boolean {
  return label.trim() === '▸';
}

/** 主角的角色 id（没有声明 me 时返回 null） */
export function meId(story: Story): string | null {
  return Object.values(story.chars).find((c) => c.me)?.id ?? null;
}

function nodeOf(story: Story, state: GameState): StoryNode | null {
  return story.nodes[state.currentNodeId] ?? null;
}

/** 当前节点是否已全部露出（选项只在此时生效） */
function atEnd(story: Story, state: GameState): boolean {
  const node = nodeOf(story, state);
  return !!node && !state.ended && state.lineIndex >= node.lines.length - 1;
}

/** 当前应自动走的分支：按书写顺序取第一个条件满足的 ▸ 选项 */
function autoChoice(story: Story, state: GameState): Choice | null {
  if (!atEnd(story, state)) return null;
  return availableChoices(story, state).find((c) => isAutoChoice(c.label)) ?? null;
}

/** 把当前 lineIndex 指向的那一行转成聊天记录 */
function lineEntry(story: Story, state: GameState): ChatEntry | null {
  const node = nodeOf(story, state);
  const line = node?.lines[state.lineIndex];
  if (!line) return null;
  return line.speaker
    ? { kind: 'say', speaker: line.speaker, text: line.text }
    : { kind: 'narr', text: line.text };
}

function endEntry(story: Story, state: GameState): ChatEntry | null {
  if (!state.ended) return null;
  const e = findEnding(story, state.ended);
  return { kind: 'end', id: state.ended, title: e?.title ?? state.ended, text: e?.text ?? '' };
}

/**
 * 推进一步（不经过玩家选择）：节点内下一行 / 自动分支 / [goto] / 结局。
 * 走不动时返回原 state。
 */
function forward(story: Story, state: GameState): GameState {
  const auto = autoChoice(story, state);
  if (auto) return choose(state, story, auto.id);
  return advance(state, story);
}

/**
 * 跳过「没有正文」的过路节点（纯路由节点、空跳转），让玩家每次点击都能看到新内容。
 * 返回推进后的 state 与途中露出的记录（通常只有结局卡）。
 */
function settle(story: Story, state: GameState): { state: GameState; added: ChatEntry[] } {
  let cur = state;
  const added: ChatEntry[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const node = nodeOf(story, cur);
    if (!node || cur.ended || node.lines.length > 0) break;
    const next = forward(story, cur);
    if (next === cur) break; // 等玩家选，或叶子且无结局
    cur = next;
    const entry = cur.ended ? endEntry(story, cur) : lineEntry(story, cur);
    if (entry) added.push(entry);
  }
  return { state: cur, added };
}

/** 开局：入口节点的第一行直接露出 */
export function startChat(story: Story): ChatSession {
  const init = createInitialState(story);
  const first = lineEntry(story, init);
  const s = settle(story, init);
  return { state: s.state, log: [...(first ? [first] : []), ...s.added] };
}

/** 点一下：露出下一行 / 走自动分支 / 进入下一节点 / 结算结局 */
export function stepChat(story: Story, session: ChatSession): ChatSession {
  const next = forward(story, session.state);
  if (next === session.state) return session;
  const entry = next.ended ? endEntry(story, next) : lineEntry(story, next);
  const s = settle(story, next);
  return { state: s.state, log: [...session.log, ...(entry ? [entry] : []), ...s.added] };
}

/** 选择一个选项：先记下玩家发出的内容，再露出目标节点的第一行 */
export function pickChat(story: Story, session: ChatSession, choiceId: string): ChatSession {
  const choice = visibleChoices(story, session).find((c) => c.id === choiceId);
  if (!choice) return session;
  const next = choose(session.state, story, choiceId);
  if (next === session.state) return session;
  const { style, text } = classifyChoice(choice.label);
  const pick: ChatEntry = { kind: 'pick', style, text, h: session.state.history.length };
  const first = lineEntry(story, next);
  const s = settle(story, next);
  return { state: s.state, log: [...session.log, pick, ...(first ? [first] : []), ...s.added] };
}

/** 撤回最近一次选择：状态与聊天记录都回到选项出现时 */
export function undoChoice(session: ChatSession): ChatSession {
  let i = session.log.length - 1;
  while (i >= 0 && session.log[i].kind !== 'pick') i--;
  if (i < 0) return session;
  const pick = session.log[i] as Extract<ChatEntry, { kind: 'pick' }>;
  const snap = session.state.history[pick.h];
  if (!snap) return session;
  const state: GameState = { ...snap, history: session.state.history.slice(0, pick.h) };
  return { state, log: session.log.slice(0, i) };
}

export function canUndo(session: ChatSession): boolean {
  return session.log.some((e) => e.kind === 'pick');
}

/** 当前节点已全部露出时给玩家看的选项（不含 ▸ 自动分支；未露完时为空） */
export function visibleChoices(story: Story, session: ChatSession): Choice[] {
  if (!atEnd(story, session.state)) return [];
  return availableChoices(story, session.state).filter((c) => !isAutoChoice(c.label));
}

export function chatStatus(story: Story, session: ChatSession): ChatStatus {
  const { state } = session;
  if (state.ended) return 'ended';
  const node = nodeOf(story, state);
  if (!node) return 'dead-end';
  if (state.lineIndex < node.lines.length - 1) return 'more';
  if (node.choices.length > 0) {
    if (autoChoice(story, state)) return 'more';
    return visibleChoices(story, session).length > 0 ? 'choices' : 'no-choices';
  }
  if (node.next) return 'more';
  // 叶子：试推一步，能结算结局就还算 more（下一次点击出结局卡）
  return advance(state, story) === state ? 'dead-end' : 'more';
}

/** 存档能否套用到当前剧本（剧本改过、节点没了就作废） */
export function isSessionValid(story: Story, session: unknown): session is ChatSession {
  if (!session || typeof session !== 'object') return false;
  const s = session as ChatSession;
  return (
    !!s.state &&
    Array.isArray(s.log) &&
    s.state.storyId === story.meta.id &&
    !!story.nodes[s.state.currentNodeId]
  );
}
