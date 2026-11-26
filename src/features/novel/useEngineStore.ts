/**
 * 引擎状态绑定（小说阅读模式）：用 zustand 把纯函数引擎接到 React。
 * UI 只跟这个 store 打交道，完全不碰引擎/parser 细节。
 *
 * 阅读模型：screen = title | play | ending。
 * 引擎状态总停在「段尾」（见 segment.ts）；段内翻页由阅读器自己管，
 * 读到哪一页另存一份位置记录（position.ts），与自动存档一起实现「继续阅读」原地续读。
 */
import { create } from 'zustand';
import type { GameState, Story } from '../../core/engine/types';
import { choose, nextPage, rewindTo } from '../../core/engine/reducer';
import { createInitialState } from '../../core/engine/state';
import { findEnding } from '../../core/engine/ending';
import {
  createDefaultStorage,
  loadAutosave,
  saveAutosave,
  type Storage,
} from '../../core/engine/persistence';
import { getStories } from '../../content/registry';
import type { CompileError } from '../../core/parser/compiler';
import type { StorySummary } from '../../content/loadStories';
import { chapterTitle, describeAutosave, type AutosavePreview } from './progress';
import { loadPosition, positionMatches, savePosition } from './position';
import { locate, segmentOf, settle, type Segment } from './segment';
import type { Anchor } from './reader/paging';
import type { ReaderPosition, ReaderSheet } from './reader/BookReader';

export type Screen = 'title' | 'play' | 'ending';

interface EngineStore {
  manifest: StorySummary[];
  compileErrors: CompileError[];
  screen: Screen;
  story: Story | null;
  state: GameState | null;
  storage: Storage;
  /** 本次进入阅读页是否播放 Title → 书本推进动画 */
  enterFromTitle: boolean;
  /** 每次引擎跳转（开局 / 选择 / 翻到新段 / 回退 / 跳章）加一，作为阅读器「这一段」的身份 */
  seq: number;
  /** 新的一段从哪里开始显示（与 seq 绑定） */
  landing: { seq: number; anchor: Anchor };
  /** 阅读器上报的当前位置（key 与 sheet.key 对应） */
  position: ReaderPosition | null;

  /** 装入新开局（不切屏，供标题过渡动画使用） */
  bootNewGame: (id: string) => boolean;
  /** 装入自动存档（不切屏） */
  bootContinue: () => boolean;
  /** 切到阅读屏 */
  enterPlay: () => void;
  newGame: (id: string) => void;
  continueReading: () => boolean;
  pick: (choiceId: string) => void;
  /** 翻过段尾：进入下一段（跨章）或结算结局 */
  turnPage: () => void;
  /** 从段首往回翻：回到上一段末尾 */
  rewind: () => void;
  /** 回到路径第 index 步所在的那一段开头（目录跳章） */
  jumpTo: (index: number) => void;
  restart: () => void;
  backToTitle: () => void;
  /** 阅读器翻页后上报位置 */
  setPosition: (pos: ReaderPosition) => void;
  peekNextSheet: () => ReaderSheet | 'ending' | null;
  peekPrevSheet: () => ReaderSheet | null;
  peekPickSheet: (choiceId: string) => ReaderSheet | null;
  peekAutosave: () => AutosavePreview | null;
  defaultStoryId: () => string | null;
}

const loaded = getStories();

function findStory(id: string): Story | null {
  return loaded.stories.find((s) => s.meta.id === id) ?? null;
}

/** 把一段内容包装成阅读器要的 sheet。 */
export function toSheet(seg: Segment, key: string): ReaderSheet {
  return {
    key,
    chapter: chapterTitle(seg.chapter),
    lines: seg.lines,
    heading: seg.heading,
    echo: seg.echo,
    hasChoices: seg.hasChoices,
    choices: seg.choices,
  };
}

