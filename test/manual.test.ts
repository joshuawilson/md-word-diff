import { expect, test } from 'vitest';
import { diffMarkdown } from '../src/engine/diff';
import { renderRendered } from '../src/render/rendered';
import { renderRaw } from '../src/render/raw';

const T = { threshold: 0.35, grouping: 'off' as const };
const OLD = 'Shared heading line that anchors everything in place nicely.\n\nConsider the same webhook request entering through support.\n\nUnrelated old closing text.';
const NEW = 'Shared heading line that anchors everything in place nicely.\n\nWith a process the customer files an RFE in Jira.\n\nUnrelated old closing text.';

test('blocks carry their index in the parsed document', () => {
  const r = diffMarkdown(OLD, NEW, T);
  const del = r.blocks.find(b => b.status === 'deleted')!;
  const ins = r.blocks.find(b => b.status === 'inserted')!;
  expect(del.block.index).toBe(1);
  expect(ins.block.index).toBe(1);
});

test('forced pair is diffed even below the threshold and labelled', () => {
  const r = diffMarkdown(OLD, NEW, { ...T, forced: [[1, 1]] });
  const b = r.blocks.find(x => x.block.source.startsWith('With a process'))!;
  expect(b.status).toBe('modified');
  expect(b.old!.source.startsWith('Consider')).toBe(true);
  expect(b.markers).toContain('paired manually');
  expect(b.forced).toBe(true);
  expect(r.blocks.some(x => x.status === 'deleted' || x.status === 'inserted')).toBe(false);
});

test('forcing releases the previous partner', () => {
  const old = 'alpha beta gamma delta\n\nzeta eta theta iota';
  const neu = 'alpha beta gamma epsilon\n\nkappa lambda mu nu';
  // Normally old 0 pairs with new 0; force old 1 -> new 0 instead.
  const r = diffMarkdown(old, neu, { ...T, forced: [[1, 0]] });
  const forced = r.blocks.find(b => b.forced)!;
  expect(forced.old!.index).toBe(1);
  expect(forced.block.index).toBe(0);
  expect(r.blocks.find(b => b.block.source.startsWith('alpha') && b.status !== 'modified')).toBeTruthy();
});

test('forced pair out of order becomes a move', () => {
  const old = 'first old paragraph here\n\nShared middle paragraph with plenty of words to anchor things.\n\nlast';
  const neu = 'other\n\nShared middle paragraph with plenty of words to anchor things.\n\nrewritten first paragraph totally';
  const r = diffMarkdown(old, neu, { ...T, forced: [[0, 2]] });
  const forced = r.blocks.find(b => b.forced)!;
  expect(forced.markers).toEqual(expect.arrayContaining(['paired manually', 'moved from above']));
  expect(r.blocks.some(b => b.status === 'movedAway' && b.movedTo === forced.id)).toBe(true);
});

test('invalid and incompatible forced pairs are ignored', () => {
  const r1 = diffMarkdown(OLD, NEW, { ...T, forced: [[9, 1], [1, 9]] });
  expect(r1.blocks.some(b => b.forced)).toBe(false);
  const r2 = diffMarkdown('text para here\n\n```\ncode\n```', '```\nother\n```\n\nmore text', { ...T, forced: [[0, 0]] });
  expect(r2.blocks.some(b => b.forced)).toBe(false);
});

test('rendered and raw expose pairing hooks', () => {
  const r = diffMarkdown(OLD, NEW, T);
  for (const h of [renderRendered(r), renderRaw(r)]) {
    expect(h).toMatch(/class="blk deleted chg"[^>]*data-oi="1"/);
    expect(h).toMatch(/class="blk inserted chg"[^>]*data-ni="1"/);
    expect(h).toContain('class="pair-btn"');
    expect(h).toMatch(/data-family="text"/);
  }
  const forced = renderRendered(diffMarkdown(OLD, NEW, { ...T, forced: [[1, 1]] }));
  expect(forced).toContain('class="unpair-btn" data-oi="1"');
});
