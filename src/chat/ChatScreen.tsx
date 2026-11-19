/**
 * 聊天模式页面（#chat）：
 *   - 大厅：内置 / 导入的聊天剧本列表，「导入 .txt」按钮；
 *   - 聊天室：台词一律气泡，动作环境描写一律斜体小字，选项在底部作为回复候选。
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
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
import { hasSave, useChatStore } from './useChatStore';

export function ChatScreen({ onExit }: { onExit: () => void }) {
  const story = useChatStore((s) => s.story);
  return story ? <ChatRoom story={story} /> : <ChatLobby onExit={onExit} />;
}

// ---------------------------------------------------------------------------
// 大厅
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
    const source = await file.text();
    importFile({ name: file.name, source });
  };

  return (
    <div className="chat-app">
      <header className="chat-head">
        <button type="button" className="chat-head-btn" onClick={onExit} aria-label="返回标题">
          ‹ 返回
        </button>
        <h1 className="chat-head-title">聊天</h1>
        <button type="button" className="chat-head-btn" onClick={() => fileRef.current?.click()}>
          导入 .txt
        </button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={onFile} />
      </header>

      <div className="chat-lobby">
        <ImportDebugPanel errors={[...importErrors, ...builtInErrors]} />
        {library.length === 0 && <p className="chat-empty">还没有聊天剧本，点右上角导入一个 .txt。</p>}
        {library.map(({ story, imported }) => (
          <div key={story.meta.id} className="chat-lobby-item">
            <button type="button" className="chat-lobby-open" onClick={() => open(story.meta.id)}>
              <Avatar char={firstOther(story)} />
              <span className="chat-lobby-text">
                <span className="chat-lobby-title">{story.meta.title}</span>
                <span className="chat-lobby-sub">
                  {imported ? '导入' : '内置'} · {Object.keys(story.chars).length} 位角色
                  {hasSave(story.meta.id) ? ' · 有进度' : ''}
                </span>
              </span>
            </button>
            {imported && (
              <button
                type="button"
                className="chat-lobby-remove"
                onClick={() => removeImport(story.meta.id)}
                aria-label={`移除导入的 ${story.meta.title}`}
              >
                移除
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function firstOther(story: Story): StoryChar | undefined {
  return Object.values(story.chars).find((c) => !c.me);
}

// ---------------------------------------------------------------------------
// 聊天室
// ---------------------------------------------------------------------------

/** 自动播放每条的停留时间：按字数估算 */
function autoDelay(entry: ChatEntry | undefined): number {
  const len = entry && 'text' in entry ? entry.text.length : 10;
  return Math.min(3500, Math.max(900, 500 + len * 45));
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

  const status = chatStatus(story, session);
  const choices = status === 'choices' ? visibleChoices(story, session) : [];
  const me = meId(story);

  // 新消息出现时滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [session.log.length, status]);

  // 自动播放：只在「还有下一条」时推进，遇到选项 / 结局自然停下
  useEffect(() => {
    if (!auto || status !== 'more') return;
    const t = window.setTimeout(next, autoDelay(session.log[session.log.length - 1]));
    return () => window.clearTimeout(t);
  }, [auto, status, session, next]);

  // 键盘：空格 / 回车继续，数字键选选项
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

  return (
    <div className="chat-app">
      <header className="chat-head">
        <button type="button" className="chat-head-btn" onClick={close} aria-label="返回列表">
          ‹
        </button>
        <h1 className="chat-head-title">{story.meta.title}</h1>
        <div className="chat-head-tools">
          <button
            type="button"
            className="chat-head-btn"
            aria-pressed={auto}
            onClick={() => setAuto((v) => !v)}
          >
            {auto ? '自动中' : '自动'}
          </button>
          <button type="button" className="chat-head-btn" onClick={undo} disabled={!canUndo(session)}>
            撤回选择
          </button>
          <button type="button" className="chat-head-btn" onClick={restart}>
            重来
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="chat-log"
        onClick={status === 'more' ? next : undefined}
        data-clickable={status === 'more'}
      >
        {session.log.map((entry, i) => (
          <Entry key={i} entry={entry} story={story} me={me} prev={session.log[i - 1]} />
        ))}
      </div>

      <footer className="chat-foot">
        {status === 'more' && (
          <button type="button" className="chat-continue" onClick={next}>
            点击继续 ▾
          </button>
        )}
        {status === 'choices' && (
          <div className="chat-choices" role="group" aria-label="选择回复">
            {choices.map((c, i) => {
              const { style, button } = classifyChoice(c.label);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chat-choice chat-choice-${style}`}
                  onClick={() => pick(c.id)}
                >
                  <span className="chat-choice-key">{i + 1}</span>
                  <span className="chat-choice-label">{button}</span>
                </button>
              );
            })}
          </div>
        )}
        {status === 'ended' && (
          <div className="chat-end-actions">
            <button type="button" className="chat-choice" onClick={restart}>
              从头再来
            </button>
            <button type="button" className="chat-choice" onClick={close}>
              返回列表
            </button>
          </div>
        )}
        {(status === 'no-choices' || status === 'dead-end') && (
          <p className="chat-warn">
            {status === 'no-choices'
              ? '这里的选项条件都不满足，剧本走不下去了（检查 when 条件）。'
              : '剧情在这里结束，但没有命中任何 @end 结局（检查结局条件）。'}
            {canUndo(session) && (
              <button type="button" className="chat-choice" onClick={undo}>
                撤回上一个选择
              </button>
            )}
          </p>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单条记录
// ---------------------------------------------------------------------------

function Entry({
  entry,
  story,
  me,
  prev,
}: {
  entry: ChatEntry;
  story: Story;
  me: string | null;
  prev: ChatEntry | undefined;
}) {
  if (entry.kind === 'narr') return <p className="chat-narr">{entry.text}</p>;

  if (entry.kind === 'end') {
    return (
      <div className="chat-ending">
        <p className="chat-ending-kicker">结局</p>
        <h2>{entry.title}</h2>
        {entry.text && <p>{entry.text}</p>}
      </div>
    );
  }

  if (entry.kind === 'pick') {
    if (entry.style === 'silent') return null;
    if (entry.style === 'act') return <p className="chat-narr chat-narr-self">{entry.text}</p>;
    return <Bubble char={me ? story.chars[me] : undefined} self text={entry.text} showHead={!sameSender(prev, me, me)} />;
  }

  const self = entry.speaker === me;
  return (
    <Bubble
      char={story.chars[entry.speaker]}
      fallbackName={entry.speaker}
      self={self}
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

function Bubble({
  char,
  fallbackName,
  self,
  text,
  showHead,
}: {
  char: StoryChar | undefined;
  fallbackName?: string;
  self: boolean;
  text: string;
  showHead: boolean;
}) {
  const name = char?.name ?? fallbackName ?? '我';
  return (
    <div className={`chat-row ${self ? 'chat-row-self' : ''} ${showHead ? '' : 'chat-row-cont'}`}>
      <div className="chat-avatar-slot">{showHead && <Avatar char={char} fallbackName={name} />}</div>
      <div className="chat-bubble-col">
        {showHead && !self && (
          <span className="chat-name" style={char?.color ? { color: char.color } : undefined}>
            {name}
          </span>
        )}
        <div className="chat-bubble">
          {splitActions(text).map((p, i) =>
            p.act ? (
              <em key={i} className="chat-act">
                {p.text}
              </em>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

const PALETTE = ['#8c61db', '#d0607a', '#3f8fb8', '#3f9d6e', '#c98a2e', '#7a6fd0', '#b85c3f'];

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
        alt={name}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="chat-avatar" style={{ background: char?.color ?? colorFor(name) }} aria-hidden>
      {[...name][0]}
    </span>
  );
}
