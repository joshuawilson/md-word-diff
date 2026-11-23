import { expect, test } from 'vitest';
import { parseBlocks } from '../src/engine/parse';
import { describeFormat, diffInline, diffRaw, type InlineSeg } from '../src/engine/inlineDiff';

const toks = (md: string) => parseBlocks(md)[0].inline!;
const toksIW = (md: string) => parseBlocks(md, { ignoreWrap: true })[0].inline!;
const ins = (s: InlineSeg[]) => s.filter(x => x.op === 'insert').map(x => x.text).join('|');
const del = (s: InlineSeg[]) => s.filter(x => x.op === 'delete').map(x => x.text).join('|');

test('word edit', () => {
  const s = diffInline(toks('Install the old package and restart.'), toks('Install the new package and reload.'));
  expect(del(s)).toBe('old|restart');
  expect(ins(s)).toBe('new|reload');
});

test('punctuation only', () => {
  const s = diffInline(toks('the word, here'), toks('the word. here'));
  expect(del(s)).toBe(',');
  expect(ins(s)).toBe('.');
});

test('non-ascii word change marks only that word', () => {
  const s = diffInline(toks('un café naïve'), toks('un thé naïve'));
  expect(del(s)).toBe('café');
  expect(ins(s)).toBe('thé');
});

test('rewrap is no change when ignoring line wrap', () => {
  expect(diffInline(toksIW('a b\nc'), toksIW('a\nb c')).every(x => x.op === 'equal')).toBe(true);
});

test('rewrap is a change by default', () => {
  const s = diffInline(toks('a b\nc'), toks('a\nb c'));
  const changed = s.filter(x => x.op !== 'equal');
  expect(changed.length).toBeGreaterThan(0);
  expect(changed.some(x => x.text.includes('\n'))).toBe(true);
});

test('equal segments are merged', () => {
  expect(diffInline(toks('a b c'), toks('a b c'))).toEqual([{ op: 'equal', text: 'a b c', fmt: {} }]);
});

test('emphasis added is a format change, not a word change', () => {
  const s = diffInline(toks('the package now'), toks('the **package** now'));
  expect(ins(s)).toBe('');
  expect(del(s)).toBe('');
  const f = s.find(x => x.text === 'package')!;
  expect(f.fmt).toEqual({ strong: true });
  expect(f.oldFmt).toEqual({});
  expect(describeFormat(f.oldFmt!)).toBe('plain');
});

test('link url change', () => {
  const f = diffInline(toks('[docs](http://a)'), toks('[docs](http://b)')).find(x => x.text === 'docs')!;
  expect(describeFormat(f.oldFmt!)).toBe('link http://a');
});

test('describeFormat combines', () => {
  expect(describeFormat({ strong: true, emphasis: true })).toBe('bold, italic');
});

test('raw diff shows syntax', () => {
  const r = diffRaw('the package', 'the **package**');
  expect(r.filter(x => x.op === 'insert').map(x => x.text)).toEqual(['**', '**']);
});

test('raw diff: changed url is one token', () => {
  const r = diffRaw('[d](http://a)', '[d](http://b)');
  expect(r.filter(x => x.op === 'delete').map(x => x.text)).toEqual(['](http://a)']);
});

test('raw diff ignores rewrap when asked', () => {
  expect(diffRaw('a b\nc', 'a\nb c', { ignoreWrap: true }).every(x => x.op === 'equal')).toBe(true);
});

test('raw diff keeps line breaks by default', () => {
  expect(diffRaw('a b\nc', 'a\nb c').some(x => x.op !== 'equal')).toBe(true);
});