export const useEngineStore = create<EngineStore>((set, get) => {
  /** 写自动存档 + 位置记录（两者同一时刻落盘，续读时才能对上）。 */
  const persist = (story: Story, state: GameState, anchor: Anchor) => {
    const { storage } = get();
    saveAutosave(storage, state);
    if (state.ended) return;
    const seg = segmentOf(story, state);
    const spot = anchor === 'end' ? locate(seg, seg.lines.length - 1) : anchor === 'start' ? locate(seg, 0) : locate(seg, anchor.line);
    savePosition(storage, {
      storyId: state.storyId,
      segKey: seg.key,
      nodeId: state.currentNodeId,
      historyLength: state.history.length,
      anchor,
      spot,
      savedAt: Date.now(),
    });
  };

  /** 引擎跳到新状态：落盘、换段、按 anchor 落页。 */
  const commit = (next: GameState, anchor: Anchor, extra: Partial<EngineStore> = {}) => {
    const { story, seq } = get();
    if (!story) return;
    persist(story, next, anchor);
    set({
      state: next,
      seq: seq + 1,
      landing: { seq: seq + 1, anchor },
      position: null,
      screen: next.ended ? 'ending' : 'play',
      ...extra,
    });
  };

  return {
    manifest: loaded.manifest,
    compileErrors: loaded.errors,
    screen: 'title',
    story: null,
    state: null,
    storage: createDefaultStorage(),
    enterFromTitle: false,
    seq: 0,
    landing: { seq: 0, anchor: 'start' },
    position: null,

    bootNewGame: (id) => {
      const story = findStory(id);
      if (!story) return false;
      const state = settle(createInitialState(story), story);
      const seq = get().seq + 1;
      set({ story, state, seq, landing: { seq, anchor: 'start' }, position: null, enterFromTitle: true });
      persist(story, state, 'start');
      return true;
    },

    bootContinue: () => {
      const { storage } = get();
      const rec = loadAutosave(storage);
      if (!rec) return false;
      const story = findStory(rec.state.storyId);
      if (!story) return false;

      const bootNode = rec.state.currentNodeId;
      const state = settle(rec.state, story);
      const seg = segmentOf(story, state);
      const pos = loadPosition(storage);
      let anchor: Anchor = 'start';
      if (positionMatches(pos, state) && pos.segKey === seg.key) {
        anchor = pos.anchor;
      } else {
        // 旧版存档只记到节点：落在该节点正文开始的那一页
        const part = [...seg.parts].reverse().find((pt) => pt.nodeId === bootNode);
        if (part && part.start > 0) anchor = { line: part.start, offset: 0 };
      }

      const seq = get().seq + 1;
      set({ story, state, seq, landing: { seq, anchor }, position: null, enterFromTitle: true });
      if (!state.ended) persist(story, state, anchor);
      return true;
    },

    enterPlay: () => {
      const { story, state } = get();
      if (!story || !state) return;
      set({ screen: state.ended ? 'ending' : 'play' });
    },

    newGame: (id) => {
      if (!get().bootNewGame(id)) return;
      get().enterPlay();
    },

    continueReading: () => {
      if (!get().bootContinue()) return false;
      get().enterPlay();
      return true;
    },

    pick: (choiceId) => {
      const { story, state } = get();
      if (!story || !state || state.ended) return;
      const chosen = choose(state, story, choiceId);
      if (chosen === state) return;
      commit(settle(chosen, story), 'start');
    },

    turnPage: () => {
      const { story, state } = get();
      if (!story || !state || state.ended) return;
      const next = nextPage(state, story);
      if (next.ended) {
        commit(next, 'start');
        return;
      }
      // 叶子节点却没有命中任何结局：留在原地，不制造重复历史
      if (next.currentNodeId === state.currentNodeId) return;
      const settled = settle(next, story);
      const before = segmentOf(story, state);
      const after = segmentOf(story, settled);
      commit(settled, after.key === before.key ? { line: before.lines.length, offset: 0 } : 'start');
    },

    rewind: () => {
      const { story, state } = get();
      if (!story || !state) return;
      const seg = segmentOf(story, state);
      if (seg.startIndex <= 0) return;
      commit(rewindTo(state, seg.startIndex - 1), 'end');
    },

    jumpTo: (index) => {
      const { story, state } = get();
      if (!story || !state) return;
      const target = index < state.history.length ? rewindTo(state, index) : state;
      commit(settle(target, story), 'start');
    },

    restart: () => {
      const { story } = get();
      if (!story) return;
      commit(settle(createInitialState(story), story), 'start', { enterFromTitle: false });
    },

    backToTitle: () => {
      set({ screen: 'title', story: null, state: null, position: null, enterFromTitle: false });
    },

    setPosition: (pos) => {
      const { story, state, storage, seq } = get();
      if (!story || !state || state.ended) return;
      if (!pos.key.startsWith(`${seq}:`)) return;
      const seg = segmentOf(story, state);
      savePosition(storage, {
        storyId: state.storyId,
        segKey: seg.key,
        nodeId: state.currentNodeId,
        historyLength: state.history.length,
        anchor: pos.anchor,
        spot: locate(seg, pos.bottom),
        savedAt: Date.now(),
      });
      set({ position: pos });
    },

    peekNextSheet: () => {
      const { story, state } = get();
      if (!story || !state) return null;
      const seg = segmentOf(story, state);
      if (seg.hasChoices) return null;
      if (seg.endsStory) return 'ending';
      const next = nextPage(state, story);
      if (next.ended) return 'ending';
      if (next.currentNodeId === state.currentNodeId) return null;
      return toSheet(segmentOf(story, settle(next, story)), 'peek:next');
    },

    peekPrevSheet: () => {
      const { story, state } = get();
      if (!story || !state) return null;
      const seg = segmentOf(story, state);
      if (seg.startIndex <= 0) return null;
      return toSheet(segmentOf(story, rewindTo(state, seg.startIndex - 1)), 'peek:prev');
    },

    peekPickSheet: (choiceId) => {
      const { story, state } = get();
      if (!story || !state) return null;
      const chosen = choose(state, story, choiceId);
      if (chosen === state) return null;
      return toSheet(segmentOf(story, settle(chosen, story)), 'peek:pick');
    },

    peekAutosave: () => {
      const { storage } = get();
      const rec = loadAutosave(storage);
      if (!rec) return null;
      const story = findStory(rec.state.storyId);
      const pos = loadPosition(storage);
      return describeAutosave(rec, story, positionMatches(pos, rec.state) ? pos.spot : null);
    },

    defaultStoryId: () => {
      const rec = loadAutosave(get().storage);
      if (rec && loaded.stories.some((s) => s.meta.id === rec.storyId)) return rec.storyId;
      return loaded.manifest[0]?.id ?? null;
    },
  };
});

/** —— 供组件使用的派生选择器（集中在此，UI 不直接依赖引擎内部） —— */

/** 当前所在的一段（按状态缓存，状态不变则同一对象）。 */
export function selectSegment(s: EngineStore): Segment | null {
  if (!s.story || !s.state) return null;
  return segmentOf(s.story, s.state);
}

export function selectEndedEnding(s: EngineStore) {
  if (!s.story || !s.state || !s.state.ended) return null;
  return findEnding(s.story, s.state.ended);
}
