/**
 * 内容装配：按「目录约定」加载剧情。
 * 扫描 stories 目录下所有 .story.txt，以 ?raw 读入文本，交给 parser 编译成 Story。
 * 新增/替换剧情 = 往该目录放/换 .story.txt，无需改任何代码。
 */
import type { Story } from '../core/engine/types';
import { compileFiles, type CompileError } from '../core/parser/compiler';

export interface StorySummary {
  id: string;
  title: string;
  nodeCount: number;
  charCount: number;
  endingCount: number;
  sources: string[];
}

export interface LoadResult {
  stories: Story[];
  errors: CompileError[];
  manifest: StorySummary[];
}

// Vite 在构建时把匹配的 .txt 作为原始字符串注入
const rawModules = import.meta.glob('/content/stories/**/*.story.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function loadAllStories(): LoadResult {
  const files = Object.entries(rawModules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, source]) => ({
      name,
      source: source as string,
    }));
  const { stories, errors } = compileFiles(files);
  const manifest: StorySummary[] = stories.map((s) => ({
    id: s.meta.id,
    title: s.meta.title,
    nodeCount: Object.keys(s.nodes).length,
    charCount: Object.keys(s.chars).length,
    endingCount: s.endings.length,
    sources: s.meta.sources,
  }));
  return { stories, errors, manifest };
}
