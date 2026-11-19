/**
 * 编译器：.story.txt DSL 文本 → 内部 Story 模型。
 *
 * 三阶段：
 *   1) parseFile：lex + 逐行归类，构建 FileAst（含 when/do 表达式解析）；
 *   2) 合并：@story id 相同的多个文件合并为一个剧情（支持多章节）；
 *   3) 校验组装：引用完整性（角色/事实/跳转目标/说话者）+ zod 模型校验。
 * 所有错误都带来源文件名与行号，交给 ImportDebugPanel 展示。
 */
import type { Condition, Effect, Ending, Story, StoryChar, StoryNode } from '../engine/types';
import { lex, parseAttrs, type Token } from './lexer';
import { findKeyword, parseCondition, parseEffects } from './expressions';
import type { CharDecl, EndDecl, FileAst, NodeDecl, NodeItem } from './ast';
import { storySchema } from './schema';

export interface CompileError {
  file: string;
  line: number;
  message: string;
}

export interface CompileResult {
  stories: Story[];
  errors: CompileError[];
}

export interface StoryFile {
  name: string;
  source: string;
}

// ---------------------------------------------------------------------------
// 阶段 1：单文件 → FileAst
// ---------------------------------------------------------------------------

function firstToken(s: string): string {
  const m = /^(\S+)/.exec(s.trim());
  return m ? m[1] : '';
}

function splitSpeaker(text: string): { speaker: string | null; body: string } {
  const gt = text.indexOf('>');
  // 明确旁白标记：以 ">" 开头
  if (gt === 0) return { speaker: null, body: text.slice(1).trim() };
  if (gt > 0) {
    const speaker = text.slice(0, gt).trim();
    if (speaker && !speaker.startsWith('[')) {
      return { speaker, body: text.slice(gt + 1).trim() };
    }
  }
  return { speaker: null, body: text.trim() };
}

interface EndBuf {
  id: string;
  priority: number;
  when: Condition;
  title: string;
  textLines: string[];
  no: number;
}

type Report = (line: number, msg: string) => void;

