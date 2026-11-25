import { describe, expect, it } from 'vitest';
import { buildCommitMessage } from '../scripts/sync-chapters.mjs';

describe('章节同步提交说明', () => {
  it('单章：第一章章节更新', () => {
    expect(buildCommitMessage(['content/stories/majo_shinpan/chapter1.story.txt'])).toBe('第一章章节更新');
  });

  it('连续多章：第一、二章章节更新', () => {
    expect(
      buildCommitMessage([
        'content/stories/majo_shinpan/chapter1.story.txt',
        'content/stories/majo_shinpan/chapter2.story.txt',
      ]),
    ).toBe('第一、二章章节更新');
  });

  it('非连续多章：第一章、第三章章节更新', () => {
    expect(
      buildCommitMessage([
        'content/stories/majo_shinpan/chapter1.story.txt',
        'content/stories/majo_shinpan/chapter3.story.txt',
      ]),
    ).toBe('第一章、第三章章节更新');
  });
});
