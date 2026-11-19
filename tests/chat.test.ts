/**
 * 聊天模式：格式扩展（me / color / avatar）、选项三种写法、▸ 自动分支、
 * 会话推进 / 选择 / 撤回 / 结局，以及 src/chats 下内置剧本零错误。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileFiles, compileStory } from '../src/parser/compiler';
import type { Story } from '../src/engine/types';
import {
  chatStatus,
  classifyChoice,
  pickChat,
  splitActions,
  startChat,
  stepChat,
  undoChoice,
  visibleChoices,
  type ChatSession,
} from '../src/chat/transcript';

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
  for (let i = 0; i < 50 && chatStatus(story, s) === 'more'; i++) s = stepChat(story, s);
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

describe('内置聊天剧本', () => {
  const dir = join(__dirname, '../src/chats');
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.chat.txt'))
    .map((n) => ({ name: n, source: readFileSync(join(dir, n), 'utf-8') }));

  it('src/chats 下所有 .chat.txt 各自编译零错误', () => {
    for (const f of files) {
      const { stories, errors } = compileFiles([f]);
      expect(errors.map((e) => `${f.name}:${e.line} ${e.message}`)).toEqual([]);
      expect(stories).toHaveLength(1);
    }
  });

  it('示例剧本每条选项路线都能走到结局', () => {
    const story = compileFiles(files.filter((f) => f.name === 'demo.chat.txt')).stories[0];
    const endings = new Set<string>();
    const walk = (s: ChatSession, depth: number) => {
      s = run(story, s);
      const st = chatStatus(story, s);
      if (st === 'ended') {
        endings.add(s.state.ended!);
        return;
      }
      expect(st).toBe('choices');
      expect(depth).toBeLessThan(10);
      for (const c of visibleChoices(story, s)) walk(pickChat(story, s, c.id), depth + 1);
    };
    walk(startChat(story), 0);
    expect([...endings].sort()).toEqual(['lonely', 'together']);
  });
});