function parseFile(source: string, file: string): { ast: FileAst; errors: CompileError[] } {
  const tokens = lex(source);
  const ast: FileAst = { chars: [], facts: [], nodes: [], ends: [] };
  const errors: CompileError[] = [];
  const err: Report = (line, message) => errors.push({ file, line, message });

  let curNode: NodeDecl | null = null;
  let curEnd: EndBuf | null = null;

  const flushNode = () => {
    if (curNode) {
      ast.nodes.push(curNode);
      curNode = null;
    }
  };
  const flushEnd = () => {
    if (curEnd) {
      ast.ends.push({
        id: curEnd.id,
        title: curEnd.title || curEnd.id,
        text: curEnd.textLines.join('\n').trim(),
        when: curEnd.when,
        priority: curEnd.priority,
        no: curEnd.no,
      });
      curEnd = null;
    }
  };

  for (const tok of tokens) {
    if (tok.type === 'directive') {
      flushNode();
      flushEnd();
      const { name, rest, no } = tok;
      if (name === 'story') {
        const idm = /(?:^|\s)id=(\S+)/.exec(rest);
        const ttm = /(?:^|\s)title=(.*)$/.exec(rest);
        if (!idm) err(no, '@story 缺少 id=...');
        else ast.meta = { id: idm[1], title: ttm ? ttm[1].trim() : idm[1] };
      } else if (name === 'char') {
        const positional = /^\S+=/.test(rest.trim()) ? '' : firstToken(rest);
        const attrs = parseAttrs(rest);
        // 属性值后面跟着的开关词（如 `color=#fff me`）不算进值里
        for (const k of Object.keys(attrs)) {
          attrs[k] = attrs[k].replace(/(?:\s+(?:me|immortal))+$/, '');
        }
        const id = attrs.id || positional;
        if (!id) err(no, '@char 需要给出角色名或 id=...');
        else
          ast.chars.push({
            id,
            name: attrs.name || id,
            immortal: /(?:^|\s)immortal(?=\s|$)/.test(rest),
            // avatar= 是聊天模式里更直白的写法，与 asset= 等价
            asset: attrs.avatar || attrs.asset,
            me: /(?:^|\s)me(?=\s|$)/.test(rest) || undefined,
            color: attrs.color,
          });
      } else if (name === 'fact') {
        const id = firstToken(rest);
        if (!id) err(no, '@fact 需要事实 id');
        else ast.facts.push({ id, label: parseAttrs(rest).label });
      } else if (name === 'node') {
        const id = firstToken(rest);
        if (!id) err(no, '@node 需要节点 id');
        else curNode = { id, items: [], no };
      } else if (name === 'entry') {
        const id = firstToken(rest);
        if (!id) err(no, '@entry 需要入口节点 id');
        else ast.entry = id;
      } else if (name === 'end') {
        const whenIdx = findKeyword(rest, 'when');
        const left = whenIdx >= 0 ? rest.slice(0, whenIdx) : rest;
        const condStr = whenIdx >= 0 ? rest.slice(whenIdx + 4) : '';
        const id = firstToken(left);
        if (!id) {
          err(no, '@end 需要结局 id');
        } else {
          const pm = /(?:^|\s)priority=(-?\d+)/.exec(left);
          const parsed = parseCondition(condStr);
          if (parsed.error) err(no, parsed.error);
          curEnd = {
            id,
            priority: pm ? Number(pm[1]) : 0,
            when: parsed.value,
            title: '',
            textLines: [],
            no,
          };
        }
      } else {
        err(no, `未知指令 @${name}`);
      }
      continue;
    }

    // 正文行
    if (curNode) {
      const item = parseNodeBodyLine(tok, err);
      if (item) curNode.items.push(item);
    } else if (curEnd) {
      const t = tok.text.trim();
      if (t.startsWith('title ')) curEnd.title = t.slice(6).trim();
      else if (t.startsWith('text ')) curEnd.textLines.push(t.slice(5).trim());
      else curEnd.textLines.push(tok.text.trim());
    } else {
      err(tok.no, '正文行之前缺少 @node 或 @end 块');
    }
  }
  flushNode();
  flushEnd();
  return { ast, errors };
}

function parseNodeBodyLine(tok: Extract<Token, { type: 'body' }>, report: Report): NodeItem | null {
  const line = tok.text.trim();
  const no = tok.no;
  if (line.startsWith('[choice]')) {
    return parseChoice(line.slice('[choice]'.length).trim(), no, report);
  }
  if (line.startsWith('[goto]')) {
    return { kind: 'goto', target: line.slice('[goto]'.length).trim(), no };
  }
  if (line.startsWith('[enter]')) {
    const raw = line.slice('[enter]'.length).trim().replace(/^do\b/, '').trim();
    const r = parseEffects(raw);
    if (r.error) report(no, r.error);
    return { kind: 'enter', effects: r.value, no };
  }
  const { speaker, body } = splitSpeaker(line);
  if (body === '') {
    report(no, '空的对话/旁白行');
    return null;
  }
  return { kind: 'line', speaker, text: body, no };
}

function parseChoice(raw: string, no: number, report: Report): NodeItem | null {
  let rest = raw;
  let doStr = '';
  let condStr = '';
  const doIdx = findKeyword(rest, 'do');
  if (doIdx >= 0) {
    doStr = rest.slice(doIdx + 2).trim();
    rest = rest.slice(0, doIdx);
  }
  const whenIdx = findKeyword(rest, 'when');
  if (whenIdx >= 0) {
    condStr = rest.slice(whenIdx + 4).trim();
    rest = rest.slice(0, whenIdx);
  }
  const arrow = rest.indexOf('->');
  if (arrow < 0) {
    report(no, '[choice] 缺少 "-> 目标节点"');
    return null;
  }
  const label = rest.slice(0, arrow).trim();
  const target = rest.slice(arrow + 2).trim();
  if (!label || !target) {
    report(no, '[choice] 需要「选项文本 -> 目标节点」');
    return null;
  }
  const cond = parseCondition(condStr);
  if (cond.error) report(no, `when: ${cond.error}`);
  const effs = parseEffects(doStr);
  if (effs.error) report(no, `do: ${effs.error}`);
  return { kind: 'choice', label, goto: target, when: cond.value, do: effs.value, no };
}

