import { expect, test } from 'vitest';
import { diffMarkdown } from '../src/engine/diff';
import { groupSegs } from '../src/engine/group';
import type { InlineSeg } from '../src/engine/inlineDiff';

const OLD = 'The quick brown fox jumps over the lazy dog';
const NEW = 'The slow red fox leaps over the sleepy dog';
const show = (segs: { op: string; text: string }[]) =>
  segs.map(s => (s.op === 'insert' ? `[+${s.text}]` : s.op === 'delete' ? `[-${s.text}]` : s.text)).join('');
const inline = (group: 'off' | '1' | '2') => show(diffMarkdown(OLD, NEW, { threshold: 0.2, grouping: group }).blocks[0].inline!);

test('off: word by word, new first', () => {
  expect(inline('off')).toBe('The [+slow][-quick] [+red][-brown] fox [+leaps][-jumps] over the [+sleepy][-lazy] dog');
});

test('1 word: absorbs single unchanged words and spaces', () => {
  expect(inline('1')).toBe('The [+slow red fox leaps][-quick brown fox jumps] over the [+sleepy][-lazy] dog');
});

test('2 words: absorbs up to two unchanged words', () => {
  expect(inline('2')).toBe('The [+slow red fox leaps over the sleepy][-quick brown fox jumps over the lazy] dog');
});

test('stats count real word changes, not absorbed words', () => {
  expect(diffMarkdown(OLD, NEW, { threshold: 0.2, grouping: '2' }).stats).toMatchObject({ wordsAdded: 4, wordsRemoved: 4 });
});

test('unchanged text at block edges is never absorbed', () => {
  const segs: InlineSeg[] = [
    { op: 'equal', text: 'a ', fmt: {} },
    { op: 'delete', text: 'b', fmt: {} },
    { op: 'equal', text: ' c', fmt: {} },
  ];
  expect(show(groupSegs(segs, 2))).toBe('a [-b] c');
});

test('format-changed stretch is not absorbed', () => {
  const segs: InlineSeg[] = [
    { op: 'delete', text: 'x', fmt: {} },
    { op: 'equal', text: 'y', fmt: { strong: true }, oldFmt: {} },
    { op: 'insert', text: 'z', fmt: {} },
  ];
  const out = groupSegs(segs, 2);
  expect(out.find(s => s.op === 'equal')?.oldFmt).toEqual({});
});

test('default grouping is 1 word', () => {
  expect(show(diffMarkdown(OLD, NEW, { threshold: 0.2 }).blocks[0].inline!)).toBe(inline('1'));
});

test('raw view grouped and new first', () => {
  const raw = show(diffMarkdown(OLD, NEW, { threshold: 0.2, grouping: '1' }).blocks[0].raw);
  expect(raw).toBe('The [+slow red fox leaps][-quick brown fox jumps] over the [+sleepy][-lazy] dog');
});

test('table cell grouped new first', () => {
  const r = diffMarkdown('| a |\n|---|\n| one two three |', '| a |\n|---|\n| uno two tres |', { threshold: 0.2, grouping: '1' });
  expect(show(r.blocks[0].table![1].cells[0].segs)).toBe('[+uno two tres][-one two three]');
});

test('code line grouped new first', () => {
  const r = diffMarkdown('```\nlet a = 1;\n```', '```\nconst a = 2;\n```', { threshold: 0.2, grouping: '1' });
  expect(show(r.blocks[0].code![0].segs)).toBe('[+const a = 2][-let a = 1];');
});

test('whole blocks: inserted before deleted', () => {
  expect(diffMarkdown('keep\n\nzap zap zap', 'keep\n\nbrand new words', { threshold: 0.35 }).blocks.map(b => b.status)).toEqual([
    'unchanged',
    'inserted',
    'deleted',
  ]);
});

test('code lines: extra inserted lines before extra deleted lines', () => {
  const r = diffMarkdown('```\nkeep\nold1\nold2\n```', '```\nkeep\nnew1\n```', { threshold: 0.35, grouping: 'off' });
  expect(r.blocks[0].code!.map(l => l.op)).toEqual(['equal', 'modified', 'delete']);
});
