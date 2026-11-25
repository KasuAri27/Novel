/**
 * 引擎核心类型定义（信息差驱动）
 *
 * 这里是「内容契约层」与「运行时」之间的边界：
 * 解析器把 .story.txt DSL 编译成下面的 Story 模型；引擎只认识 Story / GameState，
 * 完全不关心具体剧情。换剧情 = 换文本，不动这些类型。
 */

export type CharId = string;
export type FactId = string;
export type NodeId = string;
export type EndingId = string;
export type FlagName = string;

/** 比较运算符（仅用于返回数值的条件动词，如 explore / rel） */
export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

/**
 * 条件表达式 AST。求值后得到 boolean。
 * - atom：调用某个条件动词（knows/alive/dead/flag/explore/rel...）
 *   - 返回 bool 的动词忽略 op/value
 *   - 返回 num 的动词必须带 op + value 做比较
 * - and/or/not：布尔组合
 * - lit：常量（用于缺省「恒真」等情况）
 */
export type Condition =
  | { kind: 'lit'; value: boolean }
  | { kind: 'atom'; verb: string; args: string[]; op?: CompareOp; value?: number }
  | { kind: 'and'; parts: Condition[] }
  | { kind: 'or'; parts: Condition[] }
  | { kind: 'not'; part: Condition };

/** 效果 AST：应用到 GameState 上产生新状态（授予知识、杀人、置位等） */
export interface Effect {
  verb: string;
  args: string[];
  /** set/rel/explore 等携带的数值或字面量 */
  value?: number | string | boolean;
}

/** 一条展示文本（旁白或角色对白） */
export interface Line {
  /** 说话者；null 表示旁白 */
  speaker: CharId | null;
  text: string;
}

/** 一个选项 */
export interface Choice {
  id: string;
  /** 选项按钮显示文本 */
  label: string;
  /** 跳转目标节点 */
  goto: NodeId;
  /** 显示门控：仅当条件为真时该选项出现（信息差核心：谁知道什么决定能选什么） */
  when: Condition;
  /** 选中后应用的效果（通常给某角色授予事实） */
  do: Effect[];
}

/** 剧情节点：一串文本 + 若干出口（选项或自动跳转） */
export interface StoryNode {
  id: NodeId;
  lines: Line[];
  /** 进入节点时应用的效果 */
  onEnter: Effect[];
  /** 分支选项；若为空则用 next 自动推进 */
  choices: Choice[];
  /** 无选项时的自动跳转目标；null 表示停在节点等待（通常为结局前置） */
  next: NodeId | null;
}

/** 角色定义 */
export interface StoryChar {
  id: CharId;
  /** 展示名 */
  name: string;
  /** 不可死亡（如艾玛），会拦截 kill 效果 */
  immortal: boolean;
  /** 立绘/头像资源键（聊天模式下作为头像图片路径，相对 public/） */
  asset?: string;
  /** 聊天模式：主角（气泡靠右，玩家选项以其口吻发出）。全剧至多一位 */
  me?: boolean;
  /** 聊天模式：头像底色 / 名字颜色（CSS 颜色值） */
  color?: string;
}

/** 结局定义：条件命中即触发 */
export interface Ending {
  id: EndingId;
  title: string;
  text: string;
  when: Condition;
  /** 优先级：多个结局同时命中时取数值大者 */
  priority: number;
}

/** 一个完整剧情（编译产物） */
export interface Story {
  meta: {
    id: string;
    title: string;
    /**  contributing 源文件名（调试用） */
    sources: string[];
  };
  chars: Record<CharId, StoryChar>;
  facts: Record<FactId, { label?: string }>;
  entry: NodeId;
  nodes: Record<NodeId, StoryNode>;
  endings: Ending[];
}

/**
 * 运行时游戏状态（可 JSON 序列化，用于存档）。
 * knowledge 用普通数组而非 Set，保证可序列化。
 */
export interface GameState {
  storyId: string;
  currentNodeId: NodeId;
  /** 角色 -> 已知事实集合 */
  knowledge: Record<CharId, FactId[]>;
  /** 角色 -> 是否存活（缺省视为存活） */
  alive: Record<CharId, boolean>;
  /** 通用开关 */
  flags: Record<FlagName, boolean | number | string>;
  /** 关系档位，键为 "a|b"（按字典序归一） */
  relationships: Record<string, number>;
  /** 对某角色的探索度 */
  exploration: Record<CharId, number>;
  /** 已访问节点历史（回退用，存快照） */
  history: GameStateSnapshot[];
  /** 命中的结局（null 表示进行中） */
  ended: EndingId | null;
  /** 当前节点内已推进到的行指针（打字机/逐行显示用） */
  lineIndex: number;
}

/** 去掉 history 的历史快照，避免嵌套膨胀 */
export type GameStateSnapshot = Omit<GameState, 'history'>;

/** 引擎动作 */
export type EngineAction =
  | { type: 'advance' } // 前进一行 / 进入下一节点（无选项时）
  | { type: 'choose'; choiceId: string }
  | { type: 'rewind' } // 回退一步
  | { type: 'restart' };
