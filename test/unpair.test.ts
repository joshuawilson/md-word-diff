import { expect, test } from 'vitest';
import { diffMarkdown } from '../src/engine/diff';
import { renderRendered } from '../src/render/rendered';
import { renderRaw } from '../src/render/raw';
import { bigPair } from './fixtures/big';

const T = { threshold: 0.35, grouping: 'off' as const };
const A = 'Anchor paragraph with plenty of words so it holds the alignment in place.';
const OLD = `${A}\n\nthe quick brown fox jumps over the lazy dog\n\nother old words entirely`;
const NEW = `${A}\n\nthe quick red fox jumps over the lazy cat\n\ndifferent new text here`;

test('automatic pair can be unpaired into delete + insert', () => {
  const before = diffMarkdown(OLD, NEW, T);
  expect(before.blocks[1].status).toBe('modified');
  const r = diffMarkdown(OLD, NEW, { ...T, unpaired: [[1, 1]] });
  const st = r.blocks.filter(b => b.block.source.startsWith('the quick')).map(b => b.status).sort();
  expect(st).toEqual(['deleted', 'inserted']);
});

test('unpaired blocks are not re-matched to other blocks', () => {
  const old = `${A}\n\nalpha beta gamma delta\n\nalpha beta gamma zeta`;
  const neu = `${A}\n\nalpha beta gamma epsilon`;
  // Unpairing old 1 / new 1 keeps both out of automatic matching, so old 2 can't take new 1.
  const r = diffMarkdown(old, neu, { ...T, unpaired: [[1, 1]] });
  expect(r.blocks.some(b => b.status === 'modified' || b.status === 'movedAway')).toBe(false);
});

test('unpairing a move removes the stub', () => {
  const P = 'Consider the webhook request from the opening scenario entering through support today.';
  const P2 = 'Consider the webhook request from the opening story entering through the portal today.';
  const F = 'Figure caption text that is long enough to anchor the alignment on its own here.';
  const before = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P2}`, T);
  expect(before.blocks.some(b => b.status === 'movedAway')).toBe(true);
  const r = diffMarkdown(`${P}\n\n${F}`, `${F}\n\n${P2}`, { ...T, unpaired: [[0, 1]] });
  expect(r.blocks.some(b => b.status === 'movedAway')).toBe(false);
  expect(r.blocks.map(b => b.status).sort()).toEqual(['deleted', 'inserted', 'unchanged']);
});

test('a manual pair wins over an unpair of the same blocks', () => {
  const r = diffMarkdown(OLD, NEW, { ...T, unpaired: [[1, 1]], forced: [[1, 1]] });
  expect(r.blocks.find(b => b.forced)?.old?.index).toBe(1);
});

test('unpair works in the large-document fallback path', () => {
  const [a, b] = bigPair();
  const base = diffMarkdown(a, b, T);
  const m = base.blocks.find(x => x.status === 'modified')!;
  const r = diffMarkdown(a, b, { ...T, unpaired: [[m.old!.index, m.block.index]] });
  const statuses = r.blocks.filter(x => x.block.index === m.block.index || x.block.index === m.old!.index).filter(x => x.block.source === m.block.source || x.block.source === m.old!.source).map(x => x.status).sort();
  expect(statuses).toEqual(['deleted', 'inserted']);
});

test('automatic pairs render an Unpair button; manual pairs keep theirs', () => {
  for (const h of [renderRendered(diffMarkdown(OLD, NEW, T)), renderRaw(diffMarkdown(OLD, NEW, T))]) {
    expect(h).toContain('class="split-btn" data-oi="1" data-ni="1"');
    expect(h).toContain('class="pair-btn" data-oi="1"');
  }
  const forced = renderRendered(diffMarkdown(OLD, NEW, { ...T, forced: [[1, 1]] }));
  expect(forced).toContain('class="unpair-btn" data-oi="1"');
  expect(forced).not.toContain('split-btn');
});
