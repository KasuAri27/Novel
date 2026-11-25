import type { Line } from '../../engine/types';

export interface FormattedLine {
  speaker: string | null;
  action: string | null;
  speech: string;
}

const LEADING_ACTION_RE = /^([（(][^）)]+[）)])\s*(.*)$/;
const OPEN_QUOTE_RE = /^[“「『"']/;

/**
 * 将剧本对白行拆解为「说话人 + 可选前置动作 + 引号台词」，供小说模式排版使用。
 * 旁白行（speaker 为 null）保持原样返回。
 */
export function formatDialogueLine(speaker: string | null, rawText: string): FormattedLine {
  const text = rawText.trim();
  if (!speaker) {
    return { speaker: null, action: null, speech: text };
  }

  const match = text.match(LEADING_ACTION_RE);
  const action = match ? match[1] : null;
  const body = match ? match[2].trim() : text;

  if (!body) {
    return { speaker, action, speech: '' };
  }
  const speech = OPEN_QUOTE_RE.test(body) ? body : `“${body}”`;
  return { speaker, action, speech };
}

/** 渲染单行正文：旁白与对话统一兼容单源剧本格式。 */
export function StoryLine({ line }: { line: Line }) {
  const fmt = formatDialogueLine(line.speaker, line.text);
  if (!fmt.speaker) {
    return <p className="line-narr">{fmt.speech}</p>;
  }
  return (
    <p className="line-say">
      <span className="say-speaker">{fmt.speaker}</span>
      {fmt.action && <span className="say-act">{fmt.action}</span>}
      {fmt.speech ? `：${fmt.speech}` : null}
    </p>
  );
}
