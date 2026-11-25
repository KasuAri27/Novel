/**
 * 条件求值：把 Condition AST 在给定 GameState 上求值为 boolean。
 * 动词分派与 CONDITION_VERBS 注册表保持一致。
 */
import type { Condition, CompareOp, GameState } from './types';
import { CONDITION_VERBS } from './verbs';
import { isAlive, knowsFact, relKey } from './state';

export function evalCondition(state: GameState, cond: Condition): boolean {
  switch (cond.kind) {
    case 'lit':
      return cond.value;
    case 'and':
      return cond.parts.every((p) => evalCondition(state, p));
    case 'or':
      return cond.parts.some((p) => evalCondition(state, p));
    case 'not':
      return !evalCondition(state, cond.part);
    case 'atom':
      return evalAtom(state, cond);
    default:
      return false;
  }
}

function evalAtom(
  state: GameState,
  cond: Extract<Condition, { kind: 'atom' }>,
): boolean {
  const spec = CONDITION_VERBS[cond.verb];
  if (!spec) {
    // 解析阶段已校验，运行时兜底为 false
    return false;
  }
  if (spec.returns === 'bool') {
    return evalBoolVerb(state, cond.verb, cond.args);
  }
  // 数值动词：取值后按 op 比较（缺省视为 >=1）
  const num = evalNumVerb(state, cond.verb, cond.args);
  const op: CompareOp = cond.op ?? '>=';
  const target = cond.value ?? 1;
  return compare(num, op, target);
}

function evalBoolVerb(state: GameState, verb: string, args: string[]): boolean {
  switch (verb) {
    case 'knows':
      return knowsFact(state, args[0], args[1]);
    case 'alive':
      return isAlive(state, args[0]);
    case 'dead':
      return !isAlive(state, args[0]);
    case 'flag':
      return truthy(state.flags[args[0]]);
    default:
      return false;
  }
}

function evalNumVerb(state: GameState, verb: string, args: string[]): number {
  switch (verb) {
    case 'explore':
      return state.exploration[args[0]] ?? 0;
    case 'rel':
      return state.relationships[relKey(args[0], args[1])] ?? 0;
    default:
      return 0;
  }
}

function compare(num: number, op: CompareOp, target: number): boolean {
  switch (op) {
    case '>=':
      return num >= target;
    case '<=':
      return num <= target;
    case '>':
      return num > target;
    case '<':
      return num < target;
    case '==':
      return num === target;
    case '!=':
      return num !== target;
    default:
      return false;
  }
}

function truthy(v: boolean | number | string | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}
