/**
 * 剧情内容校验：编译 content/stories 下所有 .story.txt，要求零错误；
 * 并做结构性检查（入口、可达性、非叶子节点出口）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileFiles } from '../src/core/parser/compiler';

const storiesDir = join(__dirname, '../content/stories');

function collectStoryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectStoryFiles(p));
    else if (name.name.endsWith('.story.txt')) out.push(p);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

describe('剧情编译', () => {
  const files = collectStoryFiles(storiesDir).map((p) => ({
    name: p,
    source: readFileSync(p, 'utf-8'),
  }));

  it('所有 .story.txt 编译零错误', () => {
    const { stories, errors } = compileFiles(files);
    expect(errors, errors.map((e) => `${e.file}:${e.line} ${e.message}`).join('\n')).toHaveLength(0);
    expect(stories.length).toBeGreaterThan(0);
  });

  it('魔女审判第一章：结构完整且无不可达节点', () => {
    const { stories, errors } = compileFiles(files);
    expect(errors).toHaveLength(0);
    const story = stories.find((s) => s.meta.id === 'majo_shinpan');
    expect(story).toBeTruthy();
    if (!story) return;

    expect(story.entry).toBe('s0_breakfast');

    // 从入口做可达性遍历
    const seen = new Set<string>();
    const queue = [story.entry];
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = story.nodes[id];
      for (const c of node.choices) queue.push(c.goto);
      if (node.next) queue.push(node.next);
    }
    const all = Object.keys(story.nodes);
    const unreachable = all.filter((id) => !seen.has(id));
    expect(unreachable, `不可达节点: ${unreachable.join(', ')}`).toHaveLength(0);

    // 非叶子节点必须有出口；叶子节点必须是预期章节收束点
    const expectedLeaves = new Set([
      'ch4_end_3p',
      'ch4_end_shiro',
      'ch4_end_meruru',
      'ch6_end_nocase_life',
      'ch7_nocase_be',
      'ch7_nocase_epilogue',
    ]);
    for (const id of all) {
      const node = story.nodes[id];
      const isLeaf = node.choices.length === 0 && !node.next;
      if (isLeaf) expect(expectedLeaves.has(id), `意外叶子节点: ${id}`).toBe(true);
      else expect(Boolean(node.next) || node.choices.length > 0, `节点 ${id} 无出口`).toBe(true);
    }
  });
});