// ---------------------------------------------------------------------------
// 阶段 2/3：合并 + 校验 + 组装
// ---------------------------------------------------------------------------

interface Group {
  meta: { id: string; title: string };
  chars: CharDecl[];
  facts: FileAst['facts'];
  nodes: NodeDecl[];
  ends: EndDecl[];
  entry?: string;
  sources: string[];
}

export function compileFiles(files: StoryFile[]): CompileResult {
  const errors: CompileError[] = [];
  const groups = new Map<string, Group>();

  for (const f of files) {
    const { ast, errors: fileErrs } = parseFile(f.source, f.name);
    errors.push(...fileErrs);
    if (!ast.meta) {
      errors.push({ file: f.name, line: 1, message: '文件缺少 @story id=... title=... 头部' });
      continue;
    }
    const key = ast.meta.id;
    let g = groups.get(key);
    if (!g) {
      g = { meta: ast.meta, chars: [], facts: [], nodes: [], ends: [], sources: [] };
      groups.set(key, g);
    }
    g.sources.push(f.name);
    g.chars.push(...ast.chars);
    g.facts.push(...ast.facts);
    g.nodes.push(...ast.nodes);
    g.ends.push(...ast.ends);
    if (ast.entry) g.entry = ast.entry;
  }

  const stories: Story[] = [];
  for (const g of groups.values()) {
    const { story, errs } = assemble(g);
    errors.push(...errs);
    if (story) stories.push(story);
  }
  return { stories, errors };
}

