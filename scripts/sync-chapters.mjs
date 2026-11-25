/**
 * 章节同步脚本：仅检测 content/stories 下 .story.txt 变更 → 跑测试 → 提交 → 推送。
 *
 * 工作流分工：
 *   - 书写模型：只改 chapterN.md（文稿源，不参与播放）
 *   - Coding agent：将 md 转为 chapterN.story.txt（播放 DSL，需人工/Agent 转换）
 *   - 本脚本 + CI：只在 .story.txt 变更时校验、提交、部署
 *
 * 用法：
 *   node scripts/sync-chapters.mjs          # 单次同步
 *   node scripts/sync-chapters.mjs --watch  # 监听 .story.txt 变更后自动同步
 *   node scripts/sync-chapters.mjs --dry-run  # 仅预览，不提交推送
 */
import { execSync, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const STORIES_DIR = join(ROOT, 'content', 'stories');
const args = new Set(process.argv.slice(2));
const isWatch = args.has('--watch');
const isDryRun = args.has('--dry-run');
const DEBOUNCE_MS = 2500;

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

/** chapter1.story.txt → 1 */
function chapterNumFromPath(filePath) {
  const m = /chapter(\d+)\.story\.txt$/i.exec(filePath.replace(/\\/g, '/'));
  return m ? Number(m[1]) : null;
}

/** 1 → 第一章；11 → 第十一章 */
function toChineseChapter(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 0) return `${n}`;
  if (n < 10) return `第${digits[n]}章`;
  if (n === 10) return '第十章';
  if (n < 20) return `第十${digits[n % 10]}章`;
  if (n % 10 === 0) return `第${toChineseNumber(n)}章`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `第${digits[tens]}十${digits[ones]}章`;
}

function toChineseNumber(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 20) return `十${n === 10 ? '' : digits[n % 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? `${digits[tens]}十` : `${digits[tens]}十${digits[ones]}`;
}

/** 根据变更文件生成提交说明，如「第一、二章章节更新」 */
export function buildCommitMessage(changedFiles) {
  const nums = changedFiles
    .map(chapterNumFromPath)
    .filter((n) => n !== null)
    .sort((a, b) => a - b);

  if (nums.length === 0) {
    const names = changedFiles.map((f) => basename(f)).join('、');
    return `${names}章节更新`;
  }

  if (nums.length === 1) {
    return `${toChineseChapter(nums[0])}章节更新`;
  }

  // 连续章节：第一、二、三章；非连续：第一章、第三章
  const isContiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (isContiguous && nums.length <= 4) {
    const inner = nums
      .map((n) => {
        const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        return n < 10 ? d[n] : toChineseNumber(n);
      })
      .join('、');
    return `第${inner}章章节更新`;
  }

  return `${nums.map(toChineseChapter).join('、')}章节更新`;
}

function collectChangedFilesUnderStories(filter) {
  const chunks = [
    runCapture('git diff --name-only -- content/stories'),
    runCapture('git diff --cached --name-only -- content/stories'),
    runCapture('git ls-files --others --exclude-standard -- content/stories'),
  ];
  return [
    ...new Set(
      chunks
        .flatMap((s) => (s ? s.split('\n') : []))
        .map((f) => f.trim())
        .filter(filter)
        .map((f) => f.replace(/\\/g, '/')),
    ),
  ];
}

/** 获取待同步的 .story.txt（含未跟踪、已暂存、工作区修改） */
function collectChangedStoryFiles() {
  return collectChangedFilesUnderStories(
    (f) => f.endsWith('.story.txt') && !f.endsWith('.bak'),
  );
}

/** 获取变更的文稿 .md（书写模型产物，不触发自动推送） */
function collectChangedMdFiles() {
  return collectChangedFilesUnderStories((f) => /chapter\d+\.md$/i.test(f));
}

function hasUnpushedCommits() {
  try {
    runCapture('git rev-parse --abbrev-ref @{u}');
    const out = runCapture('git status -sb');
    return out.includes('ahead');
  } catch {
    return false;
  }
}

export async function syncOnce() {
  const changed = collectChangedStoryFiles();
  const pendingMd = collectChangedMdFiles();
  const unpushed = hasUnpushedCommits();

  if (changed.length === 0 && pendingMd.length > 0) {
    console.log('[story:sync] 检测到文稿 .md 变更，但尚无 .story.txt 更新：');
    pendingMd.forEach((f) => console.log(`  - ${f}`));
    console.log('[story:sync] .md 无法自动转为播放 DSL，请由 coding agent 完成转换后再运行本脚本。');
    return { ok: true, skipped: true, pendingMd: true };
  }

  if (changed.length === 0 && !unpushed) {
    console.log('[story:sync] 没有 .story.txt 变更，也无需推送。');
    return { ok: true, skipped: true };
  }

  if (changed.length > 0) {
    console.log('[story:sync] 检测到变更：');
    changed.forEach((f) => console.log(`  - ${f}`));

    console.log('[story:sync] 运行测试…');
    try {
      run('npm test', { silent: false });
    } catch {
      console.error('[story:sync] 测试未通过，已中止提交。');
      return { ok: false };
    }

    const mdToInclude = collectChangedMdFiles();
    const filesToAdd = [...changed, ...mdToInclude];

    if (mdToInclude.length > 0) {
      console.log('[story:sync] 同时纳入文稿 .md：');
      mdToInclude.forEach((f) => console.log(`  - ${f}`));
    }

    const message = buildCommitMessage(changed);
    console.log(`[story:sync] 提交说明：${message}`);

    if (isDryRun) {
      console.log('[story:sync] --dry-run：跳过 git add / commit / push');
      return { ok: true, dryRun: true, message };
    }

    const add = spawnSync('git', ['add', '--', ...filesToAdd], { cwd: ROOT, stdio: 'inherit' });
    if (add.status !== 0) return { ok: false };

    const status = runCapture('git status --porcelain');
    if (status.length > 0) {
      const commit = spawnSync('git', ['commit', '-m', message], { cwd: ROOT, stdio: 'inherit' });
      if (commit.status !== 0) return { ok: false };
    }
  } else if (unpushed) {
    console.log('[story:sync] 无新变更，但存在未推送的提交，准备推送…');
  }

  if (isDryRun) {
    return { ok: true, dryRun: true };
  }

  const branch = runCapture('git rev-parse --abbrev-ref HEAD');
  console.log(`[story:sync] 推送到 origin/${branch}…`);
  run(`git push origin ${branch}`);
  console.log('[story:sync] 完成。');
  return { ok: true };
}

function startWatch() {
  console.log(`[story:sync] 监听 ${STORIES_DIR}（${DEBOUNCE_MS}ms 防抖）…`);
  let timer = null;
  let syncing = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (syncing) return;
      syncing = true;
      try {
        await syncOnce();
      } finally {
        syncing = false;
      }
    }, DEBOUNCE_MS);
  };

  watch(STORIES_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.story.txt') || filename.endsWith('.bak')) return;
    console.log(`[story:sync] 检测到变更：${filename}`);
    schedule();
  });
}

// 直接执行入口
const entry = process.argv[1];
const isMain = entry && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  if (isWatch) {
    startWatch();
  } else {
    syncOnce().then((r) => {
      if (!r.ok) process.exit(1);
    });
  }
}
