import { expect, test } from 'vitest';
import { diffMarkdown, type DiffResult } from '../src/engine/diff';
import { bigPair } from './fixtures/big';

const st = (r: DiffResult) => r.blocks.map(b => b.status);
const T = { threshold: 0.35 };

test('edited paragraph is modified, not replaced', () => {
  const r = diffMarkdown('# T\n\nThe quick brown fox jumps over the lazy dog.', '# T\n\nThe quick red fox leaps over the lazy dog.', T);
  expect(st(r)).toEqual(['unchanged', 'modified']);
  expect(r.stats).toEqual({ changes: 1, wordsAdded: 2, wordsRemoved: 2 });
});

test('rewrapped paragraph unchanged', () => {
  expect(st(diffMarkdown('a b c\nd e', 'a b\nc d e', T))).toEqual(['unchanged']);
});

test('inserted and deleted paragraphs', () => {
  expect(st(diffMarkdown('keep\n\nzap zap zap', 'keep\n\nbrand new words', T))).toEqual(['unchanged', 'deleted', 'inserted']);
});

test('drastic rewrite pairs at 0.2 but not at 0.6', () => {
  const a = 'one two three four five six', b = 'one two nine ten eleven twelve';
  expect(st(diffMarkdown(a, b, { threshold: 0.2 }))).toEqual(['modified']);
  expect(st(diffMarkdown(a, b, { threshold: 0.6 }))).toEqual(['deleted', 'inserted']);
});

test('format-only change is modified', () => {
  const r = diffMarkdown('the package now', 'the **package** now', T);
  expect(st(r)).toEqual(['modified']);
  expect(r.blocks[0].inline!.some(s => s.oldFmt)).toBe(true);
});

test('table cell edit', () => {
  const r = diffMarkdown('| a | b |\n|---|---|\n| c | d |', '| a | b |\n|---|---|\n| c | e |', T);
  expect(st(r)).toEqual(['modified']);
  expect(r.blocks[0].table![1].op).toBe('pair');
  expect(r.blocks[0].table![1].cells[1].segs.map(s => s.op)).toEqual(['delete', 'insert']);
});

test('table added column', () => {
  const r = diffMarkdown('| a |\n|---|\n| c |', '| a | b |\n|---|---|\n| c | d |', T);
  expect(r.blocks[0].table![0].cells[1].op).toBe('insert');
});

test('list item edit and reorder', () => {
  const r = diffMarkdown('- alpha one\n- beta two\n- gamma three', '- beta two\n- alpha one changed\n- gamma three', T);
  expect(r.blocks.filter(b => b.status === 'unchanged').length).toBe(2);
  expect(r.blocks.some(b => b.status === 'deleted') && r.blocks.some(b => b.status === 'inserted')).toBe(true);
});

test('code block line edit', () => {
  const r = diffMarkdown('```\na = 1\nb = 2\n```', '```\na = 1\nb = 3\n```', T);
  expect(r.blocks[0].code!.map(l => l.op)).toEqual(['equal', 'modified']);
});

test('heading level change marker', () => {
  expect(diffMarkdown('## Title', '### Title', T).blocks[0]).toMatchObject({ status: 'modified', markers: ['heading 2 → 3'] });
});

test('paragraph became list item', () => {
  expect(diffMarkdown('do the thing now', '- do the thing now', T).blocks[0]).toMatchObject({ status: 'modified', markers: ['became list item'] });
});

test('renumbering is unchanged', () => {
  expect(st(diffMarkdown('1. a\n2. b', '3. a\n4. b', T))).toEqual(['unchanged', 'unchanged']);
});

test('empty old file -> all inserted', () => {
  expect(st(diffMarkdown('', 'a\n\nb', T))).toEqual(['inserted', 'inserted']);
});

test('ids are sequential', () => {
  expect(diffMarkdown('a\n\nb x y', 'a\n\nc x y', T).blocks.map(b => b.id)).toEqual([0, 1]);
});

test('perf: 5000-line drastic rewrite under 1s', () => {
  const [a, b] = bigPair();
  const t = performance.now();
  diffMarkdown(a, b, T);
  expect(performance.now() - t).toBeLessThan(1000);
});

test('task checkbox toggle is a change', () => {
  const r = diffMarkdown('- [ ] ship it', '- [x] ship it', T);
  expect(r.blocks[0]).toMatchObject({ status: 'modified', markers: ['checked'] });
});
