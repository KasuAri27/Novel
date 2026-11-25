/**
 * 聊天剧本库：
 *   - 内置：content/chats 下所有 .chat.txt（构建时打包；同 @story id 的多文件按文件名排序后合并编译，与小说剧本分开编译，互不合并）；
 *   - 导入：玩家在页面上选的本地 .txt，原文存进 localStorage，刷新后重新编译。
 * 导入的剧本与内置剧本 @story id 相同时，以导入的为准（方便作者改完直接预览）。
 */
import type { Story } from '../../core/engine/types';
import { compileFiles, type CompileError } from '../../core/parser/compiler';

export interface ImportedSource {
  name: string;
  source: string;
}

export interface ChatLibraryItem {
  story: Story;
  imported: boolean;
}

import { getStories } from '../../content/registry';

const builtInRaw = import.meta.glob('/content/chats/**/*.chat.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const IMPORTS_KEY = 'inov:chat:imports';

function compileBuiltIn(): { stories: Story[]; errors: CompileError[] } {
  // 复用 registry 缓存，避免小说剧本在启动时被编译两遍
  const storyResult = getStories();
  // 按文件名排序，确保分章文件顺序稳定，首章提供 @story meta 与 @entry
  const chatFiles = Object.entries(builtInRaw)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, source]) => ({
      name,
      source: source as string,
    }));
  const chatResult = compileFiles(chatFiles);
  return {
    stories: [...storyResult.stories, ...chatResult.stories],
    errors: [...storyResult.errors, ...chatResult.errors],
  };
}

export const builtIn = compileBuiltIn();

export function readImports(): ImportedSource[] {
  try {
    const raw = localStorage.getItem(IMPORTS_KEY);
    const list = raw ? (JSON.parse(raw) as ImportedSource[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.source === 'string') : [];
  } catch {
    return [];
  }
}

export function writeImports(list: ImportedSource[]): void {
  try {
    localStorage.setItem(IMPORTS_KEY, JSON.stringify(list));
  } catch {
    /* 存储满或被禁用：本次会话仍可玩，只是刷新后丢失 */
  }
}

/** 编译单个导入文件；有错误时不产出剧本 */
export function compileImport(file: ImportedSource): { story: Story | null; errors: CompileError[] } {
  const { stories, errors } = compileFiles([file]);
  if (errors.length > 0) return { story: null, errors };
  if (stories.length !== 1) {
    return { story: null, errors: [{ file: file.name, line: 0, message: '一个文件只能包含一个 @story' }] };
  }
  return { story: stories[0], errors: [] };
}

/** 合成列表：内置在前，导入覆盖同 id 的内置 */
export function buildLibrary(imports: ImportedSource[]): ChatLibraryItem[] {
  const byId = new Map<string, ChatLibraryItem>();
  for (const s of builtIn.stories) byId.set(s.meta.id, { story: s, imported: false });
  for (const f of imports) {
    const { story } = compileImport(f);
    if (story) byId.set(story.meta.id, { story, imported: true });
  }
  return [...byId.values()];
}
