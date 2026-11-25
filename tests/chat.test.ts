/**
 * 聊天模式：格式扩展（me / color / avatar）、选项三种写法、▸ 自动分支、
 * 会话推进 / 选择 / 撤回 / 结局，以及 content/chats 下内置剧本零错误。
 */
import { describe, expect, it } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';
import { createInitialState } from '../src/core/engine/state';
import { advance, availableChoices, choose } from '../src/core/engine/reducer';
import { resolveEnding } from '../src/core/engine/ending';
import type { GameState, Story } from '../src/core/engine/types';
import { builtIn } from '../src/features/chat/library';
import { loadAllStories } from '../src/content/loadStories';
import {
  chatStatus,
  classifyChoice,
  isAutoChoice,
  meId,
  pickChat,
  splitActions,
  startChat,
  stepChat,
  undoChoice,
  visibleChoices,
  type ChatSession,
} from '../src/features/chat/transcript';

const SRC = `
@story id=t title=测试
@char 我 me
@char 甲 color=#123456 avatar=portraits/a.png
@char 乙 color=#abcdef immortal
@fact 秘密

@node a
> 雨停了。
甲> （抬头）你来了。
[choice] 嗯，来了。 -> b
[choice] （点点头） -> b do know(我, 秘密)
[choice] 【离开】 -> c
[choice] 只有知情者能看到 -> b when knows(我, 秘密)

@node b
甲> 坐吧。
[goto] route

@node route
[choice] ▸ -> knew when knows(我, 秘密)
[choice] ▸ -> plain

@node knew
甲> 你知道了。

@node plain
甲> 什么也没发生。

@node c
> 你转身离开。

@end e_knew priority=5 when knows(我, 秘密)
title 知情
@end e_plain
title 平凡
`;

function compile(src: string): Story {
  const { stories, errors } = compileStory(src);
  expect(errors.map((e) => `${e.line} ${e.message}`)).toEqual([]);
  return stories[0];
}

/** 一直点「继续」直到需要选择或结束 */
function run(story: Story, s: ChatSession): ChatSession {
  for (let i = 0; i < 5000 && chatStatus(story, s) === 'more'; i++) s = stepChat(story, s);
  return s;
}

describe('聊天格式解析', () => {
  it('@char 支持 me / color / avatar', () => {
    const story = compile(SRC);
    expect(story.chars['我'].me).toBe(true);
    expect(story.chars['甲'].color).toBe('#123456');
    expect(story.chars['甲'].asset).toBe('portraits/a.png');
    expect(story.chars['甲'].me).toBeUndefined();
    // 开关词写在属性后面也不会混进属性值
    expect(story.chars['乙'].color).toBe('#abcdef');
    expect(story.chars['乙'].immortal).toBe(true);
  });

  it('只能有一位 me', () => {
    const { errors } = compileStory('@story id=x\n@char 甲 me\n@char 乙 me\n@node a\n> x\n');
    expect(errors.some((e) => e.message.includes('只能有一位主角'))).toBe(true);
  });

  it('选项三种写法', () => {
    expect(classifyChoice('嗯，来了。')).toEqual({ style: 'say', text: '嗯，来了。', button: '嗯，来了。' });
    expect(classifyChoice('（点点头）')).toEqual({ style: 'act', text: '点点头', button: '（点点头）' });
    expect(classifyChoice('【离开】')).toEqual({ style: 'silent', text: '离开', button: '离开' });
    // 只有整句被包住才算动作
    expect(classifyChoice('（笑）好啊').style).toBe('say');
    expect(classifyChoice('（笑）好啊（摆手）').style).toBe('say');
  });

  it('台词里的（动作）拆成斜体片段', () => {
    expect(splitActions('（别过脸）……随你。')).toEqual([
      { act: true, text: '别过脸' },
      { act: false, text: '……随你。' },
    ]);
    expect(splitActions('好(笑)')).toEqual([
      { act: false, text: '好' },
      { act: true, text: '笑' },
    ]);
  });
});

