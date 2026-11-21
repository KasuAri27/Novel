/**
 * 聊天模式页面（#chat）：
 *   - 列表：内置 / 导入的聊天剧本，每行显示最近一句；右上角导入 .txt；
 *   - 聊天室：台词一律气泡，动作环境描写一律斜体小字，选项在底部浮层。
 * 视觉：深粉毛玻璃——顶栏与底部浮层是磨砂玻璃，消息从它们下面滚过。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Story, StoryChar } from '../engine/types';
import { ImportDebugPanel } from '../ui/ImportDebugPanel';
import {
  canUndo,
  chatStatus,
  classifyChoice,
  meId,
  splitActions,
  visibleChoices,
  type ChatEntry,
} from './transcript';
import { previewLine, useChatStore } from './useChatStore';
import './chat.css';

export function ChatScreen({ onExit }: { onExit: () => void }) {
  const story = useChatStore((s) => s.story);
  return (
    <div className="chat-app">
      <div className="chat-glow" aria-hidden />
      {story ? <ChatRoom story={story} /> : <ChatLobby onExit={onExit} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 图标（内联 SVG，跟随 currentColor）
// ---------------------------------------------------------------------------

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const IconBack = () => <Icon><path d="M15 5l-7 7 7 7" /></Icon>;
const IconImport = () => <Icon><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" /></Icon>;
const IconPlay = () => <Icon><path d="M8 5.5v13l10-6.5z" /></Icon>;
const IconPause = () => <Icon><path d="M9 5.5v13M15 5.5v13" /></Icon>;
const IconUndo = () => <Icon><path d="M9 7L4.5 11.5 9 16" /><path d="M5 11.5h9a5 5 0 010 10h-2" /></Icon>;
const IconRestart = () => <Icon><path d="M4.5 12a7.5 7.5 0 102.2-5.3" /><path d="M4.5 4.5v4h4" /></Icon>;

function IconButton({ label, onClick, disabled, pressed, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chat-icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

function ChatLobby({ onExit }: { onExit: () => void }) {
  const library = useChatStore((s) => s.library);
  const builtInErrors = useChatStore((s) => s.builtInErrors);
  const importErrors = useChatStore((s) => s.importErrors);
  const open = useChatStore((s) => s.open);
  const importFile = useChatStore((s) => s.importFile);
  const removeImport = useChatStore((s) => s.removeImport);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复导入同一个文件
    if (!file) return;
    importFile({ name: file.name, source: await file.text() });
  };

  return (
    <>
      <header className="chat-head">
        <IconButton label="返回" onClick={onExit}><IconBack /></IconButton>
        <h1 className="chat-head-title">聊天</h1>
        <IconButton label="导入 .txt" onClick={() => fileRef.current?.click()}><IconImport /></IconButton>
        <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={onFile} />
      </header>

      <main className="chat-lobby">
        <ImportDebugPanel errors={[...importErrors, ...builtInErrors]} />
        {library.length === 0 && (
          <button type="button" className="chat-empty" onClick={() => fileRef.current?.click()}>
            导入一个 .txt 剧本
          </button>
        )}
        <ul className="chat-threads">
          {library.map(({ story, imported }) => (
            <li key={story.meta.id} className="chat-thread">
              <button type="button" className="chat-thread-open" onClick={() => open(story.meta.id)}>
                <AvatarStack story={story} />
                <span className="chat-thread-text">
                  <span className="chat-thread-title">{story.meta.title}</span>
                  <span className="chat-thread-preview">{previewLine(story)}</span>
                </span>
              </button>
              {imported && (
                <button type="button" className="chat-thread-remove" onClick={() => removeImport(story.meta.id)}>
                  移除
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

/** 列表头像：取前两位非主角角色叠放 */
function AvatarStack({ story }: { story: Story }) {
  const cast = Object.values(story.chars).filter((c) => !c.me).slice(0, 2);
  return (
    <span className={`chat-stack chat-stack-${cast.length}`}>
      {cast.map((c) => <Avatar key={c.id} char={c} />)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 聊天室
// ---------------------------------------------------------------------------

/** 自动播放每条的停留时间：按字数估算 */
function autoDelay(entry: ChatEntry | undefined): number {
  const len = entry && 'text' in entry ? entry.text.length : 10;
  return Math.min(3800, Math.max(1000, 600 + len * 45));
}

function ChatRoom({ story }: { story: Story }) {
  const session = useChatStore((s) => s.session)!;
  const next = useChatStore((s) => s.next);
  const pick = useChatStore((s) => s.pick);
  const undo = useChatStore((s) => s.undo);
  const restart = useChatStore((s) => s.restart);
  const close = useChatStore((s) => s.close);
  const [auto, setAuto] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLElement>(null);
  const [footH, setFootH] = useState(0);

  const status = chatStatus(story, session);
  const choices = status === 'choices' ? visibleChoices(story, session) : [];
  const me = meId(story);

  // 底部浮层高度变化时，给记录区留出同样的底边距，最后一条不被遮住
  useLayoutEffect(() => {
    const el = footRef.current;
    if (!el) {
      setFootH(0);
      return;
    }
    const ro = new ResizeObserver(() => setFootH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [session.log.length, status, footH]);

  useEffect(() => {
    if (!auto || status !== 'more') return;
    const t = window.setTimeout(next, autoDelay(session.log[session.log.length - 1]));
    return () => window.clearTimeout(t);
  }, [auto, status, session, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('button, input')) return;
      if ((e.key === ' ' || e.key === 'Enter') && status === 'more') {
        e.preventDefault();
        next();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) pick(choices[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, choices, next, pick]);

  const showFoot = status !== 'more';

  return (
    <>
      <header className="chat-head">
        <IconButton label="返回列表" onClick={close}><IconBack /></IconButton>
        <h1 className="chat-head-title">{story.meta.title}</h1>
        <div className="chat-head-tools">
          <IconButton label={auto ? '暂停自动播放' : '自动播放'} pressed={auto} onClick={() => setAuto((v) => !v)}>
            {auto ? <IconPause /> : <IconPlay />}
          </IconButton>
          <IconButton label="撤回上一个选择" onClick={undo} disabled={!canUndo(session)}><IconUndo /></IconButton>
          <IconButton label="从头开始" onClick={restart}><IconRestart /></IconButton>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="chat-log"
        style={{ paddingBottom: footH + 28 }}
        onClick={status === 'more' ? next : undefined}
        data-clickable={status === 'more'}
      >
        <div className="chat-col">
          {session.log.map((entry, i) => (
            <Entry key={i} entry={entry} story={story} me={me} prev={session.log[i - 1]} />
          ))}
          {status === 'more' && (
            <div className="chat-typing" aria-hidden>
              <i /><i /><i />
            </div>
          )}
        </div>
      </div>

      {showFoot && (
        <footer ref={footRef} className="chat-foot">
          {status === 'choices' && (
            <div className="chat-choices" role="group" aria-label="选择">
              {choices.map((c) => {
                const { style, button } = classifyChoice(c.label);
                return (
                  <button key={c.id} type="button" className={`chat-choice chat-choice-${style}`} onClick={() => pick(c.id)}>
                    {button}
                  </button>
                );
              })}
            </div>
          )}
          {status === 'ended' && (
            <div className="chat-end-actions">
              <button type="button" className="chat-choice" onClick={restart}>重新开始</button>
              <button type="button" className="chat-choice" onClick={close}>返回列表</button>
            </div>
          )}
          {(status === 'no-choices' || status === 'dead-end') && (
            <div className="chat-warn">
              <p>
                {status === 'no-choices'
                  ? '这里的选项条件都不满足，剧本无法继续。检查 [choice] 的 when 条件。'
                  : '剧情已到末尾，但没有命中任何结局。补一个不带 when 的 @end。'}
              </p>
              {canUndo(session) && (
                <button type="button" className="chat-choice" onClick={undo}>撤回上一个选择</button>
              )}
            </div>
          )}
        </footer>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 单条记录
// ---------------------------------------------------------------------------

function Entry({ entry, story, me, prev }: {
  entry: ChatEntry;
  story: Story;
  me: string | null;
  prev: ChatEntry | undefined;
}) {
  if (entry.kind === 'narr') return <p className="chat-narr">{entry.text}</p>;

  if (entry.kind === 'end') {
    return (
      <section className="chat-ending">
        <h2>{entry.title}</h2>
        {entry.text && <p>{entry.text}</p>}
      </section>
    );
  }

  if (entry.kind === 'pick') {
    if (entry.style === 'silent') return null;
    if (entry.style === 'act') return <p className="chat-narr chat-narr-self">{entry.text}</p>;
    return <Bubble char={me ? story.chars[me] : undefined} self text={entry.text} showHead={!sameSender(prev, me, me)} />;
  }

  return (
    <Bubble
      char={story.chars[entry.speaker]}
      fallbackName={entry.speaker}
      self={entry.speaker === me}
      text={entry.text}
      showHead={!sameSender(prev, entry.speaker, me)}
    />
  );
}

/** 上一条是否同一人发的气泡（是则合并：不再重复头像与名字） */
function sameSender(prev: ChatEntry | undefined, speaker: string | null, me: string | null): boolean {
  if (!prev) return false;
  if (prev.kind === 'say') return prev.speaker === speaker;
  if (prev.kind === 'pick' && prev.style === 'say') return speaker === me;
  return false;
}

function Bubble({ char, fallbackName, self, text, showHead }: {
  char: StoryChar | undefined;
  fallbackName?: string;
  self: boolean;
  text: string;
  showHead: boolean;
}) {
  const name = char?.name ?? fallbackName ?? '我';
  return (
    <div className={`chat-row${self ? ' chat-row-self' : ''}${showHead ? '' : ' chat-row-cont'}`}>
      <div className="chat-avatar-slot">{showHead && <Avatar char={char} fallbackName={name} />}</div>
      <div className="chat-bubble-col">
        {showHead && !self && (
          <span className="chat-name" style={char?.color ? { color: tint(char.color) } : undefined}>
            {name}
          </span>
        )}
        <div className="chat-bubble">
          {splitActions(text).map((p, i) =>
            p.act ? <em key={i} className="chat-act">{p.text}</em> : <span key={i}>{p.text}</span>,
          )}
        </div>
      </div>
    </div>
  );
}

/** 角色色在深粉底上提亮一档，保证名字可读 */
function tint(color: string): string {
  return `color-mix(in oklab, ${color} 62%, #ffe3ee)`;
}

const PALETTE = ['#e2558a', '#a05ab8', '#5fa8d3', '#6fb3a8', '#d9a441', '#c44a5a', '#8e7cc3'];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function Avatar({ char, fallbackName }: { char: StoryChar | undefined; fallbackName?: string }) {
  const name = char?.name ?? fallbackName ?? '?';
  const [broken, setBroken] = useState(false);
  if (char?.asset && !broken) {
    return (
      <img
        className="chat-avatar"
        src={import.meta.env.BASE_URL + char.asset.replace(/^\//, '')}
        alt=""
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="chat-avatar chat-avatar-text" style={{ ['--av' as string]: char?.color ?? colorFor(name) }} aria-hidden>
      {[...name][0]}
    </span>
  );
}
