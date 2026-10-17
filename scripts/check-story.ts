/**
 * M4 校验：对编译产物 story.json（+ 编译期信息 CheckMeta）做全量检查。
 *
 * 纯函数，不读文件，方便单元测试；problems 判失败（story:check 退出码 1），
 * warnings 只提示。统计行由 summarize 负责。
 * 故意改坏数据时应能在这里逐个报出来。
 */
import type { Effect, Node, Story, VarDefs } from '../src/engine/types.ts';
import { collectVars, evalExpr } from '../src/engine/expr.ts';
import { initVars } from '../src/engine/vars.ts';

/** 编译期附带信息：story.json 里没有、校验又需要的 */
export interface CheckMeta {
  /** 解析顺序的全部节点 id（可能含重复，用来查重） */
  parsedNodeIds: string[];
  /** logic.yaml 里出现过的选择编号 */
  logicChoiceIds: string[];
  /** 选择编号 → logic.yaml 里写的选项键（如 E02 → ['A','B','C']） */
  logicChoiceKeys: Record<string, string[]>;
  /** 各章正文字数（解析时统计；汇合收束只计一次） */
  chapterChars: Record<number, number>;
}

export interface CheckResult {
  problems: string[];
  warnings: string[];
}

/** 章节字数目标（AGENTS.md 第 11 节：2.0–2.5 万字符），差太多只提示不判失败 */
const CHAPTER_CHARS_MIN = 20000;
const CHAPTER_CHARS_MAX = 25000;
const CHAPTER_CHARS_TOLERANCE = 0.3;
/** 变量组合穷举上限，防止变量变多后爆炸 */
const MAX_COMBOS = 100000;
/** 全路径模拟步数上限（安全网） */
const MAX_SIM_STEPS = 200000;

export function checkStory(story: Story, meta: CheckMeta): CheckResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  checkNodeIds(meta, problems);
  checkChoiceSync(story, meta, problems, warnings);
  checkVarRefs(story, problems);
  checkNodes(story, problems, warnings);
  checkGraph(story, problems);
  checkRoutes(story, problems, warnings);
  simulate(story, problems, warnings);
  checkChapterChars(story, meta, warnings);

  return { problems, warnings };
}

/** 统计行（story.json 概况） */
export function summarize(story: Story, meta: CheckMeta): string[] {
  const nodes = Object.values(story.nodes);
  let choices = 0;
  let options = 0;
  let effects = 0;
  let endings = 0;
  let routes = 0;
  for (const n of nodes) {
    const nx = n.next;
    if (nx.kind === 'choice') {
      choices += 1;
      options += nx.options.length;
      for (const o of nx.options) effects += o.effects.length;
    } else if (nx.kind === 'ending') {
      endings += 1;
    } else if (nx.kind === 'route') {
      routes += 1;
    }
  }
  const synth = nodes.filter((n) => n.id.endsWith('__route')).length;
  return [
    `版本：${story.version}`,
    `起始节点：${story.start}`,
    `章数：${story.chapters.length}`,
    `节点数：${nodes.length}` + (synth > 0 ? `（其中路由合成节点 ${synth} 个）` : ''),
    `选择数：${choices}`,
    `选项数：${options}`,
    `效果数：${effects}`,
    `路由数：${routes}`,
    `结局数：${endings}`,
    '各章：' + story.chapters.map((c) => `${c.n}=${c.nodes.length}节点`).join(' '),
    '各章字数：' +
      story.chapters.map((c) => `${c.n}=${meta.chapterChars[c.n] ?? 0}`).join(' ') +
      `（目标 ${CHAPTER_CHARS_MIN}–${CHAPTER_CHARS_MAX}）`,
  ];
}

/** 节点 id 唯一（解析顺序里不能出现两次，后者会覆盖前者） */
function checkNodeIds(meta: CheckMeta, problems: string[]): void {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of meta.parsedNodeIds) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  for (const id of dups) {
    problems.push(`节点 id 重复：${id}（同名小节出现多次，后者会覆盖前者）`);
  }
}

