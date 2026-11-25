/**
 * 引擎状态绑定（小说阅读模式）：用 zustand 把纯函数引擎接到 React。
 * UI 只跟这个 store 打交道，完全不碰引擎/parser 细节。
 *
 * 阅读模型：screen = title | play | ending。
 * 进度只走浏览器自动存档（单一槽位），没有读档页。
 */
import { create } from 'zustand';
import type { Choice, GameState, Line, Story, StoryNode } from '../../core/engine/types';
import { availableChoices, choose, nextPage, rewind as engRewind } from '../../core/engine/reducer';
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
import { describeAutosave, type AutosavePreview } from './progress';

export type Screen = 'title' | 'play' | 'ending';
export type Page = 'reading' | 'choices';

interface EngineStore {
  manifest: StorySummary[];
  compileErrors: CompileError[];
  screen: Screen;
  page: Page;
  story: Story | null;
  state: GameState | null;
  storage: Storage;
  /** 本次进入阅读页是否播放 Title → 书本推进动画 */
  enterFromTitle: boolean;

  /** 装入新开局（不切屏，供标题过渡动画使用） */
  bootNewGame: (id: string) => boolean;
  /** 装入自动存档（不切屏） */
  bootContinue: () => boolean;
  /** 切到阅读屏 */
  enterPlay: () => void;
  newGame: (id: string) => void;
  continueReading: () => boolean;
  goChoices: () => void;
  goReading: () => void;
  pick: (choiceId: string) => void;
  turnPage: () => void;
  rewind: () => void;
  restart: () => void;
  backToTitle: () => void;
  peekAutosave: () => AutosavePreview | null;
  defaultStoryId: () => string | null;
}

const loaded = getStories();

function persist(storage: Storage, state: GameState | null) {
  if (!state) return;
  saveAutosave(storage, state);
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  manifest: loaded.manifest,
  compileErrors: loaded.errors,
  screen: 'title',
  page: 'reading',
  story: null,
  state: null,
  storage: createDefaultStorage(),
  enterFromTitle: false,

  bootNewGame: (id) => {
    const story = loaded.stories.find((s) => s.meta.id === id) ?? null;
    if (!story) return false;
    const state = createInitialState(story);
    persist(get().storage, state);
    set({ story, state, page: 'reading', enterFromTitle: true });
    return true;
  },

  bootContinue: () => {
    const rec = loadAutosave(get().storage);
    if (!rec) return false;
    const story = loaded.stories.find((s) => s.meta.id === rec.state.storyId) ?? null;
    if (!story) return false;
    set({
      story,
      state: rec.state,
      page: 'reading',
      enterFromTitle: true,
    });
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

  goChoices: () => set({ page: 'choices' }),
  goReading: () => set({ page: 'reading' }),

  pick: (choiceId) => {
    const { story, state, storage } = get();
    if (!story || !state || state.ended) return;
    const next = choose(state, story, choiceId);
    persist(storage, next);
    set({ state: next, page: 'reading' });
  },

  turnPage: () => {
    const { story, state, storage } = get();
    if (!story || !state || state.ended) return;
    const next = nextPage(state, story);
    persist(storage, next);
    set({ state: next, page: 'reading', screen: next.ended ? 'ending' : 'play' });
  },

  rewind: () => {
    const { state, storage } = get();
    if (!state) return;
    const next = engRewind(state);
    persist(storage, next);
    set({ state: next, page: 'reading', screen: next.ended ? 'ending' : 'play' });
  },

  restart: () => {
    const { story, storage } = get();
    if (!story) return;
    const state = createInitialState(story);
    persist(storage, state);
    set({ state, screen: 'play', page: 'reading', enterFromTitle: false });
  },

  backToTitle: () => {
    const { storage, state } = get();
    persist(storage, state);
    set({ screen: 'title', story: null, state: null, page: 'reading', enterFromTitle: false });
  },

  peekAutosave: () => {
    const rec = loadAutosave(get().storage);
    if (!rec) return null;
    const story = loaded.stories.find((s) => s.meta.id === rec.state.storyId) ?? null;
    return describeAutosave(rec, story);
  },

  defaultStoryId: () => {
    const rec = loadAutosave(get().storage);
    if (rec && loaded.stories.some((s) => s.meta.id === rec.storyId)) return rec.storyId;
    return loaded.manifest[0]?.id ?? null;
  },
}));

/** —— 供组件使用的派生选择器（集中在此，UI 不直接依赖引擎内部） —— */

export function selectCurrentNode(s: EngineStore): StoryNode | null {
  if (!s.story || !s.state) return null;
  return s.story.nodes[s.state.currentNodeId] ?? null;
}

/** 当前页的全部正文段落 */
export function selectParagraphs(s: EngineStore): Line[] {
  return selectCurrentNode(s)?.lines ?? [];
}

/** 当前节点在给定状态下可见（when 通过）的选项 */
export function selectVisibleChoices(s: EngineStore): Choice[] {
  if (!s.story || !s.state) return [];
  return availableChoices(s.story, s.state);
}

/** 当前节点是否含分支选项 */
export function selectHasChoices(s: EngineStore): boolean {
  return (selectCurrentNode(s)?.choices.length ?? 0) > 0;
}

/** 当前节点是否叶子节点（无选项且无 goto） */
export function selectIsLeaf(s: EngineStore): boolean {
  const node = selectCurrentNode(s);
  if (!node) return false;
  return node.choices.length === 0 && !node.next;
}

/** 翻页预览：下一节点正文；无下一节点则为结局页。 */
export function selectPeekNext(s: EngineStore): { lines: Line[]; choices: Choice[]; hasChoices: boolean } | 'ending' | null {
  if (!s.story || !s.state) return null;
  const node = selectCurrentNode(s);
  if (!node) return null;
  if (node.choices.length > 0) return null;
  if (node.next && s.story.nodes[node.next]) {
    const n = s.story.nodes[node.next];
    return { lines: n.lines, choices: n.choices, hasChoices: n.choices.length > 0 };
  }
  return 'ending';
}

/** 翻页预览：历史栈顶对应节点（含当时可见选项），供向左仿真翻页。 */
export function selectPeekPrev(s: EngineStore): { lines: Line[]; choices: Choice[]; hasChoices: boolean } | null {
  if (!s.story || !s.state) return null;
  const last = s.state.history[s.state.history.length - 1];
  if (!last) return null;
  const restored: GameState = { ...last, history: s.state.history.slice(0, -1) };
  const node = s.story.nodes[restored.currentNodeId];
  if (!node) return null;
  const vis = node.choices.length > 0 ? availableChoices(s.story, restored) : [];
  return { lines: node.lines, choices: vis, hasChoices: node.choices.length > 0 };
}

export function selectEndedEnding(s: EngineStore) {
  if (!s.story || !s.state || !s.state.ended) return null;
  return findEnding(s.story, s.state.ended);
}
