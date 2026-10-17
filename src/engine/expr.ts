/**
 * 条件表达式：文本 → JSON 语法树（parse），语法树 + 变量 → 布尔（eval）。
 * 语法（AGENTS.md 第 5 节，只支持这些）：
 *   变量名、数字、>= <= > < == !=、&& || !、括号
 * 变量名用小写字母加点号，例如 hiro.explore。
 */
import type { CompareOp, Expr, Term } from './types';

/** 解析失败时抛出的错误（带出错位置，便于校验脚本定位） */
export class ExprError extends Error {}

const IDENT_START = /[a-z_]/;
const IDENT_CHAR = /[a-z0-9_]/;

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: CompareOp | '&&' | '||' | '!' | '(' | ')' };

/** 词法分析：把条件串切成 token */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // 多字符运算符优先
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (c === '>' || c === '<' || c === '!' || c === '(' || c === ')') {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`无法识别的数字：${src.slice(i)}`);
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (IDENT_START.test(c)) {
      let id = c;
      i++;
      while (i < src.length && IDENT_CHAR.test(src[i]!)) {
        id += src[i];
        i++;
      }
      // 点号分段：a.b.c
      while (src[i] === '.') {
        const next = src[i + 1];
        if (next === undefined || !IDENT_CHAR.test(next)) {
          throw new ExprError(`变量名在「${id}.」处不完整`);
        }
        id += '.';
        i++;
        while (i < src.length && IDENT_CHAR.test(src[i]!)) {
          id += src[i];
          i++;
        }
      }
      tokens.push({ kind: 'ident', value: id });
      continue;
    }
    throw new ExprError(`无法识别的字符「${c}」`);
  }
  return tokens;
}

/** 递归下降：or → and → unary → primary */
class Parser {
  private i = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Expr {
    const node = this.parseOr();
    if (this.i < this.tokens.length) {
      throw new ExprError(`表达式结尾有多余内容：${String(this.tokens[this.i]!.value)}`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.kind === 'op' && t.value === value;
  }

  private parseOr(): Expr {
    const parts = [this.parseAnd()];
    while (this.isOp('||')) {
      this.i++;
      parts.push(this.parseAnd());
    }
    return parts.length === 1 ? parts[0]! : { op: 'or', parts };
  }

  private parseAnd(): Expr {
    const parts = [this.parseUnary()];
    while (this.isOp('&&')) {
      this.i++;
      parts.push(this.parseUnary());
    }
    return parts.length === 1 ? parts[0]! : { op: 'and', parts };
  }

  private parseUnary(): Expr {
    if (this.isOp('!')) {
      this.i++;
      return { op: 'not', part: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    if (this.isOp('(')) {
      this.i++;
      const inner = this.parseOr();
      if (!this.isOp(')')) throw new ExprError('缺少右括号 )');
      this.i++;
      return inner;
    }
    return this.parseComparison();
  }

  private parseTerm(): Term {
    const t = this.peek();
    if (!t) throw new ExprError('表达式不完整，缺少操作数');
    if (t.kind === 'num') {
      this.i++;
      return { num: t.value };
    }
    if (t.kind === 'ident') {
      this.i++;
      return { var: t.value };
    }
    throw new ExprError(`这里需要变量名或数字，实际是「${t.value}」`);
  }

  private parseComparison(): Expr {
    const left = this.parseTerm();
    const t = this.peek();
    if (t?.kind === 'op' && (t.value === '>=' || t.value === '<=' || t.value === '>' || t.value === '<' || t.value === '==' || t.value === '!=')) {
      this.i++;
      const right = this.parseTerm();
      return { op: 'cmp', cmp: t.value, left, right };
    }
    // 裸项：按“非零为真”处理，等价于 (term != 0)
    return { op: 'cmp', cmp: '!=', left, right: { num: 0 } };
  }
}

/** 解析条件：空串 → 恒真 */
export function parseExpr(src: string): Expr {
  const text = (src ?? '').trim();
  if (text === '') return { op: 'lit', value: 1 };
  return new Parser(tokenize(text)).parse();
}

function termValue(term: Term, vars: Record<string, number>): number {
  if ('num' in term) return term.num;
  const v = vars[term.var];
  if (v === undefined) throw new ExprError(`未声明的变量「${term.var}」`);
  return v;
}

/** 解释执行语法树。vars 中缺失的变量视为错误（防止拼写不一致悄悄通过） */
export function evalExpr(expr: Expr, vars: Record<string, number>): boolean {
  switch (expr.op) {
    case 'and':
      return expr.parts.every((p) => evalExpr(p, vars));
    case 'or':
      return expr.parts.some((p) => evalExpr(p, vars));
    case 'not':
      return !evalExpr(expr.part, vars);
    case 'lit':
      return expr.value !== 0;
    case 'cmp': {
      const l = termValue(expr.left, vars);
      const r = termValue(expr.right, vars);
      switch (expr.cmp) {
        case '>=':
          return l >= r;
        case '<=':
          return l <= r;
        case '>':
          return l > r;
        case '<':
          return l < r;
        case '==':
          return l === r;
        case '!=':
          return l !== r;
      }
    }
  }
}

/** 收集表达式里引用到的全部变量名（校验脚本用；数字字面量忽略） */
export function collectVars(expr: Expr, out: Set<string> = new Set()): Set<string> {
  switch (expr.op) {
    case 'and':
    case 'or':
      for (const p of expr.parts) collectVars(p, out);
      break;
    case 'not':
      collectVars(expr.part, out);
      break;
    case 'cmp':
      if ('var' in expr.left) out.add(expr.left.var);
      if ('var' in expr.right) out.add(expr.right.var);
      break;
    case 'lit':
      break;
  }
  return out;
}
