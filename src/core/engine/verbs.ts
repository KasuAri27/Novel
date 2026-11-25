/**
 * 动词注册表 —— 引擎可扩展性的核心。
 *
 * 条件动词与效果动词只在这里声明一次：
 *   - 解析器据此校验 DSL 里 when/do 用到的动词是否合法、参数个数是否正确；
 *   - 引擎据此（在 conditions.ts / effects.ts 中）分派求值/应用逻辑。
 * 想加新机制（新动词），在此登记 + 在对应 handler 里加一条分支即可，
 * 无需改动其它模块，也不同剧情解耦。
 */

export interface ConditionVerbSpec {
  name: string;
  /** 参数个数 */
  arity: number;
  /** 返回值类型：bool 直接为真值；num 需配合比较运算符 */
  returns: 'bool' | 'num';
  /** 文档说明，供 STORY_SPEC 与调试面板展示 */
  doc: string;
}

export interface EffectVerbSpec {
  name: string;
  arity: number;
  /** 是否携带 value（如 set 的值、rel/explore 的增量） */
  hasValue: boolean;
  doc: string;
}

/** 条件动词表 */
export const CONDITION_VERBS: Record<string, ConditionVerbSpec> = {
  knows: {
    name: 'knows',
    arity: 2,
    returns: 'bool',
    doc: 'knows(角色, 事实)：该角色已知该事实',
  },
  alive: {
    name: 'alive',
    arity: 1,
    returns: 'bool',
    doc: 'alive(角色)：该角色存活',
  },
  dead: {
    name: 'dead',
    arity: 1,
    returns: 'bool',
    doc: 'dead(角色)：该角色已死亡',
  },
  flag: {
    name: 'flag',
    arity: 1,
    returns: 'bool',
    doc: 'flag(开关名)：开关为真（truthy）',
  },
  explore: {
    name: 'explore',
    arity: 1,
    returns: 'num',
    doc: 'explore(角色) [op 数值]：对该角色的探索度',
  },
  rel: {
    name: 'rel',
    arity: 2,
    returns: 'num',
    doc: 'rel(角色A, 角色B) [op 数值]：A 与 B 的关系档位',
  },
};

/** 效果动词表 */
export const EFFECT_VERBS: Record<string, EffectVerbSpec> = {
  know: {
    name: 'know',
    arity: 2,
    hasValue: false,
    doc: 'know(角色, 事实)：让该角色获知该事实',
  },
  forget: {
    name: 'forget',
    arity: 2,
    hasValue: false,
    doc: 'forget(角色, 事实)：该角色不再知道该事实',
  },
  kill: {
    name: 'kill',
    arity: 1,
    hasValue: false,
    doc: 'kill(角色)：该角色死亡（immortal 角色会被拦截）',
  },
  spare: {
    name: 'spare',
    arity: 1,
    hasValue: false,
    doc: 'spare(角色)：确保该角色存活',
  },
  set: {
    name: 'set',
    arity: 1,
    hasValue: true,
    doc: 'set(开关, 值)：设置通用开关（值可为 true/false/数字/字符串）',
  },
  rel: {
    name: 'rel',
    arity: 2,
    hasValue: true,
    doc: 'rel(角色A, 角色B, 增量)：调整 A 与 B 的关系档位',
  },
  explore: {
    name: 'explore',
    arity: 1,
    hasValue: true,
    doc: 'explore(角色, 增量)：调整对该角色的探索度',
  },
};

export function isConditionVerb(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONDITION_VERBS, name);
}

export function isEffectVerb(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(EFFECT_VERBS, name);
}
