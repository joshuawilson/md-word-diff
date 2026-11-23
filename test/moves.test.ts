import { expect, test } from 'vitest';
import { diffMarkdown } from '../src/engine/diff';
import { renderRendered } from '../src/render/rendered';
import { renderRaw } from '../src/render/raw';

const T = { threshold: 0.3, grouping: 'off' as const };
const P = 'Consider the webhook request from the opening scenario entering through support today.';
const P2 = 'Consider the webhook request from the opening story entering through the portal today.';
const F = 'Figure caption text that is long enough to anchor the alignment on its own here.';

test('edited paragraph that moved across another block is paired as a move', () => {
  const r = diffMarkdown(`Intro.\n\n${P}\n\n${F}`, `Intro.\n\n${F}\n\n${P2}`, T);
  const moved = r.blocks.find(b => b.block.source === P2)!;
  expect(moved.status).toBe('modified');
  expect(moved.markers).toContain('moved from above');
  expect(moved.inline!.some(s => s.op === 'insert' && s.text.includes('story'))).toBe(true);
  const stub = r.blocks.find(b => b.status === 'movedAway')!;
  expect(stub.movedTo).toBe(moved.id);
  expect(moved.movedFrom).toBe(stub.id);
  expect(r.blocks.indexOf(stub)).toBeLessThan(r.blocks.indexOf(moved));
  expect(r.blocks.some(b => b.status === 'deleted' || b.status === 'inserted')).toBe(false);
});

test('unchanged paragraph moved down shows as moved with no word marks', () => {
  const r = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P}`, T);
  // Either block may be the one reported as moved; it carries no word marks.
  const moved = r.blocks.find(b => b.status === 'modified')!;
  expect(moved.markers.length).toBe(1);
  expect(moved.markers[0]).toMatch(/^moved from (above|below)$/);
  expect(moved.inline!.every(s => s.op === 'equal')).toBe(true);
});

test('moved up gets the opposite labels', () => {
  const r = diffMarkdown(`${F}\n\n${P}`, `${P2}\n\n${F}`, T);
  const moved = r.blocks.find(b => b.markers.includes('moved from below'))!;
  expect(moved).toBeTruthy();
  expect(r.blocks.indexOf(r.blocks.find(b => b.status === 'movedAway')!)).toBeGreaterThan(r.blocks.indexOf(moved));
});

test('a move counts as one change and only its real word edits', () => {
  const r = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P}`, T);
  expect(r.stats).toEqual({ changes: 1, wordsAdded: 0, wordsRemoved: 0 });
});

test('dissimilar leftovers are not paired as moves', () => {
  const r = diffMarkdown(`alpha beta gamma delta\n\n${F}`, `${F}\n\nwholly different words here`, T);
  expect(r.blocks.map(b => b.status).sort()).toEqual(['deleted', 'inserted', 'unchanged']);
});

test('move picks the candidate sharing the most words', () => {
  const old = `${P}\n\n${F}`;
  const neu = `${F}\n\nConsider the webhook request today.\n\n${P2}`;
  const r = diffMarkdown(old, neu, T);
  expect(r.blocks.find(b => b.block.source === P2)!.status).toBe('modified');
});

test('stub renders as a jump link in both views', () => {
  const r = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P2}`, T);
  const target = r.blocks.find(b => b.block.source === P2)!.id;
  for (const h of [renderRendered(r), renderRaw(r)]) {
    expect(h).toContain(`class="move-link" data-target="${target}"`);
    expect(h).toContain('↓ moved below');
    expect(h).toContain('class="blk movedAway"');
  }
});

test('stub keeps the old text, struck through, so it can be read and paired', () => {
  const r = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P2}`, T);
  const stub = r.blocks.find(b => b.status === 'movedAway')!;
  expect(stub.inline!.length).toBeGreaterThan(0);
  expect(stub.inline!.every(s => s.op === 'delete')).toBe(true);
  // Stub words are not counted again as removed: only the edit inside the moved block counts.
  expect(r.stats.wordsRemoved).toBe(2);
  const first = P.split(' ')[0];
  for (const h of [renderRendered(r), renderRaw(r)]) {
    const stubHtml = h.slice(h.indexOf('class="blk movedAway"'));
    const end = stubHtml.indexOf('</div>');
    expect(stubHtml.slice(0, end)).toContain('<del>');
    expect(stubHtml.slice(0, end)).toContain(first);
    expect(stubHtml.slice(0, end)).toContain('class="pair-btn"');
  }
});