describe('聊天会话', () => {
  it('开局露出第一行，逐条推进到选项', () => {
    const story = compile(SRC);
    let s = startChat(story);
    expect(s.log).toEqual([{ kind: 'narr', text: '雨停了。' }]);
    s = run(story, s);
    expect(s.log[1]).toEqual({ kind: 'say', speaker: '甲', text: '（抬头）你来了。' });
    expect(chatStatus(story, s)).toBe('choices');
    // when 不满足的选项不显示
    expect(visibleChoices(story, s).map((c) => c.label)).toEqual(['嗯，来了。', '（点点头）', '【离开】']);
  });

  it('普通选项记为主角气泡，▸ 自动分支走 else，结局按条件结算', () => {
    const story = compile(SRC);
    let s = run(story, startChat(story));
    s = pickChat(story, s, visibleChoices(story, s)[0].id);
    expect(s.log.at(-2)).toMatchObject({ kind: 'pick', style: 'say', text: '嗯，来了。' });
    expect(s.log.at(-1)).toEqual({ kind: 'say', speaker: '甲', text: '坐吧。' });
    s = run(story, s);
    expect(chatStatus(story, s)).toBe('ended');
    expect(s.log.map((e) => e.kind)).not.toContain('pick-auto');
    expect(s.log.at(-2)).toEqual({ kind: 'say', speaker: '甲', text: '什么也没发生。' });
    expect(s.log.at(-1)).toMatchObject({ kind: 'end', id: 'e_plain', title: '平凡' });
  });

  it('动作选项 + do 效果影响自动分支与结局', () => {
    const story = compile(SRC);
    let s = run(story, startChat(story));
    s = pickChat(story, s, visibleChoices(story, s)[1].id);
    expect(s.log.at(-2)).toMatchObject({ kind: 'pick', style: 'act', text: '点点头' });
    s = run(story, s);
    expect(s.log.at(-2)).toEqual({ kind: 'say', speaker: '甲', text: '你知道了。' });
    expect(s.log.at(-1)).toMatchObject({ kind: 'end', id: 'e_knew' });
  });

  it('撤回选择：状态与记录都回到选项处', () => {
    const story = compile(SRC);
    const before = run(story, startChat(story));
    let s = pickChat(story, before, visibleChoices(story, before)[1].id);
    s = run(story, s);
    s = undoChoice(s);
    expect(s.log).toEqual(before.log);
    expect(s.state).toEqual(before.state);
    expect(chatStatus(story, s)).toBe('choices');
  });

  it('不能选不可见的选项', () => {
    const story = compile(SRC);
    const s = run(story, startChat(story));
    const hidden = story.nodes.a.choices[3].id;
    expect(pickChat(story, s, hidden)).toBe(s);
  });
});

function stateKey(state: GameState): string {
  const knowledge = Object.entries(state.knowledge)
    .filter(([, facts]) => facts.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([charId, facts]) => [charId, [...facts].sort()]);
  const dead = Object.entries(state.alive)
    .filter(([, alive]) => alive === false)
    .map(([charId]) => charId)
    .sort();
  const flags = Object.entries(state.flags).sort(([a], [b]) => a.localeCompare(b));
  const relationships = Object.entries(state.relationships).sort(([a], [b]) => a.localeCompare(b));
  const exploration = Object.entries(state.exploration).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([state.currentNodeId, knowledge, dead, flags, relationships, exploration]);
}

function assertStaticStructure(story: Story, expectedLeaves: Set<string>) {
  const reachable = new Set<string>();
  const stack = [story.entry];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = story.nodes[id];
    expect(node, `${story.meta.id} 缺少节点 ${id}`).toBeDefined();
    for (const c of node.choices) stack.push(c.goto);
    if (node.next) stack.push(node.next);
  }
  const allNodes = Object.keys(story.nodes);
  const unreachable = allNodes.filter((id) => !reachable.has(id));
  expect(unreachable, `${story.meta.id} 不可达节点: ${unreachable.join(', ')}`).toEqual([]);

  for (const id of allNodes) {
    const node = story.nodes[id];
    const isLeaf = node.choices.length === 0 && !node.next;
    if (isLeaf) expect(expectedLeaves.has(id), `${story.meta.id} 意外叶子节点: ${id}`).toBe(true);
    else expect(Boolean(node.next) || node.choices.length > 0, `${story.meta.id} 节点 ${id} 无出口`).toBe(true);
  }
}

