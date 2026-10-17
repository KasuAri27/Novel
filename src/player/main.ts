/**
 * M6 播放器：NVL/ADV 底框 + 立绘层（Dark Theatrical 视觉）。
 * 数据流：engine.step(state, input) → events → 渲染。
 * 事件：say / showChoice / showEcho / chapterTitle / ending（背景、音乐留待以后）。
 * 立绘：speaker → story.assets.portraits（来自 story/assets.yaml），淡入切换；旁白时压暗。
 */
import { createEngine } from '../engine/step.ts';
import type { EngineState, Event, Story } from '../engine/types.ts';
import './style.css';

type Page =
  | { kind: 'say'; speaker: string; text: string }
  | { kind: 'title'; n: number; title: string }
  | { kind: 'choice'; id: string; prompt: string; options: { key: string; text: string }[] }
  | { kind: 'ending'; id: string };

const SAVE_PREFIX = 'majo_save_';
const SLOT_KEYS = ['auto', '1', '2', '3'] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function loadStory(): Promise<Story> {
  const res = await fetch('story/story.json');
  if (!res.ok) throw new Error(`无法加载 story/story.json（HTTP ${res.status}）`);
  return (await res.json()) as Story;
}

function toPages(events: Event[]): Page[] {
  const out: Page[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'say':
        out.push({ kind: 'say', speaker: e.speaker ?? '旁白', text: e.text });
        break;
      case 'showEcho':
        for (const b of e.blocks) out.push({ kind: 'say', speaker: b.speaker ?? '旁白', text: b.text });
        break;
      case 'chapterTitle':
        out.push({ kind: 'title', n: e.n, title: e.title });
        break;
      case 'showChoice':
        out.push({ kind: 'choice', id: e.id, prompt: e.prompt, options: e.options.map((o) => ({ key: o.key, text: o.text })) });
        break;
      case 'ending':
        out.push({ kind: 'ending', id: e.id });
        break;
      default:
        break; // setBackground / showSprite 等暂不处理
    }
  }
  return out;
}

