/**
 * 行级词法分析：把原始文本切成带行号的「指令」或「正文」条目。
 * 规则：
 *   - 空行、以 # 开头的整行注释被丢弃；
 *   - 首个非空字符为 @ 的行是指令，拆为 name + rest；
 *   - 其余为正文行（交由 compiler 依据当前上下文归入节点/结局）。
 */

export interface DirectiveTok {
  type: 'directive';
  no: number;
  name: string; // 例如 story / char / node / end / entry
  rest: string;
}

export interface BodyTok {
  type: 'body';
  no: number;
  text: string;
}

export type Token = DirectiveTok | BodyTok;

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const no = idx + 1;
    const raw = lines[idx];
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue; // 注释
    if (trimmed.startsWith('@')) {
      const body = trimmed.slice(1);
      const sp = body.search(/\s/);
      const name = sp === -1 ? body : body.slice(0, sp);
      const rest = sp === -1 ? '' : body.slice(sp + 1).trim();
      tokens.push({ type: 'directive', no, name, rest });
    } else {
      tokens.push({ type: 'body', no, text: raw.replace(/\s+$/, '') });
    }
  }
  return tokens;
}

/** 解析 `key=value` 形式的属性（value 可含空格，直到下一个 ` key=` 或行尾） */
export function parseAttrs(rest: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\S+)=((?:(?!\s+\S+=).)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    attrs[m[1]] = m[2].trim();
  }
  return attrs;
}
