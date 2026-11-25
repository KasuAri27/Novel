/**
 * 将 chapterN.story.txt 叙事行换行与 chapterN.md 对齐（md 每个非空行 → story 一行）。
 * DSL（@node、[choice]、[goto] 等）保持不变。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const chapters = process.argv.slice(2).map(Number).filter(Boolean);
const TARGETS = chapters.length ? chapters : [1, 2, 3, 4];

function cleanMdLine(line) {
  let s = line.trim();
  if (!s || s === '---') return null;
  if (/^\*[ABCＡ-Ｃ][　\s]/.test(s)) return null;
  if (s.startsWith('> ')) s = s.slice(2);
  else if (s.startsWith('>')) s = s.slice(1);
  if (s.startsWith('- ')) s = s.slice(2);
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  return s.trim() || null;
}

const SKIP_LINE = /^(#{1,6}\s|>\s|\*\*\*|---|\*\*【选择|\*\*【汇合|#### )/;

function linesFromChunk(chunk) {
  const out = [];
  for (const line of chunk.split(/\r?\n/)) {
    if (SKIP_LINE.test(line.trim())) continue;
    const c = cleanMdLine(line);
    if (c && !/^[ABCＡ-Ｃ][　\s]/.test(c)) out.push(c);
  }
  return out;
}

function sliceMd(md, startRe, endRe) {
  const m = startRe.exec(md);
  if (!m) return [];
  const from = m.index + m[0].length;
  const rest = md.slice(from);
  const end = endRe.exec(rest);
  const chunk = end ? rest.slice(0, end.index) : rest;
  return linesFromChunk(chunk);
}

function extractBranchesAfter(md, choiceLabel) {
  // choiceLabel e.g. 'E01'
  const startRe = new RegExp(`\\*\\*【选择 ${choiceLabel}[｜|]`, 'm');
  const m = startRe.exec(md);
  if (!m) return [];
  const rest = md.slice(m.index);
  const branches = [];
  const branchRe = /#### (?:分支 [ABCＡ-Ｃ]|若选择 [ABCＡ-Ｃ])/g;
  let match;
  const indices = [];
  while ((match = branchRe.exec(rest)) !== null) indices.push(match.index);
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = indices[i + 1] ?? rest.length;
    const chunk = rest.slice(start, end);
    const lines = [];
    let first = true;
    for (const line of chunk.split(/\r?\n/)) {
      if (first && /^#### /.test(line.trim())) {
        first = false;
        continue;
      }
      if (/^#### 平滑收束|^#### 汇合|^\*\*【汇合收束】/.test(line.trim())) break;
      if (SKIP_LINE.test(line.trim())) continue;
      const c = cleanMdLine(line);
      if (c && !/^[ABCＡ-Ｃ][　\s]/.test(c)) lines.push(c);
    }
    branches.push(lines);
  }
  return branches;
}

function extractChoiceIntro(md, choiceLabel) {
  const startRe = new RegExp(`\\*\\*【选择 ${choiceLabel}[｜|][^\\n]*\\*\\*`, 'm');
  const m = startRe.exec(md);
  if (!m) return [];
  const rest = md.slice(m.index + m[0].length);
  const end = /---|#### |^## S/m.exec(rest);
  const chunk = end ? rest.slice(0, end.index) : rest;
  return linesFromChunk(chunk);
}

function extractMergeBeforeS(md, sNum) {
  const sRe = new RegExp(`^## S${sNum}[　\\s]`, 'm');
  const sm = sRe.exec(md);
  if (!sm) return [];
  const before = md.slice(0, sm.index);
  const mergeRe = /#### 平滑收束|#### 汇合收束|#### 汇合|^\*\*【汇合收束】/gm;
  let last = null;
  let m;
  while ((m = mergeRe.exec(before)) !== null) last = m;
  if (!last) return [];
  const chunk = before.slice(last.index);
  return linesFromChunk(chunk);
}

function isChoiceHub(id) {
  return /^ch\d_e\d+$/.test(id);
}

function isBranchNode(id) {
  return /^ch\d_e\d+_[a-z0-9_]+$/.test(id) || /^ch4_(?:s0_echo|3p_e19|nocase_echo)_[a-z0-9_]+$/.test(id);
}

function parseStory(text) {
  const lines = text.split(/\r?\n/);
  const parts = [];
  let cur = null;
  let pendingTag = null;
  let lastETag = null;

  for (const line of lines) {
    const sec = /^# (S\d+|E\d+)[　\s]/.exec(line);
    if (sec) {
      pendingTag = sec[1];
      if (sec[1].startsWith('E')) lastETag = sec[1];
    }

    if (line.startsWith('@node ')) {
      cur = {
        id: line.slice(6).trim(),
        tag: pendingTag,
        lastETag,
        header: line,
        items: [],
      };
      parts.push({ type: 'node', node: cur });
      pendingTag = null;
      continue;
    }
    if (line.startsWith('@') || (line.startsWith('#') && !line.startsWith('@node'))) {
      parts.push({ type: 'raw', line });
      if (!line.startsWith('@node')) cur = null;
      continue;
    }
    if (!cur) {
      parts.push({ type: 'raw', line });
      continue;
    }
    if (line.startsWith('[choice]') || line.startsWith('[goto]') || line.startsWith('[enter]')) {
      cur.items.push({ kind: 'dsl', line });
    } else if (line.trim() !== '') {
      cur.items.push({ kind: 'narrative', line });
    }
  }
  return parts;
}

function setNarrative(node, lines) {
  const dsl = node.items.filter((i) => i.kind === 'dsl');
  node.items = [...lines.map((line) => ({ kind: 'narrative', line })), ...dsl];
}

function alignChapter(n, md, parsed) {
  const nodes = parsed.filter((p) => p.type === 'node').map((p) => p.node);
  const branchQueues = new Map();

  const getBranches = (label) => {
    if (!label) return [];
    if (!branchQueues.has(label)) {
      branchQueues.set(label, extractBranchesAfter(md, label));
    }
    return branchQueues.get(label);
  };

  const takeBranch = (label) => {
    const q = getBranches(label);
    return q.shift() ?? [];
  };

  for (const node of nodes) {
    const id = node.id;
    const tag = node.tag;
    const eTag = tag?.startsWith('E') ? tag : node.lastETag;
    let lines = [];

    if (isChoiceHub(id) && eTag) {
      lines = extractChoiceIntro(md, eTag);
    } else if (isBranchNode(id)) {
      if (/^ch4_s0_echo_/.test(id)) {
        const branches = getBranches('E18');
        const idx = ['noah', 'leiya', 'breakfast'].findIndex((k) => id.includes(k));
        lines = branches[idx] ?? takeBranch(eTag);
      } else if (/^ch4_3p_e19_/.test(id)) {
        const branches = getBranches('E19');
        const idx = ['spot', 'evidence', 'leiya'].findIndex((k) => id.includes(k));
        lines = branches[idx] ?? takeBranch(eTag);
      } else if (/^ch4_nocase_echo_/.test(id)) {
        const branches = getBranches('E23');
        const idx = ['shiro', 'party', 'library'].findIndex((k) => id.includes(k));
        lines = branches[idx] ?? takeBranch(eTag);
      } else {
        lines = takeBranch(eTag);
      }
    } else if (tag?.startsWith('S')) {
      const num = tag.slice(1);
      const merge = extractMergeBeforeS(md, num);
      let body = sliceMd(md, new RegExp(`^## S${num}[　\\s][^\\n]*`, 'm'), /^## S\d+[　\s]|^\*\*【选择/m);
      if (body.length === 0 && n === 4) {
        body = sliceMd(
          md,
          new RegExp(`^## [^\\n]*S[-]?${num === '0' ? '0' : 'A' + num}[^\\n]*|^### S[-][^\\n]*`, 'm'),
          /^## |^### S[-]|^\*\*【选择/m,
        );
      }
      lines = [...merge, ...body];
    } else if (id === 'ch4_s0_router' || id === 'ch2_s0_router' || id === 'ch3_s0_router') {
      const body = sliceMd(md, /^## S\d+[　\s][^\n]*/m, /^## S\d+[　\s]|^\*\*【选择|^## ◇/m);
      lines = body;
    }

    if (lines.length > 0) setNarrative(node, lines);
  }
}

function serialize(parsed) {
  const out = [];
  for (const p of parsed) {
    if (p.type === 'raw') out.push(p.line);
    else {
      out.push(p.node.header);
      for (const it of p.node.items) out.push(it.line);
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

for (const n of TARGETS) {
  const md = readFileSync(join(ROOT, `chapter${n}.md`), 'utf-8');
  const storyPath = join(ROOT, `content/stories/majo_shinpan/chapter${n}.story.txt`);
  const parsed = parseStory(readFileSync(storyPath, 'utf-8'));
  alignChapter(n, md, parsed);
  writeFileSync(storyPath, serialize(parsed), 'utf-8');
  console.log(`[align] chapter${n} done`);
}
