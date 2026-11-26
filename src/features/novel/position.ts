/**
 * 页内阅读位置：引擎存档只记到节点，这里额外记下「读到这一段的第几行」，
 * 「继续阅读」时据此翻回原来那一页（换字号 / 换屏也能大致对上）。
 * 与自动存档同一个 Storage，各存一个键；两者对不上（旧存档等）时由调用方兜底。
 */
import type { Storage } from '../../core/engine/persistence';
import type { Anchor } from './reader/paging';
import type { ReadingSpot } from './progress';

export interface SavedPosition {
  storyId: string;
  /** 段身份（segmentOf().key） */
  segKey: string;
  /** 保存时引擎所在节点（段尾）与历史长度，用来确认与自动存档是同一时刻 */
  nodeId: string;
  historyLength: number;
  anchor: Anchor;
  /** 当前页最后一行所在节点 / 行号（封面进度用） */
  spot: ReadingSpot | null;
  savedAt: number;
}

const KEY = 'inov:pos:auto';

function isAnchor(v: unknown): v is Anchor {
  if (v === 'start' || v === 'end') return true;
  if (!v || typeof v !== 'object') return false;
  const a = v as { line?: unknown; offset?: unknown };
  return typeof a.line === 'number' && typeof a.offset === 'number';
}

export function savePosition(storage: Storage, pos: SavedPosition): void {
  try {
    storage.setItem(KEY, JSON.stringify(pos));
  } catch {
    /* 存储已满或不可用：位置只是锦上添花，忽略 */
  }
}

export function loadPosition(storage: Storage): SavedPosition | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SavedPosition>;
    if (
      typeof p.storyId !== 'string' ||
      typeof p.segKey !== 'string' ||
      typeof p.nodeId !== 'string' ||
      typeof p.historyLength !== 'number' ||
      !isAnchor(p.anchor)
    ) {
      return null;
    }
    const spot =
      p.spot && typeof p.spot.nodeId === 'string' && typeof p.spot.line === 'number' ? p.spot : null;
    return { ...(p as SavedPosition), spot };
  } catch {
    return null;
  }
}

/** 位置记录是否与给定的引擎状态属于同一时刻。 */
export function positionMatches(
  pos: SavedPosition | null,
  state: { storyId: string; currentNodeId: string; history: unknown[] },
): pos is SavedPosition {
  return (
    !!pos &&
    pos.storyId === state.storyId &&
    pos.nodeId === state.currentNodeId &&
    pos.historyLength === state.history.length
  );
}
