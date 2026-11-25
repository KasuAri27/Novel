/**
 * 运行期剧情注册表：加载一次，供 UI 选择/启动。
 * 与具体剧情无关，只做 id -> Story 的索引。
 */
import type { Story } from '../core/engine/types';
import { loadAllStories, type LoadResult } from './loadStories';

let cache: LoadResult | null = null;

export function getStories(): LoadResult {
  if (!cache) cache = loadAllStories();
  return cache;
}

export function getStory(id: string): Story | null {
  return getStories().stories.find((s) => s.meta.id === id) ?? null;
}
