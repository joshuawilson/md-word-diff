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
  expect(st(diffMarkdown('keep\n\nzap zap zap', 'keep\n\nbrand new words', T))).toEqual(['unchanged', 'inserted', 'deleted']);
});

test('drastic rewrite pairs at 0.2 but not at 0.6', () => {
  const a = 'one two three four five six', b = 'one two nine ten eleven twelve';
  expect(st(diffMarkdown(a, b, { threshold: 0.2 }))).toEqual(['modified']);
  expect(st(diffMarkdown(a, b, { threshold: 0.6 }))).toEqual(['inserted', 'deleted']);
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
  expect(r.blocks[0].table![1].cells[1].segs.map(s => s.op)).toEqual(['insert', 'delete']);
});

test('table added column', () => {
  const r = diffMarkdown('| a |\n|---|\n| c |', '| a | b |\n|---|---|\n| c | d |', T);
  expect(r.blocks[0].table![0].cells[1].op).toBe('insert');
});

test('list item edit and reorder', () => {
  const r = diffMarkdown('- alpha one\n- beta two\n- gamma three', '- beta two\n- alpha one changed\n- gamma three', T);
  expect(r.blocks.filter(b => b.status === 'unchanged').length).toBe(2);
  // The edited item moved: shown as a move (stub + modified block), not delete + insert.
  expect(r.blocks.some(b => b.status === 'movedAway')).toBe(true);
  expect(r.blocks.find(b => b.block.source.includes('changed'))!.markers).toContain('moved from above');
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

test('code language change has a marker', () => {
  expect(diffMarkdown('```js\nx\n```', '```ts\nx\n```', T).blocks[0].markers).toEqual(['language js → ts']);
});

test('quote depth change has a marker', () => {
  expect(diffMarkdown('> a b c', '> > a b c', T).blocks[0].markers).toEqual(['quote depth 1 → 2']);
});

test('list type change has a marker', () => {
  expect(diffMarkdown('- a b c', '1. a b c', T).blocks[0].markers).toEqual(['became numbered list']);
  expect(diffMarkdown('1. a b c', '- a b c', T).blocks[0].markers).toEqual(['became bullet list']);
});

test('perf: fully rewritten 2000-line code block under 1s', () => {
  const a = Array.from({ length: 2000 }, (_, i) => `const a${i} = compute(${i});`).join('\n');
  const b = Array.from({ length: 2000 }, (_, i) => `let b${i} = other(${i * 3});`).join('\n');
  const t = performance.now();
  const r = diffMarkdown('```js\n' + a + '\n```', '```js\n' + b + '\n```', T);
  expect(performance.now() - t).toBeLessThan(1000);
  expect(r.blocks.length).toBeGreaterThan(0);
});

test('perf: 30k-word paragraph with a third replaced under 1s', () => {
  const words = Array.from({ length: 30000 }, (_, i) => `w${i % 997}x${Math.floor(i / 997)}`);
  const b = words.map((w, i) => (i % 3 === 0 ? `z${i}` : w));
  const t = performance.now();
  const r = diffMarkdown(words.join(' '), b.join(' '), { threshold: 0.2 });
  expect(performance.now() - t).toBeLessThan(1000);
  expect(r.blocks.length).toBeGreaterThan(0);
});

test('perf: 3000-row table all edited under 1s', () => {
  const rows = (tag: string) => Array.from({ length: 3000 }, (_, i) => `| r${i} | ${tag}${i} |`).join('\n');
  const t = performance.now();
  diffMarkdown('| k | v |\n|---|---|\n' + rows('a'), '| k | v |\n|---|---|\n' + rows('b'), T);
  expect(performance.now() - t).toBeLessThan(1000);
});

test('a short block moving across an edited paragraph does not block pairing', () => {
  const old = 'Intro text here.\n\nalpha beta gamma delta epsilon zeta eta theta\n\n![Fig](f.png)';
  const neu = 'Intro text here.\n\n![Fig](f.png)\n\nalpha beta gamma delta epsilon zeta iota kappa';
  const r = diffMarkdown(old, neu, T);
  const para = r.blocks.find(b => b.block.source.startsWith('alpha'))!;
  expect(para.status).toBe('modified');
  // The image itself is shown as moved.
  expect(r.blocks.filter(b => b.block.source.startsWith('![Fig]')).map(b => b.status).sort()).toEqual(['modified', 'movedAway']);
});

test('long identical blocks still anchor', () => {
  const long = 'This unchanged paragraph has plenty of words so it anchors the alignment firmly.';
  const r = diffMarkdown(`${long}\n\none two three four`, `${long}\n\none two three five`, T);
  expect(r.blocks.map(b => b.status)).toEqual(['unchanged', 'modified']);
});