async function main(): Promise<void> {
  const story = await loadStory();
  const engine = createEngine(story);
  const nodeChapter = new Map<string, string>();
  for (const c of story.chapters) for (const id of c.nodes) nodeChapter.set(id, c.title);

  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const stage = make('div', 'stage');
  const bg = make('div', 'bg');
  const sprites = make('div', 'sprites');
  const titleOverlay = make('div', 'title-overlay hidden');
  const dialog = make('div', 'dialog');
  const nameBox = make('div', 'name');
  const textBox = make('div', 'text');
  const cue = make('div', 'cue', '▼');
  dialog.append(nameBox, textBox, cue);
  const choiceLayer = make('div', 'choices hidden');
  const hint = make('div', 'hint', '点击 / 空格 继续');
  const endingLayer = make('div', 'ending hidden');
  const toolbar = make('div', 'toolbar');
  stage.append(bg, sprites, titleOverlay, dialog, choiceLayer, endingLayer, hint, toolbar);
  const savelayer = make('div', 'savelayer hidden');
  app.append(stage, savelayer);

  let state: EngineState = engine.initialState();
  let pages: Page[] = [];
  let typing = false;
  let typeTimer = 0;
  let fullText = '';
  let wait = false; // 手动模式：等待玩家点击
  // 系统开了「减少动态效果」就不默认播打字机
  let typewriter = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let autoOn = false;
  let autoTimer = 0;

  // ---- 打字机 ----
  const type = (text: string): void => {
    window.clearTimeout(typeTimer);
    fullText = text;
    textBox.textContent = '';
    cue.classList.add('hidden');
    if (!typewriter) {
      textBox.textContent = text;
      typing = false;
      cue.classList.remove('hidden');
      scheduleAuto();
      return;
    }
    typing = true;
    let i = 0;
    const tick = (): void => {
      i += 1;
      textBox.textContent = text.slice(0, i);
      if (i >= text.length) {
        typing = false;
        cue.classList.remove('hidden');
        scheduleAuto();
        return;
      }
      typeTimer = window.setTimeout(tick, 22);
    };
    tick();
  };

  const finishTyping = (): void => {
    if (!typing) return;
    window.clearTimeout(typeTimer);
    textBox.textContent = fullText;
    typing = false;
    cue.classList.remove('hidden');
    scheduleAuto();
  };

  // ---- 立绘 ----
  // 立绘文件名来自 story/assets.yaml（编译进 story.json 的 assets.portraits）。
  const portraitMap = story.assets?.portraits ?? {};
  const spriteCache = new Map<string, HTMLImageElement>();
  let lastPortrait: string | null = null; // 最后一次有立绘的说话人

  const showPortrait = (speaker: string): void => {
    const file = portraitMap[speaker];
    if (file) {
      let img = spriteCache.get(speaker);
      if (!img) {
        img = make('img', 'sprite');
        img.src = `portraits/${file}`;
        img.alt = speaker;
        img.decoding = 'async';
        sprites.append(img);
        spriteCache.set(speaker, img);
      }
      for (const [name, other] of spriteCache) {
        other.classList.toggle('active', name === speaker);
        other.classList.remove('dim');
      }
      lastPortrait = speaker;
    } else {
      // 旁白 / 无立绘角色：保留立绘但压暗
      const cur = lastPortrait ? spriteCache.get(lastPortrait) : null;
      cur?.classList.add('dim');
    }
  };

  const clearPortraits = (): void => {
    sprites.innerHTML = '';
    spriteCache.clear();
    lastPortrait = null;
  };

  // ---- 渲染 ----
  const renderSay = (p: Extract<Page, { kind: 'say' }>): void => {
    endingLayer.classList.add('hidden');
    choiceLayer.classList.add('hidden');
    nameBox.textContent = p.speaker;
    showPortrait(p.speaker);
    type(p.text);
  };

  const showTitle = (p: Extract<Page, { kind: 'title' }>): void => {
    titleOverlay.innerHTML = '';
    titleOverlay.append(
      make('div', 'en', `CHAPTER ${String(p.n).padStart(2, '0')}`),
      make('div', 'cn', p.title),
    );
    titleOverlay.classList.remove('hidden');
    cue.classList.add('hidden');
  };

  const renderChoices = (p: Extract<Page, { kind: 'choice' }>): void => {
    choiceLayer.innerHTML = '';
    choiceLayer.append(make('div', 'prompt', p.prompt || '你决定——'));
    for (const o of p.options) {
      const b = make('button');
      b.append(make('span', 'k', o.key), make('span', 't', o.text));
      b.onclick = () => choose(o.key);
      choiceLayer.append(b);
    }
    choiceLayer.classList.remove('hidden');
    cue.classList.add('hidden');
  };

  const renderEnding = (p: Extract<Page, { kind: 'ending' }>): void => {
    dialog.classList.add('hidden');
    choiceLayer.classList.add('hidden');
    endingLayer.innerHTML = '';
    const restart = make('button', '', '重新开始');
    restart.onclick = () => {
      state = engine.initialState();
      pages = [];
      dialog.classList.remove('hidden');
      endingLayer.classList.add('hidden');
      clearPortraits();
      sync();
    };
    endingLayer.append(make('div', 'tag', 'THE END'), make('div', 'id', p.id), restart);
    endingLayer.classList.remove('hidden');
    cue.classList.add('hidden');
  };

  // ---- 主循环 ----
  const sync = (): void => {
    window.clearTimeout(autoTimer);
    if (pages.length === 0) {
      const r = engine.step(state, { type: 'advance' });
      state = r.state;
      pages.push(...toPages(r.events));
    }
    const p = pages[0];
    if (!p) return;
    titleOverlay.classList.add('hidden');
    if (p.kind === 'choice') {
      renderChoices(p);
      return;
    }
    if (p.kind === 'ending') {
      renderEnding(p);
      return;
    }
    if (p.kind === 'title') {
      showTitle(p);
      return;
    }
    renderSay(p);
  };

  const onClick = (): void => {
    if (!savelayer.classList.contains('hidden')) return;
    if (!endingLayer.classList.contains('hidden')) return;
    const p = pages[0];
    if (!p) {
      sync();
      return;
    }
    if (p.kind === 'choice' || p.kind === 'ending') return;
    if (typing) {
      finishTyping();
      return;
    }
    if (p.kind === 'say' || p.kind === 'title') {
      pages.shift();
      saveTo('auto');
      sync();
    }
  };

  const choose = (key: string): void => {
    if (pages[0]?.kind === 'choice') pages.shift();
    const r = engine.step(state, { type: 'choose', key });
    state = r.state;
    pages.push(...toPages(r.events));
    saveTo('auto');
    sync();
  };

  const rewind = (): void => {
    try {
      state = engine.rewind(state);
    } catch {
      return;
    }
    pages = [];
    textBox.textContent = '';
    clearPortraits();
    sync();
  };

  // ---- 存档 ----
  const readSlot = (k: SlotKey): { data: ReturnType<typeof engine.save>; time: string } | null => {
    const raw = localStorage.getItem(SAVE_PREFIX + k);
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as { time: string; data: ReturnType<typeof engine.save> };
      return { data: obj.data, time: obj.time };
    } catch {
      return null;
    }
  };

  const saveTo = (k: SlotKey): void => {
    const payload = { time: new Date().toLocaleString('zh-CN'), data: engine.save(state) };
    try {
      localStorage.setItem(SAVE_PREFIX + k, JSON.stringify(payload));
    } catch {
      /* 忽略配额错误 */
    }
  };

  const openSave = (modeSave: boolean): void => {
    savelayer.innerHTML = '';
    savelayer.append(make('h2', '', modeSave ? '存档' : '读档'));
    const grid = make('div', 'slots');
    for (const k of SLOT_KEYS) {
      const entry = readSlot(k);
      const slot = make('div', 'slot' + (k === 'auto' ? ' auto' : '') + (entry ? '' : ' empty'));
      const meta = make('div', 'meta');
      meta.append(make('div', 'no', k === 'auto' ? 'AUTO' : `SLOT ${k}`));
      meta.append(make('div', 'ch', entry ? nodeChapter.get(entry.data.nodeId) ?? entry.data.nodeId : '— 空 —'));
      meta.append(make('div', 'tm', entry ? entry.time : '尚未使用'));
      slot.append(meta);
      slot.onclick = () => {
        if (modeSave) {
          saveTo(k);
          openSave(true);
        } else if (entry) {
          doLoad(entry.data);
        }
      };
      grid.append(slot);
    }
    const close = make('button', 'close', '返回');
    close.onclick = () => savelayer.classList.add('hidden');
    savelayer.append(grid, close);
    savelayer.classList.remove('hidden');
  };

  const doLoad = (data: ReturnType<typeof engine.save>): void => {
    const { state: s, warned } = engine.load(data);
    state = s;
    pages = [];
    dialog.classList.remove('hidden');
    endingLayer.classList.add('hidden');
    textBox.textContent = '';
    clearPortraits();
    savelayer.classList.add('hidden');
    if (warned) window.alert('剧情已更新，已尝试用历史记录重放恢复进度。');
    sync();
  };

  // ---- 自动播放 ----
  const scheduleAuto = (): void => {
    window.clearTimeout(autoTimer);
    if (!autoOn || wait) return;
    autoTimer = window.setTimeout(() => {
      if (autoOn && !wait) onClick();
    }, 1500);
  };

  // ---- 工具栏 ----
  const addBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = make('button', '', label);
    b.onclick = fn;
    toolbar.append(b);
    return b;
  };
  const autoBtn = addBtn('自动', () => {
    autoOn = !autoOn;
    autoBtn.classList.toggle('active', autoOn);
    scheduleAuto();
  });
  addBtn('回退', rewind);
  addBtn('存档', () => openSave(true));
  addBtn('读档', () => openSave(false));
  const twBtn = addBtn('打字机', () => {
    typewriter = !typewriter;
    twBtn.classList.toggle('active', typewriter);
    if (!typewriter) finishTyping();
  });
  twBtn.classList.toggle('active', typewriter);

  // ---- 输入 ----
  stage.addEventListener('click', (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    if (!choiceLayer.classList.contains('hidden')) return;
    onClick();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      onClick();
    }
  });

  sync();
}

main().catch((err: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
});
