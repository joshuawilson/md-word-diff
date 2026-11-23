import { pairGroup } from './diff';
import { bagSimilarity, wordBag, type WordBag } from './similarity';
import type { Block } from './types';

/**
 * A block identified by its text rather than its position, so a saved pairing survives
 * blocks being added or removed around it. `nth` tells identical blocks apart.
 */
export interface BlockRef {
  text: string;
  nth: number;
}

export interface SavedPair {
  old: BlockRef;
  new: BlockRef;
}

export interface Resolved {
  /** Pairs that were found, as [old block index, new block index]. */
  pairs: [number, number][];
  /** What to store next: found pairs refreshed to the current new text; lost ones unchanged. */
  saved: SavedPair[];
  /** Saved pairs that could not be found in the current text. */
  lost: number;
}

/** An edited new block must share at least this much of its words with the last saved text. */
export const FOLLOW_THRESHOLD = 0.5;

export function refOf(blocks: Block[], i: number): BlockRef {
  const text = blocks[i].source;
  let nth = 0;
  for (let k = 0; k < i; k++) if (blocks[k].source === text) nth++;
  return { text, nth };
}

function bagOf(text: string): WordBag {
  return wordBag(text.split(/[^\p{L}\p{N}]+/u));
}

/** Index of the nth block with this exact text, or of the first unused one, or -1. */
function exact(blocks: Block[], ref: BlockRef, used?: Set<number>): number {
  const hits: number[] = [];
  blocks.forEach((b, i) => {
    if (b.source === ref.text && !used?.has(i)) hits.push(i);
  });
  if (!hits.length) return -1;
  const byNth = blocks.findIndex((b, i) => b.source === ref.text && refOf(blocks, i).nth === ref.nth);
  return byNth >= 0 && hits.includes(byNth) ? byNth : hits[0];
}

/**
 * Find saved pairs in the current blocks. The old side is matched by exact text (it comes from a
 * fixed revision). The new side is matched by exact text first; failing that, by the unused block
 * of the same kind most similar to the last saved text (at least FOLLOW_THRESHOLD).
 */
export function resolvePairs(saved: SavedPair[], oldBlocks: Block[], newBlocks: Block[]): Resolved {
  const oi = saved.map(p => exact(oldBlocks, p.old));
  const ni: number[] = saved.map(() => -1);
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  saved.forEach((p, k) => {
    if (oi[k] < 0 || usedOld.has(oi[k])) return;
    const j = exact(newBlocks, p.new, usedNew);
    if (j >= 0) {
      ni[k] = j;
      usedOld.add(oi[k]);
      usedNew.add(j);
    }
  });
  saved.forEach((p, k) => {
    if (oi[k] < 0 || ni[k] >= 0 || usedOld.has(oi[k])) return;
    const group = pairGroup(oldBlocks[oi[k]].kind);
    const want = bagOf(p.new.text);
    let best = -1;
    let bestSim = FOLLOW_THRESHOLD;
    newBlocks.forEach((b, j) => {
      if (usedNew.has(j) || pairGroup(b.kind) !== group) return;
      const s = bagSimilarity(want, bagOf(b.source));
      if (s > bestSim || (best < 0 && s >= bestSim)) {
        bestSim = s;
        best = j;
      }
    });
    if (best >= 0) {
      ni[k] = best;
      usedOld.add(oi[k]);
      usedNew.add(best);
    }
  });
  const pairs: [number, number][] = [];
  let lost = 0;
  const next = saved.map((p, k): SavedPair => {
    if (ni[k] < 0) {
      lost++;
      return p;
    }
    pairs.push([oi[k], ni[k]]);
    return { old: refOf(oldBlocks, oi[k]), new: refOf(newBlocks, ni[k]) };
  });
  return { pairs, saved: next, lost };
}