/** md（编译产物）与 logic.yaml 双向一致：选择编号、选项键 */
function checkChoiceSync(story: Story, meta: CheckMeta, problems: string[], warnings: string[]): void {
  const mdChoices = new Map<string, string[]>(); // 选择 id → 选项键
  for (const n of Object.values(story.nodes)) {
    if (n.next.kind === 'choice') mdChoices.set(n.next.id, n.next.options.map((o) => o.key));
  }
  const logicIds = new Set(meta.logicChoiceIds);
  for (const id of mdChoices.keys()) {
    if (!logicIds.has(id)) problems.push(`选择 ${id} 在 md 里出现，但 logic.yaml 没有条目`);
  }
  for (const id of logicIds) {
    if (!mdChoices.has(id)) problems.push(`logic.yaml 里的选择 ${id} 在 md 里找不到（编号打错？）`);
  }
  for (const [id, logicKeys] of Object.entries(meta.logicChoiceKeys)) {
    const mdKeys = mdChoices.get(id);
    if (!mdKeys) continue; // 上面已报过
    for (const k of logicKeys) {
      if (!mdKeys.includes(k)) problems.push(`logic.yaml 选择 ${id} 的选项 ${k} 在 md 里不存在`);
    }
    for (const k of mdKeys) {
      if (!logicKeys.includes(k)) {
        problems.push(`logic.yaml 选择 ${id} 缺选项 ${k} 的条目（三个选项都要写，没有效果也要写 effects: []）`);
      }
    }
  }
  // 三个选项全无效果：多是待作者定稿的占位，提醒一下
  for (const n of Object.values(story.nodes)) {
    if (n.next.kind !== 'choice') continue;
    if (n.next.options.every((o) => o.effects.length === 0)) {
      warnings.push(`选择 ${n.next.id} 三个选项都没有效果（占位？待作者定稿）`);
    }
  }
}

/** 效果与路由条件里引用的变量，必须在 vars.yaml 声明 */
function checkVarRefs(story: Story, problems: string[]): void {
  const declared = new Set(Object.keys(story.vars));
  const refs = new Map<string, string[]>();
  const note = (name: string, where: string): void => {
    if (!refs.has(name)) refs.set(name, []);
    refs.get(name)!.push(where);
  };
  for (const n of Object.values(story.nodes)) {
    const nx = n.next;
    if (nx.kind === 'choice') {
      for (const o of nx.options) {
        for (const e of o.effects) {
          if ('var' in e) note(e.var, `选择 ${nx.id} 选项 ${o.key} 的效果`);
        }
      }
    } else if (nx.kind === 'route') {
      nx.rules.forEach((r, i) => {
        for (const v of collectVars(r.when)) note(v, `节点 ${n.id} 路由第 ${i + 1} 条的条件`);
      });
    }
  }
  for (const [name, wheres] of refs) {
    if (declared.has(name)) continue;
    const shown = wheres.slice(0, 3).join('、');
    const more = wheres.length > 3 ? ` 等 ${wheres.length} 处` : '';
    problems.push(`变量「${name}」没有在 story/vars.yaml 声明：${shown}${more}`);
  }
}

/** 逐节点基础检查：去向是否存在、选项数量、提示语、回响、残留注记 */
function checkNodes(story: Story, problems: string[], warnings: string[]): void {
  for (const n of Object.values(story.nodes)) {
    const nx = n.next;
    if (nx.kind === 'goto') {
      if (!story.nodes[nx.to]) problems.push(`节点 ${n.id} 的 goto 指向不存在的节点 ${nx.to}`);
    } else if (nx.kind === 'route') {
      nx.rules.forEach((r, i) => {
        if (!story.nodes[r.to]) problems.push(`节点 ${n.id} 路由第 ${i + 1} 条的目标不存在：${r.to}`);
      });
      if (!story.nodes[nx.else]) problems.push(`节点 ${n.id} 的路由兜底目标不存在：${nx.else}`);
    } else if (nx.kind === 'choice') {
      if (nx.options.length !== 3) problems.push(`选择 ${nx.id} 的选项不是 3 个（${nx.options.length}）`);
      if (!nx.prompt) warnings.push(`选择 ${nx.id} 缺提示语（源文如此）`);
      for (const o of nx.options) {
        if (o.to && !story.nodes[o.to]) problems.push(`选择 ${nx.id} 选项 ${o.key} 指向不存在的节点 ${o.to}`);
        if (!o.to) problems.push(`选择 ${nx.id} 选项 ${o.key} 没有去向（选完会卡住）`);
        if (o.echo.length === 0) warnings.push(`选择 ${nx.id} 选项 ${o.key} 没有回响文字`);
      }
    }
    for (const b of n.blocks) {
      if (b.text.trimStart().startsWith('>')) problems.push(`节点 ${n.id} 残留引用块文字`);
    }
  }
}

