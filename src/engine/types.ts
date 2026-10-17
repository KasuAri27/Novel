/**
 * 引擎类型定义（纯逻辑，不含 DOM / React）。
 * 与 AGENTS.md 第 6 节 story.json 结构一一对应。
 */

/** 变量声明：取值夹在 [min, max]，init 为初始值 */
export interface VarDef {
  min: number;
  max: number;
  init: number;
}

/** 全局变量表（来自 vars.yaml，对应“三把尺”等数值） */
export type VarDefs = Record<string, VarDef>;

/** 事实声明：信息差不量化，仅用于剧情推进 */
export interface FactDef {
  label?: string;
}

export type FactDefs = Record<string, FactDef>;

/** 比较运算符 */
export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

/** 表达式里的项：变量引用或数字字面量 */
export type Term = { var: string } | { num: number };

/**
 * 条件表达式（JSON 语法树）。
 * 由编译脚本把 `hiro.explore >= 2 && meruru.explore < 2` 这类文本编译成该结构，
 * 引擎只解释执行，绝不使用 eval / new Function。
 */
export type Expr =
  | { op: 'and'; parts: Expr[] }
  | { op: 'or'; parts: Expr[] }
  | { op: 'not'; part: Expr }
  | { op: 'cmp'; cmp: CompareOp; left: Term; right: Term }
  | { op: 'lit'; value: number };

/**
 * 一段文字。
 * speaker 是说话人（`### 角色名`；旁白为 '旁白'）；缺省表示旧写法里的纯叙述。
 */
export interface Block {
  type: 'text';
  speaker?: string;
  text: string;
}

/**
 * 效果：单值变量加减/置值；二元关系档位增减；注入信息差（谁由此知道了什么）。
 * 信息差（know）与关系（rel）都不写进 vars.yaml。
 */
export type Effect =
  | { var: string; add?: number; set?: number }
  | { rel: [string, string]; add: number }
  | { know: string; fact: string };

/** 一个选项 */
export interface Option {
  key: string;
  text: string;
  echo: Block[];
  effects: Effect[];
  to?: string;
}

/** 节点如何继续 */
export type Next =
  | { kind: 'goto'; to: string }
  | { kind: 'choice'; id: string; prompt: string; options: Option[] }
  | { kind: 'route'; rules: { when: Expr; to: string }[]; else: string }
  | { kind: 'ending'; id: string };

/** 一个节点（对应一个 md 小节） */
export interface Node {
  id: string;
  chapter: number;
  /** 小节标题（`## S1　在恶人堆里醒来` 的后半段） */
  title: string;
  blocks: Block[];
  next: Next;
}

/** 章索引：story.json 里的 chapters 字段 */
export interface ChapterMeta {
  n: number;
  title: string;
  file: string;
  nodes: string[];
}

/** 素材清单（来自 story/assets.yaml 的编译产物；素材本体不入库） */
export interface StoryAssets {
  /** 说话人 → 立绘文件名（相对 public/portraits/） */
  portraits: Record<string, string>;
}

/** 编译产物：播放器只读它 */
export interface Story {
  version: 1;
  start: string;
  vars: VarDefs;
  facts: FactDefs;
  nodes: Record<string, Node>;
  chapters: ChapterMeta[];
  /** 素材清单（可缺省：没有 assets.yaml 时为空） */
  assets?: StoryAssets;
}

/* ------------------------------------------------------------------ *
 * 引擎运行态（AGENTS.md 第 7 节）
 * 说明：除 { nodeId, cursor, vars, history } 外，另存 facts / rels，
 * 用来承接选项的 know（谁知道了什么）与 rel（二元关系档位）。
 * 这两项不参与条件判断（表达式只认 vars），仅供播放器展示与剧情推进。
 * ------------------------------------------------------------------ */

/** 历史记录：每次选择记一条，用于回退与剧情更新后的重放 */
export interface HistoryEntry {
  choiceId: string;
  key: string;
}

/** 引擎状态 */
export interface EngineState {
  /** 当前节点；空串表示「尚未进入任何节点」（开局） */
  nodeId: string;
  /** 已播放到本节点的第几段文字 */
  cursor: number;
  vars: Record<string, number>;
  /** 信息差：键为 "角色\u0000事实" */
  facts: Record<string, boolean>;
  /** 二元关系档位：键为 "A|B" */
  rels: Record<string, number>;
  history: HistoryEntry[];
}

/** step 的输入 */
export type EngineInput = { type: 'advance' } | { type: 'choose'; key: string };

/** 选择事件里给播放器的选项（不含效果/回响，播放器看不到内部数据） */
export interface ChoiceOption {
  key: string;
  text: string;
}

/** 引擎发出的事件（AGENTS.md 第 7 节） */
export type Event =
  | { type: 'say'; text: string; speaker?: string }
  | { type: 'showChoice'; id: string; prompt: string; options: ChoiceOption[] }
  | { type: 'showEcho'; blocks: Block[] }
  | { type: 'setBackground'; id: string }
  | { type: 'showSprite'; id: string; slot: string }
  | { type: 'hideSprite'; slot: string }
  | { type: 'playBgm'; id: string }
  | { type: 'stopBgm' }
  | { type: 'chapterTitle'; n: number; title: string }
  | { type: 'ending'; id: string };

/** 存档 = 把状态序列化（AGENTS.md 第 7 节） */
export interface SaveData {
  v: 1;
  storyHash: string;
  nodeId: string;
  cursor: number;
  vars: Record<string, number>;
  facts: Record<string, boolean>;
  rels: Record<string, number>;
  history: HistoryEntry[];
}