interface TraverseQueueItem {
  state: GameState;
  parent: number;
  choiceId: string | null;
}

/**
 * 轻量纯引擎全图遍历：节点内跳过逐行步进并剥离 history，以去重状态检验无死路并收集各结局路径。
 */
function traverseChatGraph(story: Story) {
  const queue: TraverseQueueItem[] = [{ state: createInitialState(story), parent: -1, choiceId: null }];
  const seen = new Set<string>();
  const visitedNodes = new Set<string>();
  const endingPaths = new Map<string, string[]>();

  const reconstructPath = (idx: number): string[] => {
    const path: string[] = [];
    for (let cur = idx; cur >= 0; cur = queue[cur].parent) {
      const cid = queue[cur].choiceId;
      if (cid) path.push(cid);
    }
    return path.reverse();
  };

  for (let idx = 0; idx < queue.length; idx++) {
    const raw = queue[idx].state;
    const node = story.nodes[raw.currentNodeId];
    expect(node, `${story.meta.id} 节点不存在: ${raw.currentNodeId}`).toBeDefined();
    visitedNodes.add(node.id);

    const s: GameState = {
      ...raw,
      lineIndex: Math.max(0, node.lines.length - 1),
      history: [],
    };
    const key = stateKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    expect(seen.size, `${story.meta.id} 状态数异常膨胀`).toBeLessThan(200_000);

    if (node.choices.length > 0) {
      const avail = availableChoices(story, s);
      const auto = avail.find((c) => isAutoChoice(c.label));
      if (auto) {
        queue.push({ state: choose(s, story, auto.id), parent: idx, choiceId: null });
        continue;
      }
      const visible = avail.filter((c) => !isAutoChoice(c.label));
      expect(visible.length, `${story.meta.id} 卡在 ${node.id}（无可用选项）`).toBeGreaterThan(0);
      for (const c of visible) {
        queue.push({ state: choose(s, story, c.id), parent: idx, choiceId: c.id });
      }
    } else if (node.next) {
      const next = advance(s, story);
      expect(next, `${story.meta.id} 节点 ${node.id} [goto] 推进失败`).not.toBe(s);
      queue.push({ state: next, parent: idx, choiceId: null });
    } else {
      const ending = resolveEnding(s, story);
      expect(ending, `${story.meta.id} 叶子节点 ${node.id} 无结局命中`).not.toBeNull();
      expect(advance(s, story).ended).toBe(ending!.id);
      if (!endingPaths.has(ending!.id)) endingPaths.set(ending!.id, reconstructPath(idx));
    }
  }

  return { visitedNodes, endingPaths };
}

