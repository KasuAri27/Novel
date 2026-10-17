/**
 * 编译脚本：story/chapters/*.md + *.logic.yaml → public/story/story.json
 *
 * 只抽“结构”：章标题、节点、说话人、选择、选项、回响、汇合收束；
 * 选项效果、路由、结局从同章 logic.yaml 合并进来（M3）。
 * 引用块（以 > 开头）一律当开发注记剥离，不进播放文本。
 *
 * 运行：npm run story:build   （编译并写出）
 * 校验：npm run story:check   （只校验；校验逻辑在 scripts/check-story.ts）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { parseVars } from '../src/engine/vars.ts';
import { parseExpr } from '../src/engine/expr.ts';
import { checkStory, summarize, type CheckMeta } from './check-story.ts';
import type { Story, Node, Block, Next, ChapterMeta, Effect, Expr, StoryAssets } from '../src/engine/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CHAPTER_FILES = ['ch01.md', 'ch02.md', 'ch03.md', 'ch04.md'];

/** 统计正文字数（去掉所有空白后的字符数），供章节篇幅校验 */
const countChars = (s: string): number => s.replace(/\s+/g, '').length;

// ---- logic.yaml 结构：选项效果 / 路由 / 结局 ----
// 效果三种：{var,add/set} 单值变量；{rel:[A,B],add} 二元关系；{know,fact} 信息差。
const EffectSchema = z.union([
  z.object({ var: z.string(), add: z.number().optional(), set: z.number().optional() }),
  z.object({ rel: z.tuple([z.string(), z.string()]), add: z.number() }),
  z.object({ know: z.string(), fact: z.string() }),
]);
const LogicSchema = z
  .object({
    choices: z.record(z.string(), z.record(z.string(), z.object({ effects: z.array(EffectSchema) }))).optional(),
    // routes 的键是“分流发生处的节点 id”（如第四章章首 ch04_S0）。
    routes: z
      .record(
        z.string(),
        z.object({ rules: z.array(z.object({ when: z.string(), goto: z.string() })), else: z.string() }),
      )
      .optional(),
    // endings 的键是“作为章末终结点的小节 id”，值是结局编号。
    endings: z.record(z.string(), z.string()).optional(),
  })
  .optional();

interface Logic {
  effects: Record<string, Record<string, Effect[]>>;
  routes: Record<string, { kind: 'route'; rules: { when: Expr; to: string }[]; else: string }>;
  endings: Record<string, string>;
  /** 选择编号 → logic.yaml 里写的选项键（原样保留，供校验双向比对） */
  choiceKeys: Record<string, string[]>;
}

/** 读一章的 logic.yaml（可缺省）；when 字符串编译成表达式语法树；出错时带上文件名 */
function loadLogic(chapterNo: number): Logic {
  const out: Logic = { effects: {}, routes: {}, endings: {}, choiceKeys: {} };
  const fileName = `ch${String(chapterNo).padStart(2, '0')}.logic.yaml`;
  const file = resolve(ROOT, 'story', 'chapters', fileName);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  let data: z.infer<typeof LogicSchema>;
  try {
    data = LogicSchema.parse(parseYaml(text) ?? {});
  } catch (e) {
    if (e instanceof z.ZodError) {
      const detail = e.issues.map((i) => `${i.path.join('.') || '(根)'} — ${i.message}`).join('；');
      throw new Error(`${fileName} 校验失败：${detail}`);
    }
    throw new Error(`${fileName} 不是合法 YAML：${(e as Error).message}`);
  }
  if (data?.choices) {
    for (const [cid, opts] of Object.entries(data.choices)) {
      out.effects[cid] = {};
      for (const [key, v] of Object.entries(opts)) out.effects[cid]![key] = v.effects as Effect[];
      out.choiceKeys[cid] = Object.keys(opts);
    }
  }
  if (data?.routes) {
    for (const [id, r] of Object.entries(data.routes)) {
      out.routes[id] = {
        kind: 'route',
        rules: r.rules.map((x, i) => {
          try {
            return { when: parseExpr(x.when), to: x.goto };
          } catch (e) {
            throw new Error(`${fileName} 路由 ${id} 第 ${i + 1} 条的条件无法解析：${(e as Error).message}`);
          }
        }),
        else: r.else,
      };
    }
  }
  if (data?.endings) Object.assign(out.endings, data.endings);
  return out;
}

