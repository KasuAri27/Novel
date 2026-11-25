/**
 * 存档/读档。通过 Storage 接口与运行时（localStorage / 内存 / 测试）解耦。
 * 存档单元是 GameState（纯 JSON 可序列化）。
 */
import type { GameState } from './types';

/** 存储后端接口（可注入，便于替换/测试） */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** 内存实现（SSR / 测试 / 无 localStorage 环境兜底） */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** localStorage 实现，缺失时降级到内存 */
export function createDefaultStorage(): Storage {
  if (typeof localStorage !== 'undefined') {
    return {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
      keys: () => Object.keys(localStorage),
    };
  }
  return new MemoryStorage();
}

const PREFIX = 'inov:save:';

/** 浏览器自动存档槽：标题页「继续阅读」只恢复这一份。 */
export const AUTO_SLOT = 'auto';

export interface SaveMeta {
  slot: string;
  storyId: string;
  savedAt: number;
  nodeId?: string;
}

export interface SaveRecord extends SaveMeta {
  state: GameState;
}

function slotKey(slot: string): string {
  return PREFIX + slot;
}

export function saveGame(storage: Storage, slot: string, state: GameState): void {
  const record: SaveRecord = {
    slot,
    storyId: state.storyId,
    savedAt: Date.now(),
    nodeId: state.currentNodeId,
    state,
  };
  storage.setItem(slotKey(slot), JSON.stringify(record));
}

/** 写入唯一自动存档（会覆盖上一份进度）。 */
export function saveAutosave(storage: Storage, state: GameState): void {
  saveGame(storage, AUTO_SLOT, state);
}

/** 读取自动存档；没有或损坏则返回 null。 */
export function loadAutosave(storage: Storage): SaveRecord | null {
  return loadGame(storage, AUTO_SLOT);
}

export function loadGame(storage: Storage, slot: string): SaveRecord | null {
  const raw = storage.getItem(slotKey(slot));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SaveRecord;
  } catch {
    return null;
  }
}

export function deleteSave(storage: Storage, slot: string): void {
  storage.removeItem(slotKey(slot));
}

/** 列出全部存档元信息（不含 state 体积） */
export function listSaves(storage: Storage): SaveMeta[] {
  const out: SaveMeta[] = [];
  for (const key of storage.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as SaveRecord;
      out.push({
        slot: rec.slot,
        storyId: rec.storyId,
        savedAt: rec.savedAt,
        nodeId: rec.nodeId ?? rec.state?.currentNodeId,
      });
    } catch {
      /* 跳过损坏存档 */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** 导出/导入（用于跨设备迁移或人工编辑） */
export function exportSave(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

export function importSave(text: string): GameState | null {
  try {
    return JSON.parse(text) as GameState;
  } catch {
    return null;
  }
}