function assemble(g: Group): { story?: Story; errs: CompileError[] } {
  const errs: CompileError[] = [];
  const file = g.sources[0] ?? '?';
  const err = (line: number, message: string) => errs.push({ file, line, message });

  // 角色
  const chars: Record<string, StoryChar> = {};
  for (const c of g.chars) {
    if (chars[c.id]) {
      err(0, `角色「${c.id}」重复声明`);
      continue;
    }
    chars[c.id] = { id: c.id, name: c.name, immortal: c.immortal, asset: c.asset };
    if (c.me) chars[c.id].me = true;
    if (c.color) chars[c.id].color = c.color;
  }
  const meChars = Object.values(chars).filter((c) => c.me);
  if (meChars.length > 1) {
    err(0, `只能有一位主角（me），当前有：${meChars.map((c) => c.id).join('、')}`);
  }

  // 事实
  const facts: Record<string, { label?: string }> = {};
  for (const f of g.facts) {
    if (facts[f.id]) {
      err(0, `事实「${f.id}」重复声明`);
      continue;
    }
    facts[f.id] = { label: f.label };
  }

  const requireChar = (line: number, id: string, ctx: string) => {
    if (!chars[id]) err(line, `${ctx}：未声明的角色「${id}」`);
  };
  const requireFact = (line: number, id: string, ctx: string) => {
    if (!facts[id]) err(line, `${ctx}：未声明的事实「${id}」`);
  };

  const checkVerbRefs = (verb: string, args: string[], line: number, ctx: string) => {
    switch (verb) {
      case 'knows':
      case 'know':
      case 'forget':
        requireChar(line, args[0], ctx);
        requireFact(line, args[1] ?? '', ctx);
        return;
      case 'alive':
      case 'dead':
      case 'explore':
        requireChar(line, args[0], ctx);
        return;
      case 'rel':
        requireChar(line, args[0], ctx);
        requireChar(line, args[1], ctx);
        return;
      default:
        return;
    }
  };
  const checkConditionRefs = (cond: Condition, line: number, ctx: string): void => {
    switch (cond.kind) {
      case 'and':
      case 'or':
        cond.parts.forEach((p) => checkConditionRefs(p, line, ctx));
        return;
      case 'not':
        checkConditionRefs(cond.part, line, ctx);
        return;
      case 'atom':
        checkVerbRefs(cond.verb, cond.args, line, ctx);
        return;
      default:
        return;
    }
  };
  const checkEffectRefs = (effs: Effect[], line: number, ctx: string) =>
    effs.forEach((e) => checkVerbRefs(e.verb, e.args, line, ctx));

  // 节点
  const nodes: Record<string, StoryNode> = {};
  let firstNodeId: string | undefined;
  for (const nd of g.nodes) {
    if (nodes[nd.id]) {
      err(nd.no, `节点「${nd.id}」重复声明`);
      continue;
    }
    if (!firstNodeId) firstNodeId = nd.id;

    const lines = nd.items
      .filter((i): i is Extract<NodeItem, { kind: 'line' }> => i.kind === 'line')
      .map((i) => {
        if (i.speaker) requireChar(i.no, i.speaker, `节点「${nd.id}」对白`);
        return { speaker: i.speaker, text: i.text };
      });

    const onEnter: Effect[] = [];
    for (const i of nd.items) {
      if (i.kind === 'enter') {
        checkEffectRefs(i.effects, i.no, `节点「${nd.id}」[enter]`);
        onEnter.push(...i.effects);
      }
    }

    let k = 0;
    const choices = nd.items
      .filter((i): i is Extract<NodeItem, { kind: 'choice' }> => i.kind === 'choice')
      .map((i) => {
        checkConditionRefs(i.when, i.no, `节点「${nd.id}」[choice].when`);
        checkEffectRefs(i.do, i.no, `节点「${nd.id}」[choice].do`);
        return { id: `c_${nd.id}_${k++}`, label: i.label, goto: i.goto, when: i.when, do: i.do };
      });

    const gotoItems = nd.items.filter(
      (i): i is Extract<NodeItem, { kind: 'goto' }> => i.kind === 'goto',
    );
    const next = gotoItems.length ? gotoItems[gotoItems.length - 1].target : null;
    nodes[nd.id] = { id: nd.id, lines, onEnter, choices, next };
  }

  // 跳转目标存在性
  for (const nd of Object.values(nodes)) {
    for (const c of nd.choices) {
      if (!nodes[c.goto])
        err(0, `节点「${nd.id}」选项「${c.label}」跳转到不存在的节点「${c.goto}」`);
    }
    if (nd.next && !nodes[nd.next]) err(0, `节点「${nd.id}」[goto] 目标「${nd.next}」不存在`);
  }

  // 入口
  let entry = g.entry;
  if (entry && !nodes[entry]) {
    err(0, `@entry 指向不存在的节点「${entry}」`);
    entry = firstNodeId;
  }
  if (!entry) entry = firstNodeId;
  if (!entry) {
    err(0, '剧情没有任何 @node');
    return { errs };
  }

  // 结局
  const endings: Ending[] = [];
  for (const e of g.ends) {
    checkConditionRefs(e.when, e.no, `结局「${e.id}」when`);
    endings.push({ id: e.id, title: e.title, text: e.text, when: e.when, priority: e.priority });
  }

  const story: Story = {
    meta: { id: g.meta.id, title: g.meta.title, sources: g.sources },
    chars,
    facts,
    entry,
    nodes,
    endings,
  };

  const parsed = storySchema.safeParse(story);
  if (!parsed.success) {
    err(
      0,
      `内部模型校验失败：${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
    return { errs };
  }
  if (errs.length) return { errs };
  return { story, errs };
}

/** 便捷入口：编译单个文本（多为测试/单文件预览用） */
export function compileStory(source: string, name = 'inline.story.txt'): CompileResult {
  return compileFiles([{ name, source }]);
}
