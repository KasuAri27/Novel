/**
 * M6 播放器：NVL/ADV 底框 + 立绘层 + 背景层（Dark Theatrical 视觉）。
 * 数据流：engine.step(state, input) → events → 渲染。
 * 事件：say / showChoice / showEcho / chapterTitle / ending / setBackground（音乐留待以后）。
 * 立绘：speaker → story.assets.portraits（来自 story/assets.yaml），淡入切换；旁白时压暗。
 * 背景：节点事件 setBackground(id) → story.assets.backgrounds，双层交叉淡入；无背景节点沿用上一张。
 */
import { createEngine } from '../engine/step.ts';
import type { EngineState, Event, SaveData, Story } from '../engine/types.ts';
import './style.css';

type Page =
  | { kind: 'say'; speaker: string; text: string }
  | { kind: 'title'; n: number; title: string }
  | { kind: 'choice'; id: string; prompt: string; options: { key: string; text: string }[] }
  | { kind: 'ending'; id: string };

type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  typewriter: boolean;
  typewriterCps: number;
  autoWaitSeconds: number;
};

type SaveEntry = {
  data: SaveData;
  time: string;
  pages?: Page[];
  recentText?: string;
};

const SAVE_PREFIX = 'majo_save_';
const SETTINGS_KEY = 'majo_reader_settings_v1';
const SLOT_KEYS = ['auto', '1', '2', '3'] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function isPageSnapshot(value: unknown): value is Page[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const page = item as Record<string, unknown>;
    if (page.kind === 'say') return typeof page.speaker === 'string' && typeof page.text === 'string';
    if (page.kind === 'title') return typeof page.n === 'number' && typeof page.title === 'string';
    if (page.kind === 'ending') return typeof page.id === 'string';
    return page.kind === 'choice'
      && typeof page.id === 'string'
      && typeof page.prompt === 'string'
      && Array.isArray(page.options)
      && page.options.every((option) => option && typeof option.key === 'string' && typeof option.text === 'string');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredSaveValid(data: SaveData, story: Story, currentHash: string): boolean {
  const raw = data as unknown as Record<string, unknown>;
  if (raw.v !== 1 || typeof raw.storyHash !== 'string' || typeof raw.nodeId !== 'string') return false;
  if (!Number.isInteger(raw.cursor) || (raw.cursor as number) < 0) return false;
  if (!isRecord(raw.vars) || !isRecord(raw.facts) || !isRecord(raw.rels) || !Array.isArray(raw.history)) return false;
  if (!Object.values(raw.vars).every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  if (!Object.values(raw.facts).every((value) => typeof value === 'boolean')) return false;
  if (!Object.values(raw.rels).every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  if (!raw.history.every((item) => isRecord(item) && typeof item.choiceId === 'string' && typeof item.key === 'string')) return false;

  if (raw.storyHash === currentHash) {
    const nodeId = raw.nodeId;
    const cursor = raw.cursor as number;
    const node = story.nodes[nodeId];
    if (nodeId === '') {
      if (cursor !== 0) return false;
    } else if (!node || cursor > node.blocks.length) {
      return false;
    }
    const vars = raw.vars;
    if (Object.keys(vars).length !== Object.keys(story.vars).length) return false;
    for (const [key, def] of Object.entries(story.vars)) {
      const value = vars[key];
      if (typeof value !== 'number' || value < def.min || value > def.max) return false;
    }
    const choices = new Map<string, Set<string>>();
    for (const candidate of Object.values(story.nodes)) {
      if (candidate.next.kind === 'choice') choices.set(candidate.next.id, new Set(candidate.next.options.map((option) => option.key)));
    }
    for (const item of raw.history as Record<string, string>[]) {
      if (!choices.get(item.choiceId)?.has(item.key)) return false;
    }
  }
  return true;
}

function isEngineStateValid(state: EngineState, story: Story): boolean {
  if (!Number.isInteger(state.cursor) || state.cursor < 0) return false;
  if (state.nodeId === '') return state.cursor === 0;
  const node = story.nodes[state.nodeId];
  return Boolean(node) && state.cursor <= node!.blocks.length;
}

function readSettings(defaults: ReaderSettings): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ReaderSettings>;
    const number = (value: unknown, min: number, max: number, fallback: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.min(max, Math.max(min, value));
    };
    return {
      fontSize: number(saved.fontSize, 16, 32, defaults.fontSize),
      lineHeight: Math.round(number(saved.lineHeight, 1.4, 2.2, defaults.lineHeight) * 10) / 10,
      typewriter: typeof saved.typewriter === 'boolean' ? saved.typewriter : defaults.typewriter,
      typewriterCps: number(saved.typewriterCps, 10, 80, defaults.typewriterCps),
      autoWaitSeconds: number(saved.autoWaitSeconds, 0.5, 5, defaults.autoWaitSeconds),
    };
  } catch {
    return defaults;
  }
}

function writeSettings(settings: ReaderSettings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (tag === 'button') (n as HTMLButtonElement).type = 'button';
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
        break; // setBackground 由 handleStageEvents 处理；showSprite 等暂不处理
    }
  }
  return out;
}

