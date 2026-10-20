/**
 * 引擎核心：step(state, input) → { state, events }。
 * 纯逻辑，不碰 DOM；不修改传入的 state（内部先深拷贝）。
 * 条件表达式由 expr.ts 解释执行，全程不使用 eval / new Function。
 */
import type {
  Block,
  Effect,
  EngineInput,
  EngineState,
  Event,
  HistoryEntry,
  Node,
  SaveData,
  Story,
} from './types';
import { evalExpr } from './expr';
import { clampVar, initVars } from './vars';

const SAVE_VERSION = 1;
const MAX_HOPS = 1000;

/** 剧情哈希：story.json 一变就变，用来判断旧存档能否直接复用 */
export function hashStory(story: Story): string {
  const text = JSON.stringify(story);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function relKey(a: string, b: string): string {
  return `${a}|${b}`;
}
function factKey(who: string, fact: string): string {
  return `${who}\u0000${fact}`;
}
function sayOf(b: Block): Event {
  return b.speaker ? { type: 'say', text: b.text, speaker: b.speaker } : { type: 'say', text: b.text };
}

export interface Engine {
  initialState(): EngineState;
  step(state: EngineState, input: EngineInput): { state: EngineState; events: Event[] };
  save(state: EngineState): SaveData;
  /** 读档：storyHash 不符时用 history 重放恢复，并置 warned=true */
  load(data: SaveData): { state: EngineState; warned: boolean };
  /** 回退上一个选择：去掉 history 最后一项后重放 */
  rewind(state: EngineState): EngineState;
}

export function createEngine(story: Story): Engine {
  const storyHash = hashStory(story);
  const chapterTitleOf = (n: number): string => story.chapters.find((c) => c.n === n)?.title ?? '';

  function initialState(): EngineState {
    return {
      nodeId: '',
      cursor: 0,
      vars: initVars(story.vars),
      facts: {},
      rels: {},
      history: [],
    };
  }

  /** 应用一组效果（变量夹在 vars.yaml 的 min/max 内） */
  function applyEffects(s: EngineState, effects: Effect[]): void {
    for (const eff of effects) {
      if ('var' in eff) {
        const def = story.vars[eff.var];
        if (!def) throw new Error(`效果引用了未声明的变量：${eff.var}`);
        let v = s.vars[eff.var] ?? def.init;
        if (eff.set !== undefined) v = eff.set;
        if (eff.add !== undefined) v += eff.add;
        s.vars[eff.var] = clampVar(story.vars, eff.var, v);
      } else if ('rel' in eff) {
        const k = relKey(eff.rel[0], eff.rel[1]);
        s.rels[k] = (s.rels[k] ?? 0) + eff.add;
      } else {
        s.facts[factKey(eff.know, eff.fact)] = true;
      }
    }
  }

  function choiceEvent(node: Node): Event {
    const nx = node.next;
    if (nx.kind !== 'choice') throw new Error('内部错误：节点不是选择点');
    return {
      type: 'showChoice',
      id: nx.id,
      prompt: nx.prompt,
      options: nx.options.map((o) => ({ key: o.key, text: o.text })),
    };
  }

  /** 进入某节点：换章时补 chapterTitle，有正文则先推第一段 */
  function enter(s: EngineState, nodeId: string, events: Event[], depth: number): void {
    if (depth > MAX_HOPS) throw new Error('节点跳转陷入循环（超过 1000 步）');
    const node = story.nodes[nodeId];
    if (!node) throw new Error(`找不到节点：${nodeId}`);
    const fromChapter = s.nodeId ? story.nodes[s.nodeId]?.chapter : undefined;
    s.nodeId = nodeId;
    s.cursor = 0;
    if (node.chapter !== fromChapter) {
      events.push({ type: 'chapterTitle', n: node.chapter, title: chapterTitleOf(node.chapter) });
    }
    // 节级背景：进入带背景的节点就通知播放器（同一 id 播放器自行去重）
    if (node.bg) events.push({ type: 'setBackground', id: node.bg });
    if (node.blocks.length > 0) {
      events.push(sayOf(node.blocks[0]!));
      s.cursor = 1;
    } else {
      resolveNext(s, events, depth + 1);
    }
  }

  /** 处理当前节点的 next（goto / route / ending / choice） */
  function resolveNext(s: EngineState, events: Event[], depth: number): void {
    const node = story.nodes[s.nodeId]!;
    const nx = node.next;
    switch (nx.kind) {
      case 'goto':
        enter(s, nx.to, events, depth + 1);
        return;
      case 'route': {
        for (const rule of nx.rules) {
          if (evalExpr(rule.when, s.vars)) {
            enter(s, rule.to, events, depth + 1);
            return;
          }
        }
        enter(s, nx.else, events, depth + 1);
        return;
      }
      case 'ending':
        events.push({ type: 'ending', id: nx.id });
        return;
      case 'choice':
        events.push(choiceEvent(node));
        return;
    }
  }

  function step(state: EngineState, input: EngineInput): { state: EngineState; events: Event[] } {
    const s = structuredClone(state);
    const events: Event[] = [];

    if (s.nodeId === '') {
      enter(s, story.start, events, 0);
      return { state: s, events };
    }

    const node = story.nodes[s.nodeId];
    if (!node) throw new Error(`当前节点不存在：${s.nodeId}`);

    if (input.type === 'advance') {
      if (s.cursor < node.blocks.length) {
        events.push(sayOf(node.blocks[s.cursor]!));
        s.cursor += 1;
        return { state: s, events };
      }
      if (node.next.kind === 'choice') {
        // 还在等选择，重复推进就把选项再发一次
        events.push(choiceEvent(node));
        return { state: s, events };
      }
      resolveNext(s, events, 0);
      return { state: s, events };
    }

    // choose
    if (node.next.kind !== 'choice') throw new Error(`当前不在选择点，不能选择：${input.key}`);
    const opt = node.next.options.find((o) => o.key === input.key);
    if (!opt) throw new Error(`选项不存在：${input.key}`);
    applyEffects(s, opt.effects);
    s.history.push({ choiceId: node.next.id, key: input.key });
    if (opt.echo.length > 0) events.push({ type: 'showEcho', blocks: opt.echo });
    if (opt.to) enter(s, opt.to, events, 0);
    return { state: s, events };
  }

  function save(state: EngineState): SaveData {
    return {
      v: SAVE_VERSION,
      storyHash,
      nodeId: state.nodeId,
      cursor: state.cursor,
      vars: { ...state.vars },
      facts: { ...state.facts },
      rels: { ...state.rels },
      history: state.history.map((h) => ({ ...h })),
    };
  }

  /** 推进到下一个选择点；返回该选择 id，走到结尾/结局则返回 null */
  function advanceToNextChoice(s: EngineState, sink: Event[]): string | null {
    for (let guard = 0; guard < 100000; guard++) {
      const node = story.nodes[s.nodeId];
      if (!node) throw new Error(`重放失败：找不到节点 ${s.nodeId}`);
      const atEnd = s.cursor >= node.blocks.length;
      if (atEnd && node.next.kind === 'choice') return node.next.id;
      if (atEnd && node.next.kind === 'ending') return null;
      if (s.cursor < node.blocks.length) {
        s.cursor += 1;
      } else {
        resolveNext(s, sink, 0);
      }
    }
    throw new Error('重放失败：无法到达选择点');
  }

  /** 从 history 重放：依次走回每个选择并重做，回到最后一次选择之后的位置 */
  function replay(history: HistoryEntry[]): EngineState {
    const s = initialState();
    const sink: Event[] = [];
    enter(s, story.start, sink, 0);
    for (const h of history) {
      const reached = advanceToNextChoice(s, sink);
      if (reached !== h.choiceId) {
        throw new Error(`重放失败：期望选择 ${h.choiceId}，实际 ${reached ?? '（无）'}`);
      }
      const node = story.nodes[s.nodeId]!;
      if (node.next.kind !== 'choice') throw new Error(`重放失败：节点 ${s.nodeId} 不是选择点`);
      const opt = node.next.options.find((o) => o.key === h.key);
      if (!opt) throw new Error(`重放失败：选择 ${h.choiceId} 没有选项 ${h.key}`);
      applyEffects(s, opt.effects);
      s.history.push({ choiceId: node.next.id, key: h.key });
      if (opt.to) enter(s, opt.to, sink, 0);
    }
    return s;
  }

  function load(data: SaveData): { state: EngineState; warned: boolean } {
    if (data.v !== SAVE_VERSION) throw new Error(`存档版本不支持：${data.v}`);
    const state: EngineState = {
      nodeId: data.nodeId,
      cursor: data.cursor,
      vars: { ...data.vars },
      facts: { ...data.facts },
      rels: { ...data.rels },
      history: data.history.map((h) => ({ ...h })),
    };
    if (data.storyHash === storyHash) return { state, warned: false };
    // 剧情已更新：尝试用 history 重放
    const restored = replay(state.history);
    return { state: restored, warned: true };
  }

  function rewind(state: EngineState): EngineState {
    const last = state.history[state.history.length - 1];
    const s = replay(state.history.slice(0, -1));
    // 重放完剩下的人生后，再推进到被撤销的那个选择点，让玩家重新选
    if (last) {
      const reached = advanceToNextChoice(s, []);
      if (reached !== last.choiceId) {
        throw new Error(`回退失败：期望选择 ${last.choiceId}，实际 ${reached ?? '（无）'}`);
      }
    }
    return s;
  }

  return { initialState, step, save, load, rewind };
}
