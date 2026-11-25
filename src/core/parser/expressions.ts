/**
 * 表达式解析：把 DSL 里的 `when ...` 条件串与 `do ...` 效果串解析成引擎 AST。
 * 采用小型递归下降，运算符优先级：! > && > ||。
 * 出错时返回 error 文本（供 compiler 收集带行号的报错），并给出安全兜底值。
 */
import type { CompareOp, Condition, Effect } from '../engine/types';
import { CONDITION_VERBS, EFFECT_VERBS } from '../engine/verbs';

export interface ParseResult<T> {
  value: T;
  error?: string;
}

const ID_CHARS = /[\p{L}\p{N}_\-。]/u; // 支持中文/字母/数字/_/-/。作为标识符
const SPACE = /\s/;

// ---------------------------------------------------------------------------
// 条件解析
// ---------------------------------------------------------------------------

class CondParser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Condition {
    if (this.trimmedRest() === '') return { kind: 'lit', value: true };
    const node = this.parseOr();
    this.skipSpace();
    if (this.i < this.src.length) {
      throw new Error(`条件在「${this.src.slice(this.i)}」处有多余内容`);
    }
    return node;
  }

  private trimmedRest(): string {
    return this.src.slice(this.i).trim();
  }

  private skipSpace(): void {
    while (this.i < this.src.length && SPACE.test(this.src[this.i])) this.i++;
  }

  private eat(s: string): boolean {
    this.skipSpace();
    if (this.src.startsWith(s, this.i)) {
      this.i += s.length;
      return true;
    }
    return false;
  }

  private parseOr(): Condition {
    const parts: Condition[] = [this.parseAnd()];
    while (this.eat('||')) parts.push(this.parseAnd());
    return parts.length === 1 ? parts[0] : { kind: 'or', parts };
  }

  private parseAnd(): Condition {
    const parts: Condition[] = [this.parseUnary()];
    while (this.eat('&&')) parts.push(this.parseUnary());
    return parts.length === 1 ? parts[0] : { kind: 'and', parts };
  }

  private parseUnary(): Condition {
    if (this.eat('!')) {
      // 排除 != 误判：! 后紧跟 = 属于比较符，不应发生在此层
      return { kind: 'not', part: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Condition {
    this.skipSpace();
    if (this.eat('(')) {
      const inner = this.parseOr();
      if (!this.eat(')')) throw new Error('缺少右括号 )');
      return inner;
    }
    return this.parseAtom();
  }

  private parseAtom(): Condition {
    const verb = this.readIdent();
    if (!verb) throw new Error('期望条件动词，如 knows/alive/explore');
    if (!CONDITION_VERBS[verb]) throw new Error(`未知条件动词「${verb}」`);
    if (!this.eat('(')) throw new Error(`动词「${verb}」后需要 (`);
    const args = this.readArgs();
    if (!this.eat(')')) throw new Error(`动词「${verb}」缺少右括号 )`);
    const spec = CONDITION_VERBS[verb];
    if (args.length !== spec.arity) {
      throw new Error(`动词「${verb}」需要 ${spec.arity} 个参数，实际 ${args.length} 个`);
    }
    const atom: Extract<Condition, { kind: 'atom' }> = { kind: 'atom', verb, args };
    if (spec.returns === 'num') {
      const op = this.readCompareOp();
      if (op) {
        const num = this.readNumber();
        if (num === null) throw new Error(`比较运算符「${op}」后需要数值`);
        atom.op = op;
        atom.value = num;
      }
      // num 动词若无比较，引擎按「>=1」处理
    }
    return atom;
  }

  private readArgs(): string[] {
    this.skipSpace();
    if (this.src[this.i] === ')') return [];
    const args: string[] = [];
    let buf = '';
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === ')') break;
      if (c === ',') {
        args.push(buf.trim());
        buf = '';
        this.i++;
        continue;
      }
      buf += c;
      this.i++;
    }
    if (buf.trim() !== '' || args.length > 0) args.push(buf.trim());
    return args.filter((a) => a !== '');
  }

  private readCompareOp(): CompareOp | null {
    this.skipSpace();
    const two = this.src.slice(this.i, this.i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      this.i += 2;
      return two;
    }
    const one = this.src[this.i];
    if (one === '>' || one === '<') {
      this.i += 1;
      return one;
    }
    return null;
  }

  private readNumber(): number | null {
    this.skipSpace();
    const m = /^[+-]?\d+(\.\d+)?/.exec(this.src.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }

  private readIdent(): string {
    this.skipSpace();
    let s = '';
    while (this.i < this.src.length && ID_CHARS.test(this.src[this.i])) {
      s += this.src[this.i];
      this.i++;
    }
    return s;
  }
}

/** 解析 when 条件串；空串 → 恒真 */
export function parseCondition(src: string): ParseResult<Condition> {
  try {
    const value = new CondParser(src ?? '').parse();
    return { value };
  } catch (e) {
    return { value: { kind: 'lit', value: true }, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// 效果解析
// ---------------------------------------------------------------------------

/** 顶层逗号切分（跳过括号内） */
function splitTopLevel(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const c of src) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim() !== '') out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/** 解析 do 效果串（逗号分隔的多个效果） */
export function parseEffects(src: string): ParseResult<Effect[]> {
  const effects: Effect[] = [];
  const text = (src ?? '').trim();
  if (text === '') return { value: [] };
  for (const item of splitTopLevel(text, ',')) {
    const m = /^([\p{L}\p{N}_\-。]+)\s*\(([^)]*)\)$/u.exec(item);
    if (!m) {
      return { value: effects, error: `效果格式应为 动词(参数,...)，实际「${item}」` };
    }
    const verb = m[1];
    const spec = EFFECT_VERBS[verb];
    if (!spec) {
      return { value: effects, error: `未知效果动词「${verb}」` };
    }
    const tokens = m[2]
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    if (tokens.length < spec.arity) {
      return {
        value: effects,
        error: `效果「${verb}」需要 ${spec.arity} 个参数，实际 ${tokens.length} 个`,
      };
    }
    const args = tokens.slice(0, spec.arity);
    const effect: Effect = { verb, args };
    if (spec.hasValue && tokens.length > spec.arity) {
      effect.value = coerce(tokens[spec.arity]);
    }
    effects.push(effect);
  }
  return { value: effects };
}

function coerce(raw: string): number | string | boolean {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (!Number.isNaN(n) && /^[+-]?\d+(\.\d+)?$/.test(t)) return n;
  return t;
}

/**
 * 在括号深度 0 处查找关键字（前后需为空白），返回索引或 -1。
 * 用于把 `[choice] ... when <cond> do <eff>` 拆成三段。
 */
export function findKeyword(src: string, kw: string): number {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && src.startsWith(kw, i)) {
      const before = i === 0 ? ' ' : src[i - 1];
      const after = src[i + kw.length] ?? ' ';
      if (SPACE.test(before) && (SPACE.test(after) || after === undefined)) return i;
    }
  }
  return -1;
}