/** 节点的全部「看得见的」去路（路由忽略条件，只看图连接；无去向的选项不算边） */
function outEdges(n: Node): string[] {
  const nx = n.next;
  if (nx.kind === 'goto') return [nx.to];
  if (nx.kind === 'choice') return nx.options.flatMap((o) => (o.to ? [o.to] : []));
  if (nx.kind === 'route') return [...nx.rules.map((r) => r.to), nx.else];
  return [];
}

/** 图结构：孤立节点、死胡同（走不到结局）、结局可达 */
function checkGraph(story: Story, problems: string[]): void {
  const nodes = Object.values(story.nodes);

  // 1) 从起点正向可达（忽略条件）
  const reach = new Set<string>();
  const stack = [story.start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    const n = story.nodes[id];
    if (n) stack.push(...outEdges(n));
  }
  for (const n of nodes) {
    if (!reach.has(n.id)) problems.push(`节点 ${n.id} 从起点不可达（孤立节点）`);
  }

  // 2) 死胡同：反复标记「所有去路都安全」的节点，剩下的就是走不到结局的
  const safe = new Set<string>(nodes.filter((n) => n.next.kind === 'ending').map((n) => n.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of nodes) {
      if (safe.has(n.id)) continue;
      const outs = outEdges(n);
      if (outs.length > 0 && outs.every((t) => safe.has(t))) {
        safe.add(n.id);
        changed = true;
      }
    }
  }
  for (const n of nodes) {
    if (!safe.has(n.id)) problems.push(`节点 ${n.id} 是死胡同（存在走不到结局的路径）`);
  }

  // 3) 每个结局至少一条路径可达
  for (const n of nodes) {
    if (n.next.kind === 'ending' && !reach.has(n.id)) {
      problems.push(`结局 ${n.next.id}（节点 ${n.id}）没有任何路径可达`);
    }
  }
}

/** 穷举所有变量的整数取值组合；超过上限返回 null */
function enumerateVars(defs: VarDefs): Record<string, number>[] | null {
  const names = Object.keys(defs);
  let total = 1;
  for (const name of names) total *= defs[name]!.max - defs[name]!.min + 1;
  if (total > MAX_COMBOS) return null;
  let combos: Record<string, number>[] = [{}];
  for (const name of names) {
    const d = defs[name]!;
    const next: Record<string, number>[] = [];
    for (const c of combos) {
      for (let v = d.min; v <= d.max; v += 1) next.push({ ...c, [name]: v });
    }
    combos = next;
  }
  return combos;
}

const fmtVars = (vars: Record<string, number>): string =>
  Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');

/**
 * 路由完备性：穷举变量组合，要求每个组合规则判断恰好命中一条。
 * 没有任何规则命中（落到 else）判失败；命中多条只提示，因为
 * TODO(作者)：路由重叠优先级未定，当下按「先匹配先生效」处理。
 */
