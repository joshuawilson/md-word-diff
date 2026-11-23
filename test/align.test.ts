import { expect, test } from 'vitest';
import { similarity } from '../src/engine/similarity';
import { align } from '../src/engine/align';

const S = (s: string) => ({ s });
const opts = { key: (x: { s: string }) => x.s, words: (x: { s: string }) => x.s.split(' '), compatible: () => true, threshold: 0.35 };
const ops = (r: { op: string }[]) => r.map(o => o.op);

test('similarity', () => {
  expect(similarity(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'e'])).toBeCloseTo(0.75);
  expect(similarity([], [])).toBe(1);
});

test('exact anchors', () => {
  expect(ops(align(['x', 'y'].map(S), ['x', 'y'].map(S), opts))).toEqual(['equal', 'equal']);
});

test('edited block pairs', () => {
  expect(ops(align([S('the quick brown fox')], [S('the quick red fox')], opts))).toEqual(['pair']);
});

test('below threshold -> delete + insert', () => {
  expect(ops(align([S('a b c d')], [S('w x y z')], opts))).toEqual(['delete', 'insert']);
});

test('threshold changes outcome', () => {
  const a = [S('one two three four five six')], b = [S('one two nine ten eleven twelve')];
  expect(ops(align(a, b, { ...opts, threshold: 0.2 }))).toEqual(['pair']);
  expect(ops(align(a, b, { ...opts, threshold: 0.6 }))).toEqual(['delete', 'insert']);
});

test('pairs never cross: reorder is delete + insert', () => {
  const a = ['p q r s', 'k l m n'].map(S), b = ['k l m n x', 'p q r s x'].map(S);
  const r = align(a, b, opts);
  expect(r.filter(o => o.op === 'pair').length).toBe(1);
  expect(r.filter(o => o.op === 'delete').length).toBe(1);
  expect(r.filter(o => o.op === 'insert').length).toBe(1);
});

test('incompatible never pair', () => {
  expect(ops(align([S('a b c')], [S('a b d')], { ...opts, compatible: () => false }))).toEqual(['delete', 'insert']);
});

test('large gap uses fallback and stays fast', () => {
  const a = Array.from({ length: 1500 }, (_, i) => S(`old ${i} alpha beta gamma`));
  const b = Array.from({ length: 1500 }, (_, i) => S(`new ${i} alpha beta delta`));
  const t = performance.now();
  const r = align(a, b, opts);
  expect(performance.now() - t).toBeLessThan(500);
  expect(r.filter(o => o.op === 'pair').length).toBeGreaterThan(1000);
});
