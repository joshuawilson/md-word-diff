import { expect, test } from 'vitest';
import { diffMarkdown } from '../src/engine/diff';
import { renderRendered } from '../src/render/rendered';
import { renderRaw } from '../src/render/raw';
import { escapeHtml } from '../src/render/escape';
import { bigPair } from './fixtures/big';

const R = (a: string, b: string) => diffMarkdown(a, b, { threshold: 0.35 });

test('escapeHtml', () => {
  expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('ins/del marks', () => {
  const h = renderRendered(R('the old pkg', 'the new pkg'));
  expect(h).toContain('<del>old</del>');
  expect(h).toContain('<ins>new</ins>');
  expect(h).toContain('class="blk modified chg"');
});

test('format change marker', () => {
  expect(renderRendered(R('the package', 'the **package**'))).toContain(
    '<span class="fmt-changed" title="was: plain"><strong>package</strong></span>',
  );
});

test('block markers shown', () => {
  expect(renderRendered(R('## Title', '### Title'))).toContain('<span class="marker">heading 2 → 3</span>');
});

test('html in doc is escaped', () => {
  const h = renderRendered(R('', '<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>'));
  expect(h).not.toContain('<script>');
  expect(h).not.toContain('<img');
  expect(h).toContain('&lt;script&gt;');
  expect(renderRaw(R('', '<script>x</script>'))).not.toContain('<script>');
});

test('javascript: link href is neutralized', () => {
  expect(renderRendered(R('', '[x](javascript:alert(1))'))).not.toContain('href="javascript:');
});

test('lists rebuild real wrappers', () => {
  const h = renderRendered(R('', '3. a\n4. b'));
  expect(h).toMatch(/<ol start="3">[\s\S]*<li>[\s\S]*<li>[\s\S]*<\/ol>/);
});

test('blockquote wrapper', () => {
  expect(renderRendered(R('', '> quoted'))).toMatch(/<blockquote>[\s\S]*quoted[\s\S]*<\/blockquote>/);
});

test('table renders with cell marks', () => {
  const h = renderRendered(R('| a |\n|---|\n| c |', '| a |\n|---|\n| d |'));
  expect(h).toContain('<table');
  expect(h).toContain('<del>c</del>');
});

test('code lines', () => {
  const h = renderRendered(R('```\nx = 1\n```', '```\nx = 2\n```'));
  expect(h).toContain('<pre class="code">');
  expect(h).toContain('class="ln modified"');
});

test('raw shows syntax tokens (grouping off)', () => {
  expect(renderRaw(diffMarkdown('the package', 'the **package**', { threshold: 0.35, grouping: 'off' }))).toContain('<ins>**</ins>');
});

test('raw groups syntax change with its word (default grouping)', () => {
  expect(renderRaw(R('the package', 'the **package**'))).toContain('<ins>**package**</ins><del>package</del>');
});

test('raw shows list marker', () => {
  expect(renderRaw(R('', '- item'))).toContain('- ');
});

test('image not loaded', () => {
  expect(renderRendered(R('', '![cat](c.png)'))).not.toContain('<img');
});

test('perf: diff + both renders of 5000-line doc under 1s', () => {
  const [a, b] = bigPair();
  const t = performance.now();
  const r = diffMarkdown(a, b, { threshold: 0.35 });
  renderRendered(r);
  renderRaw(r);
  expect(performance.now() - t).toBeLessThan(1000);
});

test('task checkbox sits inside the item paragraph', () => {
  expect(renderRendered(R('- [x] ship it', '- [x] ship it'))).toContain('<p><input type="checkbox" disabled checked> ship it</p>');
});

test('line breaks render as <br> in the Rendered view', () => {
  expect(renderRendered(R('', 'one\\\ntwo'))).toContain('one<br>two');
  expect(renderRendered(R('', 'one\ntwo'))).toContain('one<br>two');
});
