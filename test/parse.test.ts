import { expect, test } from 'vitest';
import { parseBlocks } from '../src/engine/parse';

test('paragraph soft wraps collapse', () => {
  const [b] = parseBlocks('Hello\nbig   world.');
  expect(b.kind).toBe('paragraph');
  expect(b.inline!.map(t => t.text).join('')).toBe('Hello big world.');
  expect(b.key).toBe(parseBlocks('Hello big world.')[0].key);
});

test('tokens: words, spaces, punctuation, unicode', () => {
  const [b] = parseBlocks('Café, naïve.');
  expect(b.inline!.map(t => t.text)).toEqual(['Café', ',', ' ', 'naïve', '.']);
});

test('inline formatting', () => {
  const [b] = parseBlocks('a **b** `c d` [e](http://x) ![f](i.png)');
  const by = (s: string) => b.inline!.find(t => t.text === s)!.fmt;
  expect(by('b')).toEqual({ strong: true });
  expect(by('c d')).toEqual({ code: true });
  expect(by('e')).toEqual({ link: 'http://x' });
  expect(by('f')).toEqual({ image: 'i.png' });
});

test('list items carry container context and marker', () => {
  const bs = parseBlocks('3. one\n4. two\n   - [x] nested');
  expect(bs.map(b => b.containers.length)).toEqual([1, 1, 2]);
  expect(bs[0].containers[0]).toEqual({ kind: 'list', ordered: true, start: 3, depth: 1 });
  expect(bs[0].marker).toBe('3. ');
  expect(bs[2].checked).toBe(true);
  expect(bs[2].marker).toBe('- [x] ');
});

test('renumbering does not change key', () => {
  expect(parseBlocks('1. a\n2. b')[1].key).toBe(parseBlocks('5. a\n6. b')[1].key);
});

test('multi-paragraph list item: itemStart only on first', () => {
  expect(parseBlocks('- a\n\n  b').map(b => b.itemStart)).toEqual([true, false]);
});

test('quote continuation prefixes stripped', () => {
  const [b] = parseBlocks('> one\n> two');
  expect(b.containers).toEqual([{ kind: 'quote', depth: 1 }]);
  expect(b.source).toBe('one\ntwo');
});

test('heading, code, table, frontmatter, html, hr', () => {
  const md = '---\nt: 1\n---\n\n## H\n\n```js\nx\n```\n\n| a | b |\n|---|---|\n| c | d |\n\n<div>x</div>\n\n***';
  const bs = parseBlocks(md);
  expect(bs.map(b => b.kind)).toEqual(['frontmatter', 'heading', 'code', 'table', 'html', 'thematicBreak']);
  expect(bs[1].level).toBe(2);
  expect(bs[2]).toMatchObject({ lang: 'js', code: 'x' });
  expect(bs[3].rows!.length).toBe(2);
  expect(bs[3].rows![1][1].map(t => t.text)).toEqual(['d']);
});

test('CRLF equals LF', () => {
  expect(parseBlocks('a\r\nb\r\n\r\nc').map(b => b.key)).toEqual(parseBlocks('a\nb\n\nc').map(b => b.key));
});