async function main(): Promise<void> {
  const story = await loadStory();
  const engine = createEngine(story);
  const currentStoryHash = engine.save(engine.initialState()).storyHash;
  const chapterByNode = new Map<string, { n: number; title: string }>();
  for (const c of story.chapters) for (const id of c.nodes) chapterByNode.set(id, { n: c.n, title: c.title });

  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const stage = make('div', 'stage');
  // 背景：两层叠放做交叉淡入（当前层 + 下一层），上面盖一层暗幕压低原图亮度
  const bgWrap = make('div', 'bg-wrap');
  const bgLayers = [make('div', 'bg-layer'), make('div', 'bg-layer')];
  const bgVeil = make('div', 'bg-veil');
  bgWrap.append(bgLayers[0], bgLayers[1], bgVeil);
  const sprites = make('div', 'sprites');
  const titleOverlay = make('div', 'title-overlay hidden');
  // 底部对白栏：原版游戏 ADV 打印机素材（框体 / 暗幕 / 名字牌 / 输入指示）
  const dialog = make('div', 'adv');
  const advScreen = make('img', 'adv-screen');
  advScreen.src = 'ui/adv/adv_screen.png';
  advScreen.alt = '';
  advScreen.draggable = false;
  const advFrame = make('img', 'adv-frame');
  advFrame.src = 'ui/adv/adv_frame.png';
  advFrame.alt = '';
  advFrame.draggable = false;
  const namePlate = make('img', 'adv-name');
  namePlate.src = 'ui/adv/name_plate.png';
  namePlate.alt = '';
  namePlate.draggable = false;
  const nameBox = make('div', 'adv-name-text');
  const textBox = make('div', 'adv-text');
  const cue = make('div', 'adv-cue');
  const cueIcon = make('img');
  cueIcon.src = 'ui/adv/input_indicator.png';
  cueIcon.alt = '';
  cueIcon.draggable = false;
  cue.append(cueIcon);
  dialog.append(advScreen, advFrame, namePlate, nameBox, textBox, cue);
  const choiceLayer = make('div', 'choices hidden');
  const hint = make('div', 'hint', '点击 / 空格 / Enter 继续');
  const endingLayer = make('div', 'ending hidden');
  const toolbar = make('div', 'toolbar');
  stage.append(bgWrap, sprites, titleOverlay, dialog, choiceLayer, endingLayer, hint, toolbar);
  const savelayer = make('div', 'savelayer hidden');
  savelayer.setAttribute('role', 'dialog');
  savelayer.setAttribute('aria-modal', 'true');
  app.append(stage, savelayer);

  let state: EngineState = engine.initialState();
  let pages: Page[] = [];
  let typing = false;
  let typeTimer = 0;
  let fullText = '';
  let recentText = '';
  // 系统开了「减少动态效果」就不默认播打字机；用户设置保存在本机。
  const settings = readSettings({
    fontSize: window.matchMedia('(max-width: 640px)').matches ? 18 : 22,
    lineHeight: 1.9,
    typewriter: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    typewriterCps: 45,
    autoWaitSeconds: 1,
  });
  let autoOn = false;
  let autoTimer = 0;
  let panelReturnFocus: HTMLElement | null = null;
  let autoButton: HTMLButtonElement | null = null;
  let rewindButton: HTMLButtonElement | null = null;

  const applyReaderSettings = (): void => {
    dialog.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    dialog.style.setProperty('--reader-line-height', String(settings.lineHeight));
  };
  applyReaderSettings();

  const updateToolbar = (): void => {
    autoButton?.classList.toggle('active', autoOn);
    autoButton?.setAttribute('aria-pressed', String(autoOn));
    if (!rewindButton) return;
    const canRewind = state.history.length > 0;
    rewindButton.disabled = !canRewind;
    rewindButton.title = canRewind ? '回退上一个选择' : '暂无可回退的选择';
    rewindButton.setAttribute('aria-label', rewindButton.title);
  };

  // ---- 打字机 ----
  const type = (text: string): void => {
    window.clearTimeout(typeTimer);
    fullText = text;
    textBox.textContent = '';
    cue.classList.add('hidden');
    if (!settings.typewriter) {
      textBox.textContent = text;
      typing = false;
      cue.classList.remove('hidden');
      scheduleAuto();
      return;
    }
    typing = true;
    const chars = Array.from(text);
    let i = 0;
    const tick = (): void => {
      i += 1;
      textBox.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) {
        typing = false;
        cue.classList.remove('hidden');
        scheduleAuto();
        return;
      }
      typeTimer = window.setTimeout(tick, 1000 / settings.typewriterCps);
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

  // ---- 背景 ----
  // 背景文件名来自 story/assets.yaml（编译进 story.json 的 assets.backgrounds）。
  const bgMap = story.assets?.backgrounds ?? {};
  const bgCache = new Map<string, HTMLImageElement>();
  let curBg: string | null = null; // 当前显示（或正在切换去向）的背景 id
  let pendingBg: string | null = null; // 正在预载、等加载完再换上的背景 id
  let bgLoadSeq = 0; // 预载序号：乱序加载回来时只认最新一次
  let frontLayer = 0; // 当前显示在前面的图层下标

  const applyBackground = (id: string | undefined | null): void => {
    if (!id) return;
    if (id === curBg) {
      // 回到当前背景：取消还没换完的切换
      if (pendingBg) {
        bgLoadSeq += 1;
        pendingBg = null;
      }
      return;
    }
    if (id === pendingBg) return;
    const file = bgMap[id];
    if (!file) return; // 未声明的背景 id 静默忽略（story:check 已保证不出现）
    pendingBg = id;
    const seq = (bgLoadSeq += 1);
    let img = bgCache.get(id);
    if (!img) {
      img = new Image();
      img.src = `backgrounds/${file}`;
      img.decoding = 'async';
      bgCache.set(id, img);
    }
    const swap = (): void => {
      if (seq !== bgLoadSeq) return; // 已经有更新的目标了
      const back = 1 - frontLayer;
      const prev = frontLayer;
      const layer = bgLayers[back]!;
      layer.style.backgroundImage = `url("backgrounds/${file}")`;
      // 下一帧再触发过渡，让新图先有机会解码一帧
      requestAnimationFrame(() => {
        if (seq !== bgLoadSeq) return;
        layer.classList.add('show');
        bgLayers[prev]!.classList.remove('show');
        frontLayer = back;
        curBg = id;
        pendingBg = null;
      });
    };
    if (img.complete) {
      swap();
    } else {
      img.addEventListener('load', swap, { once: true });
      img.addEventListener(
        'error',
        () => {
          if (seq === bgLoadSeq) pendingBg = null;
        },
        { once: true },
      );
    }
  };

  // 存读档 / 回退后用当前节点重设背景（__end 是编译期合成的结局节，沿用父节点的背景）
  const bgForNode = (nodeId: string): string | undefined => {
    const n = story.nodes[nodeId];
    if (!n) return undefined;
    if (n.bg) return n.bg;
    const parent = nodeId.replace(/__end$/, '');
    return parent === nodeId ? undefined : story.nodes[parent]?.bg;
  };

  const restoreBackground = (): void => {
    applyBackground(bgForNode(state.nodeId));
  };

  // 首屏之后错峰预载全部背景，让切换尽量无等待
  const preloadBackgrounds = (): void => {
    for (const [id, file] of Object.entries(bgMap)) {
      if (bgCache.has(id)) continue;
      const img = new Image();
      img.src = `backgrounds/${file}`;
      img.decoding = 'async';
      bgCache.set(id, img);
    }
  };

  // 舞台事件（背景等）不进对白队列，收到就立刻处理
  const handleStageEvents = (events: Event[]): void => {
    for (const e of events) {
      if (e.type === 'setBackground') applyBackground(e.id);
    }
  };

  // ---- 渲染 ----
  const renderSay = (p: Extract<Page, { kind: 'say' }>): void => {
    endingLayer.classList.add('hidden');
    choiceLayer.classList.add('hidden');
    dialog.classList.remove('hidden');
    // 旁白/无名说话人：原版不显示名字牌
    dialog.classList.toggle('narration', p.speaker === '旁白');
    hint.classList.remove('hidden', 'choice-state');
    hint.textContent = '点击 / 空格 / Enter 继续';
    textBox.scrollTop = 0;
    nameBox.textContent = p.speaker === '旁白' ? '' : p.speaker;
    showPortrait(p.speaker);
    type(p.text);
  };

  const showTitle = (p: Extract<Page, { kind: 'title' }>): void => {
    titleOverlay.innerHTML = '';
    titleOverlay.append(
      make('div', 'chapter-no', `第 ${String(p.n).padStart(2, '0')} 章`),
      make('h2', 'cn', p.title.replace(/^第[一二三四五六七八九十\d]+章[　\s·:：-]*/, '')),
    );
    const continueButton = make('button', 'continue', '继续阅读');
    continueButton.onclick = () => onClick();
    titleOverlay.append(continueButton);
    dialog.classList.add('hidden');
    choiceLayer.classList.add('hidden');
    hint.classList.add('hidden');
    titleOverlay.classList.remove('hidden');
  };

  const renderChoices = (p: Extract<Page, { kind: 'choice' }>): void => {
    choiceLayer.innerHTML = '';
    choiceLayer.scrollTop = 0;
    dialog.classList.add('hidden');
    endingLayer.classList.add('hidden');
    hint.classList.add('hidden');
    const prompt = make('div', 'prompt', p.prompt || '你决定——');
    prompt.setAttribute('aria-live', 'polite');
    choiceLayer.append(prompt, make('div', 'choice-status', '请选择一个选项'));
    for (const o of p.options) {
      const b = make('button');
      b.append(make('span', 'k', o.key), make('span', 't', o.text));
      b.setAttribute('aria-label', `${o.key}：${o.text}`);
      b.onclick = (e) => {
        e.stopPropagation();
        choose(o.key);
      };
      choiceLayer.append(b);
    }
    choiceLayer.setAttribute('role', 'group');
    choiceLayer.setAttribute('aria-label', '选择一个选项');
    choiceLayer.classList.remove('hidden');
    cue.classList.add('hidden');
  };

  const renderEnding = (p: Extract<Page, { kind: 'ending' }>): void => {
    dialog.classList.add('hidden');
    choiceLayer.classList.add('hidden');
    hint.classList.add('hidden');
    endingLayer.innerHTML = '';
    const restart = make('button', '', '重新开始');
    restart.onclick = () => {
      state = engine.initialState();
      pages = [];
      recentText = '';
      updateToolbar();
      dialog.classList.remove('hidden');
      endingLayer.classList.add('hidden');
      clearPortraits();
      restoreBackground();
      sync();
    };
    endingLayer.append(make('div', 'tag', 'THE END'), make('div', 'id', p.id), restart);
    endingLayer.classList.remove('hidden');
    cue.classList.add('hidden');
  };

  // ---- 主循环 ----
  const sync = (): void => {
    window.clearTimeout(autoTimer);
    updateToolbar();
    if (pages.length === 0) {
      const r = engine.step(state, { type: 'advance' });
      state = r.state;
      handleStageEvents(r.events);
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

  const rememberRead = (text: string): void => {
    const summary = shortSummary(text);
    if (summary) recentText = summary;
  };

  const onClick = (): void => {
    if (panelOpen()) return;
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
      if (p.kind === 'say') rememberRead(p.text);
      pages.shift();
      saveTo('auto');
      sync();
    }
  };

  const choose = (key: string): void => {
    if (pages[0]?.kind === 'choice') pages.shift();
    const r = engine.step(state, { type: 'choose', key });
    state = r.state;
    updateToolbar();
    handleStageEvents(r.events);
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
    updateToolbar();
    pages = [];
    recentText = '';
    textBox.textContent = '';
    clearPortraits();
    restoreBackground();
    sync();
  };

  // ---- 存档、读档与阅读设置 ----
  const panelOpen = (): boolean => !savelayer.classList.contains('hidden');

  const focusPanel = (selector?: string): void => {
    const target = selector ? savelayer.querySelector<HTMLElement>(selector) : null;
    const first = savelayer.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    (target ?? first)?.focus();
  };

  const showPanel = (render: () => void, focusSelector?: string): void => {
    if (!panelOpen()) {
      panelReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      stage.setAttribute('aria-hidden', 'true');
    }
    window.clearTimeout(autoTimer);
    savelayer.classList.remove('hidden');
    render();
    savelayer.scrollTop = 0;
    focusPanel(focusSelector);
  };

  const closePanel = (): void => {
    if (!panelOpen()) return;
    savelayer.classList.add('hidden');
    stage.removeAttribute('aria-hidden');
    panelReturnFocus?.focus();
    panelReturnFocus = null;
    scheduleAuto();
  };

  const panelHeading = (title: string): void => {
    const heading = make('h2', '', title);
    heading.id = 'player-panel-title';
    savelayer.setAttribute('aria-labelledby', heading.id);
    savelayer.append(heading);
  };

  const panelActions = (showMenu: () => void): HTMLDivElement => {
    const actions = make('div', 'panel-actions');
    const back = make('button', 'close', '返回菜单');
    back.onclick = showMenu;
    const close = make('button', 'close', '关闭');
    close.onclick = closePanel;
    actions.append(back, close);
    return actions;
  };

  const readSlot = (k: SlotKey): SaveEntry | null => {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + k);
      if (!raw) return null;
      const obj = JSON.parse(raw) as { time?: unknown; data?: unknown; pages?: unknown; recentText?: unknown };
      if (!obj.data || typeof obj.data !== 'object') return null;
      const data = obj.data as SaveData;
      if (typeof data.nodeId !== 'string' || typeof data.storyHash !== 'string') return null;
      return {
        data,
        time: typeof obj.time === 'string' ? obj.time : '时间未知',
        pages: isPageSnapshot(obj.pages) ? obj.pages : undefined,
        recentText: typeof obj.recentText === 'string' ? obj.recentText : undefined,
      };
    } catch {
      return null;
    }
  };

  // 新存档同时记下播放器待播页；storyHash 不匹配时读档会忽略这个快照。
  const shortSummary = (text: string): string => {
    const clean = text.replace(/\s+/g, ' ').trim();
    const chars = Array.from(clean);
    return chars.length > 96 ? `${chars.slice(0, 96).join('')}…` : clean;
  };

  const saveTo = (k: SlotKey, preferVisibleText = false): boolean => {
    const visibleText = pages[0]?.kind === 'say' && !dialog.classList.contains('hidden')
      ? shortSummary(textBox.textContent ?? '')
      : '';
    const payload = {
      time: new Date().toLocaleString('zh-CN'),
      data: engine.save(state),
      pages: [...pages],
      recentText: preferVisibleText && visibleText ? visibleText : recentText,
    };
    try {
      localStorage.setItem(SAVE_PREFIX + k, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  const chapterLabel = (nodeId: string): string => {
    const chapter = chapterByNode.get(nodeId) ?? chapterByNode.get(nodeId.replace(/__end$/, ''));
    if (chapter) return chapter.title;
    const n = story.nodes[nodeId]?.chapter;
    return n ? `第 ${String(n).padStart(2, '0')} 章` : nodeId;
  };

  const showMenu = (): void => showPanel(() => {
    savelayer.innerHTML = '';
    panelHeading('菜单');
    const menu = make('div', 'menu-actions');
    const save = make('button', 'menu-action', '存档');
    save.onclick = () => showSlots(true);
    const load = make('button', 'menu-action', '读档');
    load.onclick = () => showSlots(false);
    const settingsButton = make('button', 'menu-action', '阅读设置');
    settingsButton.onclick = () => showSettings();
    const close = make('button', 'close', '关闭');
    close.onclick = closePanel;
    menu.append(save, load, settingsButton);
    savelayer.append(menu, close);
  });

  const showSlots = (modeSave: boolean, message = '', focusSlot?: SlotKey): void => showPanel(() => {
    savelayer.innerHTML = '';
    panelHeading(modeSave ? '存档' : '读档');
    const status = make('div', 'panel-status', message);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const grid = make('div', 'slots');
    for (const k of SLOT_KEYS) {
      const entry = readSlot(k);
      const readonlyAuto = modeSave && k === 'auto';
      const slot = make('button', 'slot' + (k === 'auto' ? ' auto' : '') + (entry ? '' : ' empty'));
      slot.dataset.slot = k;
      slot.disabled = readonlyAuto || (!modeSave && !entry);
      const no = make('div', 'no', k === 'auto' ? 'AUTO · 自动保存' : `SLOT ${k}`);
      const chapter = make('div', 'ch', entry ? chapterLabel(entry.data.nodeId) : '— 空 —');
      const time = make('div', 'tm', entry ? entry.time : readonlyAuto ? '自动存档仅由游戏更新' : modeSave ? '选择以保存' : '尚未使用');
      const summary = make('div', 'summary', entry?.recentText || '暂无已读摘要');
      slot.append(no, chapter, time, summary);
      slot.onclick = () => {
        if (modeSave) {
          if (k === 'auto') return;
          if (entry && !window.confirm(`覆盖 SLOT ${k} 的现有存档？`)) return;
          const ok = saveTo(k, true);
          const result = ok ? `已保存到 SLOT ${k}。` : '保存失败：本机存储不可用或空间不足。';
          showSlots(true, result, k);
        } else if (entry) {
          doLoad(entry, k);
        }
      };
      grid.append(slot);
    }
    const actions = panelActions(showMenu);
    savelayer.append(status, grid, actions);
  }, focusSlot ? `[data-slot="${focusSlot}"]` : undefined);

  const showSettings = (message = ''): void => showPanel(() => {
    savelayer.innerHTML = '';
    panelHeading('阅读设置');
    const form = make('div', 'settings-list');
    const status = make('div', 'panel-status', message);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const persist = (): void => {
      applyReaderSettings();
      status.textContent = writeSettings(settings) ? '' : '设置已应用，但无法保存到本机。';
    };
    const addRange = (label: string, key: 'fontSize' | 'lineHeight' | 'typewriterCps' | 'autoWaitSeconds', min: number, max: number, step: number, format: (value: number) => string): void => {
      const row = make('label', 'setting-row');
      const caption = make('span', 'setting-label');
      const output = make('output', 'setting-value', format(settings[key]));
      caption.append(document.createTextNode(label), output);
      const input = make('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(settings[key]);
      input.setAttribute('aria-label', label);
      input.oninput = () => {
        settings[key] = Number(input.value);
        output.textContent = format(settings[key]);
        persist();
      };
      row.append(caption, input);
      form.append(row);
    };

    addRange('字号', 'fontSize', 16, 32, 1, (value) => `${Math.round(value)} px`);
    addRange('行距', 'lineHeight', 1.4, 2.2, 0.1, (value) => value.toFixed(1));
    addRange('打字机速度', 'typewriterCps', 10, 80, 5, (value) => `${Math.round(value)} 字 / 秒`);
    addRange('自动基础等待', 'autoWaitSeconds', 0.5, 5, 0.5, (value) => `${value.toFixed(1)} 秒`);

    const toggleRow = make('label', 'setting-row setting-toggle');
    const toggleText = make('span', 'setting-label', '打字机效果');
    const toggle = make('input');
    toggle.type = 'checkbox';
    toggle.checked = settings.typewriter;
    toggle.setAttribute('aria-label', '打字机效果');
    toggle.onchange = () => {
      settings.typewriter = toggle.checked;
      persist();
      if (!settings.typewriter) finishTyping();
    };
    toggleRow.append(toggleText, toggle);
    form.append(toggleRow);
    savelayer.append(status, form, panelActions(showMenu));
  });

  const doLoad = (entry: SaveEntry, slot: SlotKey): void => {
    const previousState = state;
    const previousPages = [...pages];
    const previousRecentText = recentText;
    let applied = false;
    try {
      if (!isStoredSaveValid(entry.data, story, currentStoryHash)) throw new Error('无效存档');
      const { state: loaded, warned } = engine.load(entry.data);
      if (!isEngineStateValid(loaded, story)) throw new Error('读档后的节点或进度无效');
      state = loaded;
      pages = !warned && entry.pages && isPageSnapshot(entry.pages) ? [...entry.pages] : [];
      recentText = warned ? '' : entry.recentText ?? '';
      applied = true;
      updateToolbar();
      window.clearTimeout(typeTimer);
      typing = false;
      dialog.classList.remove('hidden');
      endingLayer.classList.add('hidden');
      textBox.textContent = '';
      clearPortraits();
      restoreBackground();
      sync();
      closePanel();
      if (warned) window.alert('剧情已更新，已尝试用历史记录重放恢复进度。');
    } catch {
      if (applied) {
        state = previousState;
        pages = previousPages;
        recentText = previousRecentText;
        updateToolbar();
        window.clearTimeout(typeTimer);
        typing = false;
        try {
          sync();
        } catch {
          /* 保留原存档状态，错误仍在弹层中说明。 */
        }
      }
      showSlots(false, '读档失败：存档数据无效或与当前剧情不兼容。', slot);
    }
  };

  savelayer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = Array.from(savelayer.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || !savelayer.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !savelayer.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---- 自动播放 ----
  const scheduleAuto = (): void => {
    window.clearTimeout(autoTimer);
    const page = pages[0];
    if (!autoOn || panelOpen() || typing || page?.kind !== 'say') return;
    const length = Array.from(page.text).length;
    const delay = settings.autoWaitSeconds * 1000 + Math.max(0, length - 10) * 70;
    autoTimer = window.setTimeout(() => {
      if (autoOn && !panelOpen() && !typing && pages[0]?.kind === 'say') onClick();
    }, delay);
  };

  // ---- 工具栏 ----
  const addBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = make('button', '', label);
    b.onclick = fn;
    toolbar.append(b);
    return b;
  };
  autoButton = addBtn('自动', () => {
    autoOn = !autoOn;
    updateToolbar();
    scheduleAuto();
  });
  autoButton.setAttribute('aria-label', '自动播放');
  rewindButton = addBtn('回退', rewind);
  addBtn('菜单', showMenu);
  updateToolbar();

  // ---- 输入 ----
  const isInteractiveTarget = (target: EventTarget | null): boolean => target instanceof Element
    && Boolean(target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="button"]'));

  stage.addEventListener('click', (e) => {
    if (isInteractiveTarget(e.target)) return;
    if (!choiceLayer.classList.contains('hidden')) return;
    onClick();
  });
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || panelOpen() || isInteractiveTarget(e.target)) return;
    const page = pages[0];
    if ((e.code === 'Space' || e.code === 'Enter') && (page?.kind === 'say' || page?.kind === 'title')) {
      e.preventDefault();
      onClick();
    }
  });

  sync();
  // 首屏渲染完再错峰预载其余背景，避免开场时抢带宽
  window.setTimeout(preloadBackgrounds, 1500);
}

main().catch((err: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
});
