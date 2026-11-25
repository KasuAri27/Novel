import { describe, it, expect } from 'vitest';
import { compileStory } from '../src/core/parser/compiler';

describe('parser: DSL -> 内部 Story', () => {
  const DSL = [
    '@story id=demo title=示例',
    '@char 艾玛 immortal',
    '@char 梅露露',
    '@char 雪',
    '@fact 雪的真实目的',
    '@node n_start',
    '艾玛> 醒来。',
    '> 风吹过。',
    '[choice] 观察 -> n_look when !knows(艾玛, 雪的真实目的) do know(艾玛, 雪的真实目的), explore(雪, 1)',
    '[choice] 离开 -> n_end',
    '@node n_look',
    '艾玛> 线索。',
    '[goto] n_end',
    '@node n_end',
    '艾玛> 终点。',
    '@end END_ok priority=1 when alive(艾玛)',
    '  title 好结局',
    '  text 结束了。',
  ].join('\n');

  it('编译成功且无错误', () => {
    const { stories, errors } = compileStory(DSL);
    expect(errors).toEqual([]);
    expect(stories).toHaveLength(1);
  });

  it('解析元信息、角色、事实', () => {
    const story = compileStory(DSL).stories[0];
    expect(story.meta.id).toBe('demo');
    expect(story.chars['艾玛'].immortal).toBe(true);
    expect(story.chars['梅露露'].immortal).toBe(false);
    expect(story.facts['雪的真实目的']).toBeDefined();
    expect(story.entry).toBe('n_start');
  });

  it('解析对白说话者与旁白', () => {
    const story = compileStory(DSL).stories[0];
    const lines = story.nodes['n_start'].lines;
    expect(lines[0]).toEqual({ speaker: '艾玛', text: '醒来。' });
  });

  it('解析带 when/do 的选项', () => {
    const story = compileStory(DSL).stories[0];
    const choices = story.nodes['n_start'].choices;
    expect(choices).toHaveLength(2);
    expect(choices[0].goto).toBe('n_look');
    expect(choices[0].when.kind).toBe('not');
    expect((choices[0].when as any).part.kind).toBe('atom');
    expect(choices[0].do).toHaveLength(2);
    expect(choices[0].do[0]).toEqual({ verb: 'know', args: ['艾玛', '雪的真实目的'] });
    expect(choices[0].do[1]).toEqual({ verb: 'explore', args: ['雪'], value: 1 });
  });

  it('解析 [goto] 与结局', () => {
    const story = compileStory(DSL).stories[0];
    expect(story.nodes['n_look'].next).toBe('n_end');
    expect(story.endings[0]).toMatchObject({ id: 'END_ok', title: '好结局', priority: 1 });
  });

  it('错误：未声明角色应带行号报错', () => {
    const bad = ['@story id=b title=B', '@char 艾玛', '@fact f', '@node n', '幽灵> 说话', '@end E1 when alive(艾玛)'].join(
      '\n',
    );
    const { stories, errors } = compileStory(bad);
    expect(stories).toHaveLength(0);
    expect(errors.some((e) => e.message.includes('未声明的角色「幽灵」'))).toBe(true);
    expect(errors.find((e) => e.message.includes('幽灵'))?.line).toBeGreaterThan(0);
  });

  it('错误：跳转到不存在节点', () => {
    const bad = [
      '@story id=b title=B',
      '@char 艾玛 immortal',
      '@node n1',
      '艾玛> hi',
      '[choice] 去不存在 -> nowhere',
    ].join('\n');
    const { errors } = compileStory(bad);
    expect(errors.some((e) => e.message.includes('不存在的节点'))).toBe(true);
  });

  it('错误：未知条件动词', () => {
    const bad = [
      '@story id=b title=B',
      '@char 艾玛 immortal',
      '@node n1',
      '艾玛> hi',
      '[choice] x -> n1 when 幻觉(艾玛)',
    ].join('\n');
    const { errors } = compileStory(bad);
    expect(errors.some((e) => e.message.includes('未知条件动词'))).toBe(true);
  });
});
