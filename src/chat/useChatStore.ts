/**
 * 聊天模式的状态：剧本库 + 当前会话。会话每步自动存进 localStorage（每个剧本一份）。
 * UI 只调这里的动作，不直接碰引擎。
 */
import { create } from 'zustand';
import type { Story } from '../engine/types';
import type { CompileError } from '../parser/compiler';
import {
  buildLibrary,
  builtIn,
  compileImport,
  readImports,
  writeImports,
  type ChatLibraryItem,
  type ImportedSource,
} from './library';
import {
  isSessionValid,
  pickChat,
  startChat,
  stepChat,
  undoChoice,
  type ChatSession,
} from './transcript';

const SAVE_PREFIX = 'inov:chat:save:';

function loadSession(story: Story): ChatSession | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + story.meta.id);
    const data: unknown = raw ? JSON.parse(raw) : null;
    return isSessionValid(story, data) ? data : null;
  } catch {
    return null;
  }
}

function saveSession(story: Story, session: ChatSession): void {
  try {
    localStorage.setItem(SAVE_PREFIX + story.meta.id, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function hasSave(storyId: string): boolean {
  try {
    return localStorage.getItem(SAVE_PREFIX + storyId) !== null;
  } catch {
    return false;
  }
}

interface ChatStore {
  library: ChatLibraryItem[];
  /** 内置剧本的编译错误（作者改坏 src/chats 时显示） */
  builtInErrors: CompileError[];
  /** 最近一次导入的错误 */
  importErrors: CompileError[];
  story: Story | null;
  session: ChatSession | null;

  open: (storyId: string) => void;
  close: () => void;
  next: () => void;
  pick: (choiceId: string) => void;
  undo: () => void;
  restart: () => void;
  importFile: (file: ImportedSource) => boolean;
  removeImport: (storyId: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => {
  const commit = (session: ChatSession) => {
    const { story } = get();
    if (!story) return;
    saveSession(story, session);
    set({ session });
  };

  return {
    library: buildLibrary(readImports()),
    builtInErrors: builtIn.errors,
    importErrors: [],
    story: null,
    session: null,

    open: (storyId) => {
      const item = get().library.find((x) => x.story.meta.id === storyId);
      if (!item) return;
      const story = item.story;
      const session = loadSession(story) ?? startChat(story);
      saveSession(story, session);
      set({ story, session });
    },

    close: () => set({ story: null, session: null }),

    next: () => {
      const { story, session } = get();
      if (story && session) commit(stepChat(story, session));
    },

    pick: (choiceId) => {
      const { story, session } = get();
      if (story && session) commit(pickChat(story, session, choiceId));
    },

    undo: () => {
      const { session } = get();
      if (session) commit(undoChoice(session));
    },

    restart: () => {
      const { story } = get();
      if (story) commit(startChat(story));
    },

    importFile: (file) => {
      const { story, errors } = compileImport(file);
      if (!story) {
        set({ importErrors: errors });
        return false;
      }
      // 同 id 的旧导入被替换
      const others = readImports().filter((f) => compileImport(f).story?.meta.id !== story.meta.id);
      const list = [...others, file];
      writeImports(list);
      set({ library: buildLibrary(list), importErrors: [] });
      return true;
    },

    removeImport: (storyId) => {
      const list = readImports().filter((f) => compileImport(f).story?.meta.id !== storyId);
      writeImports(list);
      set({ library: buildLibrary(list) });
    },
  };
});