/** 读取素材清单 story/assets.yaml（可缺省；缺文件时给空表） */
function loadAssets(): StoryAssets {
  const out: StoryAssets = { portraits: {} };
  const file = resolve(ROOT, 'story', 'assets.yaml');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  const schema = z.object({ portraits: z.record(z.string(), z.string()).optional() });
  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(parseYaml(text) ?? {});
  } catch (e) {
    if (e instanceof z.ZodError) {
      const detail = e.issues.map((i) => `${i.path.join('.') || '(根)'} — ${i.message}`).join('；');
      throw new Error(`assets.yaml 校验失败：${detail}`);
    }
    throw new Error(`assets.yaml 不是合法 YAML：${(e as Error).message}`);
  }
  if (data.portraits) out.portraits = data.portraits;
  return out;
}

interface PendingOption {
  key: string;
  text: string;
  echo: Block[];
}
interface PendingChoice {
  id: string;
  prompt: string;
  options: PendingOption[];
}
interface ParsedNode {
  id: string;
  chapter: number;
  title: string;
  blocks: Block[];
  choice?: PendingChoice;
}

/** 解析一章 md，返回章标题、按出现顺序排列的节点、正文字数与解析警告 */
function parseChapter(
  text: string,
  chapterNo: number,
): { title: string; nodes: ParsedNode[]; chars: number; warnings: string[] } {
  const lines = text.split(/\r?\n/);
  const nodes: ParsedNode[] = [];
  const warnings: string[] = [];
  let chars = 0; // 本章正文（含选项文字、提示语，去空白）的字符数
  let title = '';
  let cur: ParsedNode | null = null;
  let choice: PendingChoice | null = null;
  let section: 'node' | 'echo' | 'merge' = 'node';
  let branchKey: string | null = null;
  let mergeBlocks: Block[] = [];
  let speaker = '旁白';
  let buf: string[] = [];
  let expectPrompt = false;

  // 当前段落该推进到哪个容器
  const target = (): Block[] | null => {
    if (section === 'echo' && choice && branchKey) {
      return choice.options.find((o) => o.key === branchKey)?.echo ?? null;
    }
    if (section === 'merge') return mergeBlocks;
    return cur ? cur.blocks : null;
  };

  const flush = (): void => {
    if (buf.length === 0) return;
    const body = buf.join('\n');
    chars += countChars(body);
    const t = target();
    if (t) t.push({ type: 'text', speaker, text: body });
    buf = [];
  };

  // 结束一个选择块：把汇合收束文字并入每个选项回响的尾部
  const endChoice = (): void => {
    flush();
    if (choice) {
      if (mergeBlocks.length > 0) {
        for (const o of choice.options) o.echo = o.echo.concat(mergeBlocks);
      }
      mergeBlocks = [];
      section = 'node';
      branchKey = null;
      choice = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, '');
    const t = line.trim();

    if (line.startsWith('>')) continue; // 引用块：开发注记
    if (t === '') {
      flush();
      continue;
    }
    if (t === '---' || t === '***') continue;

    if (/^#\s+/.test(t)) {
      title = t.replace(/^#\s+/, '');
      continue;
    }
    if (/^##\s*❖/.test(t)) {
      endChoice(); // 路线分组标题：只分组，不生成节点
      continue;
    }

    // 节点：## SN　标题 / ### S-D1　标题
    const nodeMatch = /^##\s+(S[^\s　]+)[\s　]+(.*)$/.exec(t) ?? /^###\s+(S[^\s　]+)[\s　]+(.*)$/.exec(t);
    if (nodeMatch) {
      endChoice();
      const label = nodeMatch[1]!.replace(/\s+/g, '');
      cur = {
        id: `ch${String(chapterNo).padStart(2, '0')}_${label}`,
        chapter: chapterNo,
        title: nodeMatch[2]!.trim(),
        blocks: [],
      };
      nodes.push(cur);
      speaker = '旁白';
      continue;
    }

    // 旧写法：### 分支走向展现（E01） / #### 若选择 A（…）：
    if (/^#{1,6}\s*分支走向展现（\s*E\d+\s*）/.test(t)) {
      flush();
      section = 'echo';
      branchKey = null;
      speaker = '旁白';
      continue;
    }
    const oldBranch = /^#{1,6}\s*若选择\s*([ABC])/.exec(t);
    if (oldBranch) {
      flush();
      branchKey = oldBranch[1]!;
      speaker = '旁白';
      continue;
    }

    // 选择头：**/无加粗 【选择 Exx｜标题】
    const choiceHead = /^\*{0,2}【选择\s*(E\d+)\s*[｜|].*?】\*{0,2}$/.exec(t);
    if (choiceHead) {
      flush();
      if (cur?.choice) {
        warnings.push(
          `节点 ${cur.id} 出现了多个选择块（先 ${cur.choice.id}、后 ${choiceHead[1]!}），只保留最后一个`,
        );
      }
      choice = { id: choiceHead[1]!, prompt: '', options: [] };
      if (cur) cur.choice = choice;
      section = 'node';
      branchKey = null;
      expectPrompt = true;
      continue;
    }
    if (/^\*{0,2}【分支走向展现（\s*E\d+\s*）】\*{0,2}$/.test(t)) {
      flush();
      section = 'echo';
      branchKey = null;
      speaker = '旁白';
      continue;
    }
    const branch = /^\*{0,2}若选择\s*([ABC])\s*[（(][^）)]*[）)]\s*[:：]\*{0,2}$/.exec(t);
    if (branch) {
      flush();
      branchKey = branch[1]!;
      speaker = '旁白';
      continue;
    }
    if (/^\*{0,2}【汇合收束】\*{0,2}$/.test(t)) {
      flush();
      section = 'merge';
      branchKey = null;
      speaker = '旁白';
      continue;
    }
    if (/^\*{0,2}——.*·完——\*{0,2}$/.test(t)) {
      endChoice();
      continue;
    }

    // 选项：*A　文字*
    const opt = /^\*([ABC])[　\s]+(.+)\*$/.exec(t);
    if (opt && choice) {
      flush();
      expectPrompt = false;
      const optionText = opt[2]!.trim();
      chars += countChars(optionText);
      choice.options.push({ key: opt[1]!, text: optionText, echo: [] });
      continue;
    }

    // 斜体提示：**选择头后的一条
    const italic = /^\*(.+)\*$/.exec(t);
    if (italic && choice && expectPrompt) {
      const prompt = italic[1]!.trim();
      chars += countChars(prompt);
      choice.prompt = prompt;
      expectPrompt = false;
      continue;
    }

    // 说话人：### 名字（非节点）
    const sp = /^###\s+(.+)$/.exec(t);
    if (sp) {
      flush();
      speaker = sp[1]!.trim();
      continue;
    }

    buf.push(t); // 正文段落
  }

  flush();
  endChoice();
  return { title, nodes, chars, warnings };
}

