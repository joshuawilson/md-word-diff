import { IS_WORD } from './inline';

/** Sorted word ids (with multiplicity) for fast multiset intersection. */
export type WordBag = Int32Array;

const ids = new Map<string, number>();

function wordId(w: string): number {
  let id = ids.get(w);
  if (id === undefined) {
    id = ids.size;
    ids.set(w, id);
  }
  return id;
}

export function wordBag(words: string[]): WordBag {
  const out: number[] = [];
  for (const w of words) if (IS_WORD.test(w)) out.push(wordId(w.toLowerCase()));
  return Int32Array.from(out).sort();
}

/** Dice coefficient over word multisets; both empty -> 1. */
export function bagSimilarity(a: WordBag, b: WordBag): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      common++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return (2 * common) / (a.length + b.length);
}

/** Dice over lowercased word multisets (punctuation & spaces ignored); both empty -> 1. */
export function similarity(a: string[], b: string[]): number {
  return bagSimilarity(wordBag(a), wordBag(b));
}
