import { IS_WORD } from './inline';

export type WordBag = { counts: Map<string, number>; size: number };

export function wordBag(words: string[]): WordBag {
  const counts = new Map<string, number>();
  let size = 0;
  for (const w of words) {
    if (!IS_WORD.test(w)) continue;
    const k = w.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
    size++;
  }
  return { counts, size };
}

/** Dice coefficient over word multisets; both empty -> 1. */
export function bagSimilarity(a: WordBag, b: WordBag): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let common = 0;
  for (const [k, n] of small.counts) {
    const m = big.counts.get(k);
    if (m) common += Math.min(n, m);
  }
  return (2 * common) / (a.size + b.size);
}

/** Dice over lowercased word multisets (punctuation & spaces ignored); both empty -> 1. */
export function similarity(a: string[], b: string[]): number {
  return bagSimilarity(wordBag(a), wordBag(b));
}
