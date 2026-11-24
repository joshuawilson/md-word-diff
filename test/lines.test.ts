import { expect, test } from 'vitest';
import { parseBlocks } from '../src/engine/parse';
import { diffMarkdown } from '../src/engine/diff';
import { renderRendered } from '../src/render/rendered';
import { renderRaw } from '../src/render/raw';

test('blocks record the 1-based line they start on', () => {
  const md = '---\ntitle: x\n---\n\n# Head\n\nPara one\nwraps here.\n\n- item\n  - nested\n\n> quote\n\n```js\ncode\n```\n\n| a |\n| - |\n| b |\n';
  const lines = parseBlocks(md).map(b => [b.kind, b.line]);
  expect(lines).toEqual([
    ['frontmatter', 1],
    ['heading', 5],
    ['paragraph', 7],
    ['paragraph', 10],
    ['paragraph', 11],
    ['paragraph', 13],
    ['code', 15],
    ['table', 19],
  ]);
});

test('CRLF input gives the same line numbers', () => {
  expect(parseBlocks('a\r\n\r\nb\r\n').map(b => b.line)).toEqual([1, 3]);
});

test('gutter shows old and new line numbers in both views', () => {
  const old = 'Intro paragraph here.\n\nThe old sentence stays mostly the same.\n\nGone forever now.\n';
  const neu = '# Added\n\nIntro paragraph here.\n\nThe new sentence stays mostly the same.\n';
  const r = diffMarkdown(old, neu, { threshold: 0.35, grouping: 'off' });
  for (const h of [renderRendered(r), renderRaw(r)]) {
    expect(h).toContain('<span class="gut"><span class="go"></span><a class="gn" data-line="1" href="#">1</a></span>'); // inserted heading
    expect(h).toContain('<span class="gut"><span class="go">1</span><a class="gn" data-line="3" href="#">3</a></span>'); // unchanged
    expect(h).toContain('<span class="gut"><span class="go">3</span><a class="gn" data-line="5" href="#">5</a></span>'); // modified
    expect(h).toContain('<span class="gut"><span class="go">5</span><span class="gn"></span></span>'); // deleted
  }
});