describe('内置聊天剧本', () => {
  it('小说版与对话版共享 content/stories 同一份主剧本且零错误编译，包含 chat_demo 与 majo_shinpan', () => {
    expect(builtIn.errors.map((e) => `${e.file}:${e.line} ${e.message}`)).toEqual([]);
    const ids = builtIn.stories.map((s) => s.meta.id);
    expect(ids).toContain('chat_demo');
    expect(ids).toContain('majo_shinpan');

    const novelRes = loadAllStories();
    expect(novelRes.errors).toEqual([]);
    const novelMajo = novelRes.stories.find((s) => s.meta.id === 'majo_shinpan');
    const builtInMajo = builtIn.stories.find((s) => s.meta.id === 'majo_shinpan');
    expect(novelMajo).toBeDefined();
    expect(builtInMajo).toBeDefined();
    expect(builtInMajo?.meta.sources[0]).toMatch(/chapter1\.story\.txt$/);
    expect(builtInMajo?.meta.sources).toEqual(novelMajo?.meta.sources);
    expect(builtInMajo?.entry).toBe('s0_breakfast');
  });

  it('chat_demo：所有选项路线都能走到结局 lonely / together', () => {
    expect(builtIn.errors).toEqual([]);
    const story = builtIn.stories.find((s) => s.meta.id === 'chat_demo');
    expect(story).toBeDefined();
    if (!story) return;

    const endings = new Set<string>();
    const seen = new Set<string>();
    const walk = (s: ChatSession) => {
      s = run(story, s);
      const { currentNodeId } = s.state;
      const key = stateKey(s.state);
      if (seen.has(key)) return;
      seen.add(key);
      const st = chatStatus(story, s);
      if (st === 'ended') {
        endings.add(s.state.ended!);
        return;
      }
      expect(st, `chat_demo 卡在 ${currentNodeId}`).toBe('choices');
      for (const c of visibleChoices(story, s)) walk(pickChat(story, s, c.id));
    };
    walk(startChat(story));
    expect([...endings].sort()).toEqual(['lonely', 'together']);
  });

  it('majo_shinpan：结构完整、无死路且 6 条结局均可从 s0_breakfast 到达', () => {
    expect(builtIn.errors.map((e) => `${e.file}:${e.line} ${e.message}`)).toEqual([]);
    const story = builtIn.stories.find((s) => s.meta.id === 'majo_shinpan');
    expect(story).toBeDefined();
    if (!story) return;

    expect(story.entry).toBe('s0_breakfast');
    expect(meId(story)).toBe('艾玛');
    expect(story.meta.sources[0]).toMatch(/chapter1\.story\.txt$/);

    assertStaticStructure(
      story,
      new Set([
        'ch4_end_3p',
        'ch4_end_shiro',
        'ch4_end_meruru',
        'ch6_end_nocase_life',
        'ch7_nocase_be',
        'ch7_nocase_epilogue',
      ]),
    );

    const { visitedNodes, endingPaths } = traverseChatGraph(story);
    const unvisited = Object.keys(story.nodes).filter((id) => !visitedNodes.has(id));
    expect(unvisited, `运行时不可达节点: ${unvisited.join(', ')}`).toEqual([]);

    const expectedEndings = [
      'END_nocase_be',
      'END_nocase_he',
      'END_nocase_life',
      'end_3p',
      'end_meruru',
      'end_shiro',
    ];
    expect([...endingPaths.keys()].sort()).toEqual(expectedEndings);

    // 使用完整聊天会话 API 抽测各结局代表性路径
    let checkedUndo = false;
    for (const endingId of expectedEndings) {
      const path = endingPaths.get(endingId)!;
      let session = startChat(story);
      expect(session.log.length).toBeGreaterThan(0);

      for (const choiceId of path) {
        session = run(story, session);
        expect(chatStatus(story, session)).toBe('choices');
        expect(visibleChoices(story, session).some((c) => c.id === choiceId)).toBe(true);
        if (!checkedUndo) {
          const picked = pickChat(story, session, choiceId);
          const undone = undoChoice(picked);
          expect(undone.log).toEqual(session.log);
          expect(undone.state).toEqual(session.state);
          checkedUndo = true;
        }
        session = pickChat(story, session, choiceId);
      }

      session = run(story, session);
      expect(chatStatus(story, session)).toBe('ended');
      expect(session.state.ended).toBe(endingId);
      expect(session.log.at(-1)).toMatchObject({ kind: 'end', id: endingId });
      expect(session.log.map((e) => e.kind)).not.toContain('pick-auto');
      expect(session.log.some((e) => e.kind === 'say')).toBe(true);
      expect(session.log.some((e) => e.kind === 'narr')).toBe(true);
      expect(session.log.some((e) => e.kind === 'pick')).toBe(true);
    }
  });
});