function build(): { story: Story; meta: CheckMeta; parseWarnings: string[] } {
  const vars = parseVars(readFileSync(resolve(ROOT, 'story', 'vars.yaml'), 'utf8'));
  const chapters: ChapterMeta[] = [];
  const ordered: ParsedNode[] = [];
  const effects: Record<string, Record<string, Effect[]>> = {};
  const routes: Record<string, { kind: 'route'; rules: { when: Expr; to: string }[]; else: string }> = {};
  const endings: Record<string, string> = {};
  const meta: CheckMeta = { parsedNodeIds: [], logicChoiceIds: [], logicChoiceKeys: {}, chapterChars: {} };
  const parseWarnings: string[] = [];

  for (const file of CHAPTER_FILES) {
    const n = Number.parseInt(file.slice(2, 4), 10);
    const text = readFileSync(resolve(ROOT, 'story', 'chapters', file), 'utf8');
    const { title, nodes, chars, warnings } = parseChapter(text, n);
    ordered.push(...nodes);
    chapters.push({ n, title, file: `story/chapters/${file}`, nodes: nodes.map((x) => x.id) });
    meta.chapterChars[n] = chars;
    parseWarnings.push(...warnings);
    const logic = loadLogic(n);
    Object.assign(effects, logic.effects);
    Object.assign(routes, logic.routes);
    Object.assign(endings, logic.endings);
    for (const [cid, keys] of Object.entries(logic.choiceKeys)) {
      meta.logicChoiceIds.push(cid);
      meta.logicChoiceKeys[cid] = keys;
    }
  }

  const nodes: Record<string, Node> = {};
  const synthetic: { id: string; chapter: number; next: Next }[] = [];

  ordered.forEach((p, i) => {
    const nextId = ordered[i + 1]?.id;
    const choiceNext = (toId?: string): Next => ({
      kind: 'choice',
      id: p.choice!.id,
      prompt: p.choice!.prompt,
      options: p.choice!.options.map((o) => ({
        key: o.key,
        text: o.text,
        echo: o.echo,
        effects: effects[p.choice!.id]?.[o.key] ?? [],
        ...(toId ? { to: toId } : {}),
      })),
    });

    let next: Next;
    if (endings[p.id]) {
      if (p.choice) {
        // 选择之后才收束：插一个无正文的结局节，三个选项都通向它
        const eid = `${p.id}__end`;
        next = choiceNext(eid);
        synthetic.push({ id: eid, chapter: p.chapter, next: { kind: 'ending', id: endings[p.id]! } });
      } else {
        next = { kind: 'ending', id: endings[p.id]! };
      }
    } else if (routes[p.id]) {
      const route = routes[p.id]!;
      if (p.choice) {
        // 选择之后才分流：插一个无正文的路由节，三个选项都通向它
        const rid = `${p.id}__route`;
        next = choiceNext(rid);
        synthetic.push({ id: rid, chapter: p.chapter, next: route });
      } else {
        next = route;
      }
    } else if (p.choice) {
      next = choiceNext(nextId);
    } else {
      next = nextId ? { kind: 'goto', to: nextId } : { kind: 'ending', id: `END_${p.id}` };
    }
    nodes[p.id] = { id: p.id, chapter: p.chapter, title: p.title, blocks: p.blocks, next };
  });

  for (const s of synthetic) nodes[s.id] = { id: s.id, chapter: s.chapter, title: '', blocks: [], next: s.next };

  const story: Story = { version: 1, start: ordered[0]!.id, vars, facts: {}, nodes, chapters, assets: loadAssets() };
  meta.parsedNodeIds = ordered.map((x) => x.id);
  return { story, meta, parseWarnings };
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const { story, meta, parseWarnings } = build();
  const { problems, warnings } = checkStory(story, meta);
  warnings.push(...parseWarnings);

  console.log('--- story 统计 ---');
  for (const l of summarize(story, meta)) console.log(l);

  if (problems.length > 0) {
    console.log(`\n--- 问题 ${problems.length} 项（判失败）---`);
    for (const p of problems) console.log('  × ' + p);
  } else {
    console.log('\n校验：无问题');
  }
  if (warnings.length > 0) {
    console.log(`\n--- 提示 ${warnings.length} 项（不判失败）---`);
    for (const w of warnings) console.log('  · ' + w);
  }

  if (!checkOnly) {
    const outDir = resolve(ROOT, 'public', 'story');
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, 'story.json');
    writeFileSync(outFile, JSON.stringify(story, null, 2), 'utf8');
    console.log(`\n已写出：${outFile}`);
  }

  if (problems.length > 0) process.exitCode = 1;
}

main();