function checkRoutes(story: Story, problems: string[], warnings: string[]): void {
  const combos = enumerateVars(story.vars);
  if (!combos) {
    warnings.push(`变量组合超过 ${MAX_COMBOS} 个，跳过路由穷举检查`);
    return;
  }
  for (const n of Object.values(story.nodes)) {
    if (n.next.kind !== 'route') continue;
    let miss = 0;
    let overlap = 0;
    const missSample: string[] = [];
    const overlapSample: string[] = [];
    const errors = new Set<string>();
    for (const vars of combos) {
      let hits = 0;
      let failed = false;
      for (const r of n.next.rules) {
        try {
          if (evalExpr(r.when, vars)) hits += 1;
        } catch (e) {
          errors.add((e as Error).message);
          failed = true;
        }
      }
      if (failed) continue;
      if (hits === 0) {
        miss += 1;
        if (missSample.length < 3) missSample.push(fmtVars(vars));
      } else if (hits > 1) {
        overlap += 1;
        if (overlapSample.length < 3) overlapSample.push(`${fmtVars(vars)}（命中 ${hits} 条）`);
      }
    }
    for (const msg of errors) problems.push(`路由节点 ${n.id} 条件求值失败：${msg}`);
    if (miss > 0) {
      problems.push(
        `路由节点 ${n.id}：${miss} 个变量组合不命中任何规则（只能落到 else），如 ${missSample.join('；')}——请检查是否漏了条件`,
      );
    }
    if (overlap > 0) {
      warnings.push(
        `路由节点 ${n.id}：${overlap} 个变量组合同时命中多条规则（如 ${overlapSample.join('；')}），暂按「先匹配先生效」处理`,
      );
    }
  }
}

/** 模拟用：应用选项效果后的新变量（与引擎 applyEffects 的变量部分一致） */
function afterEffects(vars: Record<string, number>, effects: Effect[], defs: VarDefs): Record<string, number> {
  const out = { ...vars };
  for (const e of effects) {
    if (!('var' in e)) continue;
    const d = defs[e.var];
    if (!d) continue; // 未声明变量已单独报错
    let v = out[e.var] ?? d.init;
    if (e.set !== undefined) v = e.set;
    if (e.add !== undefined) v += e.add;
    out[e.var] = Math.min(d.max, Math.max(d.min, v));
  }
  return out;
}

/** 全路径模拟：从起点穷举所有选择，确认每条路都走到结局、没有异常 */
function simulate(story: Story, problems: string[], warnings: string[]): void {
  const seen = new Set<string>();
  const endings = new Set<string>();
  const stack: { nodeId: string; vars: Record<string, number> }[] = [
    { nodeId: story.start, vars: initVars(story.vars) },
  ];
  let steps = 0;
  while (stack.length > 0) {
    if ((steps += 1) > MAX_SIM_STEPS) {
      warnings.push(`全路径模拟步数超过 ${MAX_SIM_STEPS}，提前停止（分支太大？）`);
      break;
    }
    const { nodeId, vars } = stack.pop()!;
    const key = `${nodeId}|${fmtVars(vars)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = story.nodes[nodeId];
    if (!node) continue; // 目标不存在已单独报错
    const nx = node.next;
    if (nx.kind === 'ending') {
      endings.add(nx.id);
    } else if (nx.kind === 'goto') {
      stack.push({ nodeId: nx.to, vars });
    } else if (nx.kind === 'route') {
      let target: string | null = null;
      for (const r of nx.rules) {
        try {
          if (evalExpr(r.when, vars)) {
            target = r.to;
            break;
          }
        } catch {
          break; // 求值失败已单独报错
        }
      }
      stack.push({ nodeId: target ?? nx.else, vars });
    } else {
      for (const o of nx.options) {
        if (!o.to) continue; // 无去向已单独报错
        stack.push({ nodeId: o.to, vars: afterEffects(vars, o.effects, story.vars) });
      }
    }
  }
  // 每个结局都要有实际可达路径
  for (const n of Object.values(story.nodes)) {
    if (n.next.kind === 'ending' && !endings.has(n.next.id)) {
      problems.push(`结局 ${n.next.id}（节点 ${n.id}）在任何变量组合下都走不到`);
    }
  }
}

/** 章节字数与目标（2.0–2.5 万字符）差得太多就提示，不判失败 */
function checkChapterChars(story: Story, meta: CheckMeta, warnings: string[]): void {
  const low = CHAPTER_CHARS_MIN * (1 - CHAPTER_CHARS_TOLERANCE);
  const high = CHAPTER_CHARS_MAX * (1 + CHAPTER_CHARS_TOLERANCE);
  for (const ch of story.chapters) {
    const chars = meta.chapterChars[ch.n] ?? 0;
    if (chars < low || chars > high) {
      warnings.push(`第 ${ch.n} 章正文字数 ${chars}（目标 ${CHAPTER_CHARS_MIN}–${CHAPTER_CHARS_MAX}）`);
    }
  }
}
