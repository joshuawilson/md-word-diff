import { expect, test } from 'vitest';
import { parseBlocks } from '../src/engine/parse';
import { refOf, resolvePairs, type SavedPair } from '../src/engine/anchors';

const A = 'The triage step turns a request into a ticket with an owner and a priority.';
const B = 'Specs are written before any code so reviewers know what done looks like.';
const C = 'Every agent reads the spec and the standards before it writes a single line.';

function save(oldMd: string, newMd: string, pairs: [number, number][]): SavedPair[] {
  const ob = parseBlocks(oldMd);
  const nb = parseBlocks(newMd);
  return pairs.map(([i, j]) => ({ old: refOf(ob, i), new: refOf(nb, j) }));
}

test('pair survives a block inserted above it', () => {
  const old = `${A}\n\n${B}`;
  const neu = `${B}\n\n${A}`;
  const saved = save(old, neu, [[0, 1]]);
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(`# New heading\n\n${C}\n\n${neu}`));
  expect(r.pairs).toEqual([[0, 3]]);
  expect(r.lost).toBe(0);
});

test('pair follows the new block after it is edited', () => {
  const old = `${A}\n\n${B}`;
  const neu = `${B}\n\n${A}`;
  const saved = save(old, neu, [[0, 1]]);
  const edited = `${B}\n\nThe triage step turns a raw request into a ticket with one owner and a priority.`;
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(edited));
  expect(r.pairs).toEqual([[0, 1]]);
  // The saved copy is refreshed to the edited text, so later edits compare against it.
  expect(r.saved[0].new.text).toContain('raw request');
});

test('many small edits in a row keep the pair because the saved text is refreshed', () => {
  const old = `${A}\n\n${B}`;
  let neu = `${B}\n\n${A}`;
  let saved = save(old, neu, [[0, 1]]);
  const steps = [
    'The triage step turns each request into a ticket with an owner and a priority.',
    'Triage turns each incoming request into a ticket with an owner and a priority.',
    'Triage turns each incoming request into a tracked ticket with an owner and a deadline.',
    'Triage turns each incoming request into a tracked ticket with one owner, a deadline and labels.',
    'Triage converts every incoming support message into a tracked ticket with one owner, a deadline and labels.',
    'Intake converts every incoming support message into a tracked work item with one owner, a deadline and labels.',
  ];
  const first = saved;
  for (const s of steps) {
    neu = `${B}\n\n${s}`;
    const r = resolvePairs(saved, parseBlocks(old), parseBlocks(neu));
    expect(r.pairs).toEqual([[0, 1]]);
    saved = r.saved;
  }
  // Without refreshing, the final text is too far from the original to be found.
  expect(resolvePairs(first, parseBlocks(old), parseBlocks(neu)).lost).toBe(1);
});

test('pair is reported lost when the new block is rewritten beyond recognition, but kept in storage', () => {
  const old = `${A}\n\n${B}`;
  const neu = `${B}\n\n${A}`;
  const saved = save(old, neu, [[0, 1]]);
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(`${B}\n\nCompletely unrelated sentence about weather patterns.`));
  expect(r.pairs).toEqual([]);
  expect(r.lost).toBe(1);
  expect(r.saved).toEqual(saved);
});

test('lost pair comes back when the text returns (undo)', () => {
  const old = `${A}\n\n${B}`;
  const neu = `${B}\n\n${A}`;
  const saved = save(old, neu, [[0, 1]]);
  const gone = resolvePairs(saved, parseBlocks(old), parseBlocks(B));
  const back = resolvePairs(gone.saved, parseBlocks(old), parseBlocks(neu));
  expect(back.pairs).toEqual([[0, 1]]);
});

test('duplicate blocks resolve by occurrence', () => {
  const old = `${A}\n\n${C}\n\n${A}`;
  const neu = `${A}\n\n${C}\n\n${A}`;
  const saved = save(old, neu, [[2, 0]]);
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(neu));
  expect(r.pairs).toEqual([[2, 0]]);
});

test('exact matches are claimed before fuzzy ones', () => {
  const A2 = 'The triage step turns a request into a ticket with an owner and a due date.';
  const old = `${A}\n\n${B}`;
  const neu = `${A2}\n\n${A}`;
  // Pair 1: old B <-> new A (exact text). Pair 0: old A <-> new A2.
  const saved = save(old, neu, [[0, 0], [1, 1]]);
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(neu));
  expect(r.pairs.sort()).toEqual([[0, 0], [1, 1]]);
});

test('old block that no longer exists is lost', () => {
  const saved = save(`${A}\n\n${B}`, `${B}\n\n${A}`, [[0, 1]]);
  const r = resolvePairs(saved, parseBlocks(C), parseBlocks(`${B}\n\n${A}`));
  expect(r.pairs).toEqual([]);
  expect(r.lost).toBe(1);
});

test('fuzzy match stays within the same kind of block', () => {
  const old = `${A}\n\n${B}`;
  const neu = `${B}\n\n${A}`;
  const saved = save(old, neu, [[0, 1]]);
  const r = resolvePairs(saved, parseBlocks(old), parseBlocks(`${B}\n\n| ${A} |\n| --- |`));
  expect(r.pairs).toEqual([]);
});

test('saved manual pair is applied by the diff after the working copy changes', async () => {
  const { diffMarkdown } = await import('../src/engine/diff');
  const old = `${A}\n\n${B}`;
  const neu = `${C}\n\n${B}`;
  const saved = save(old, neu, [[0, 0]]); // A paired by hand with the unrelated C
  const edited = `# Added heading\n\n${C.replace('single', 'one')}\n\n${B}`;
  const { pairs } = resolvePairs(saved, parseBlocks(old), parseBlocks(edited));
  const r = diffMarkdown(old, edited, { threshold: 0.35, forced: pairs });
  const forced = r.blocks.find(b => b.forced)!;
  expect(forced.old!.source).toBe(A);
  expect(forced.block.source).toContain('one line');
});
