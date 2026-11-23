import type { AlignOptions } from './align';
import { lcsRuns } from './lcs';
import { bagSimilarity, wordBag, type WordBag } from './similarity';

/** Ops for block alignment with moves. moveTo sits at the new position, moveFrom at the old one. */
export type MoveOp<T> =
  | { op: 'equal' | 'pair'; a: T; b: T; forced?: boolean }
  | { op: 'delete'; a: T }
  | { op: 'insert'; b: T }
  | { op: 'moveTo'; a: T; b: T; link: number; forced?: boolean }
  | { op: 'moveFrom'; a: T; link: number };

/** Identical runs with at least this many words anchor in place (same rule as align()). */
const STRONG_ANCHOR_WORDS = 8;
const MIN_WEIGHT = 0.5;
const ANCHOR_WEIGHT = 1e9;
const FORCED_WEIGHT = 1e6;

interface Match {
  i: number;
  j: number;
  w: number;
  anchor: boolean;
  forced?: boolean;
}

/** Max over a prefix of positions, remembering which item gave it (Fenwick tree). */
class PrefixMax {
  private val: Float64Array;
  private idx: Int32Array;
  constructor(n: number) {
    this.val = new Float64Array(n + 1).fill(-Infinity);
    this.idx = new Int32Array(n + 1).fill(-1);
  }
  update(pos: number, v: number, item: number): void {
    for (let k = pos + 1; k < this.val.length; k += k & -k) {
      if (v > this.val[k]) {
        this.val[k] = v;
        this.idx[k] = item;
      }
    }
  }
  /** Best over positions < pos. */
  query(pos: number): [number, number] {
    let best = 0;
    let item = -1;
    for (let k = pos; k > 0; k -= k & -k) {
      if (this.val[k] > best) {
        best = this.val[k];
        item = this.idx[k];
      }
    }
    return [best, item];
  }
}

/**
 * Block alignment that allows moves, or null when there are too many candidates.
 * 1. Identical runs carrying enough words anchor in place.
 * 2. All other blocks are matched globally, most shared words first (compatible kinds,
 *    similarity >= threshold, identical copies included).
 * 3. The heaviest set of matches that keeps document order (with all anchors) stays in place;
 *    every other match is a move.
 */
export function alignWithMoves<T>(
  a: T[],
  b: T[],
  opts: AlignOptions<T>,
  maxCandidates: number,
  forced: [number, number][] = [],
): MoveOp<T>[] | null {
  const ka = a.map(opts.key);
  const kb = b.map(opts.key);
  const bagA: WordBag[] = a.map(x => wordBag(opts.words(x)));
  const bagB: WordBag[] = b.map(y => wordBag(opts.words(y)));

  const matches: Match[] = [];
  const anchoredA = new Uint8Array(a.length);
  const anchoredB = new Uint8Array(b.length);
  // Manual pairs come first; their blocks are taken out of anchoring and automatic matching.
  for (const [fi, fj] of forced) {
    if (anchoredA[fi] || anchoredB[fj]) continue;
    matches.push({ i: fi, j: fj, w: FORCED_WEIGHT, anchor: false, forced: true });
    anchoredA[fi] = 1;
    anchoredB[fj] = 1;
  }
  let i = 0;
  let j = 0;
  for (const run of lcsRuns(ka, kb)) {
    if (run.kind === 'removed') i += run.count;
    else if (run.kind === 'added') j += run.count;
    else {
      let words = 0;
      for (let k = 0; k < run.count; k++) words += bagA[i + k].length;
      if (words >= STRONG_ANCHOR_WORDS) {
        for (let k = 0; k < run.count; k++) {
          if (anchoredA[i + k] || anchoredB[j + k]) continue;
          matches.push({ i: i + k, j: j + k, w: ANCHOR_WEIGHT, anchor: true });
          anchoredA[i + k] = 1;
          anchoredB[j + k] = 1;
        }
      }
      i += run.count;
      j += run.count;
    }
  }

  const freeA: number[] = [];
  const freeB: number[] = [];
  a.forEach((_, x) => anchoredA[x] || freeA.push(x));
  b.forEach((_, y) => anchoredB[y] || freeB.push(y));
  const tooMany = freeA.length * freeB.length > maxCandidates;
  if (tooMany && !forced.length) return null;

  const cands: Match[] = [];
  for (const x of tooMany ? [] : freeA) {
    for (const y of freeB) {
      let w: number;
      if (ka[x] === kb[y]) w = Math.max(MIN_WEIGHT, bagA[x].length);
      else {
        if (!opts.compatible(a[x], b[y])) continue;
        const s = bagSimilarity(bagA[x], bagB[y]);
        if (s < opts.threshold) continue;
        w = Math.max(MIN_WEIGHT, (s * (bagA[x].length + bagB[y].length)) / 2);
      }
      cands.push({ i: x, j: y, w, anchor: false });
    }
  }
  // Most shared words first; ties go to the pair closest in relative position.
  const rel = (m: Match) => Math.abs(m.i / Math.max(1, a.length) - m.j / Math.max(1, b.length));
  cands.sort((p, q) => q.w - p.w || rel(p) - rel(q));
  const usedA = new Uint8Array(a.length);
  const usedB = new Uint8Array(b.length);
  for (const c of cands) {
    if (usedA[c.i] || usedB[c.j]) continue;
    usedA[c.i] = 1;
    usedB[c.j] = 1;
    matches.push(c);
  }

  // Heaviest order-preserving subset (weighted LIS on old index, items in new-index order).
  matches.sort((p, q) => p.j - q.j);
  const fen = new PrefixMax(a.length);
  const best = new Float64Array(matches.length);
  const prev = new Int32Array(matches.length).fill(-1);
  let top = -1;
  matches.forEach((m, k) => {
    const [v, p] = fen.query(m.i);
    best[k] = v + m.w;
    prev[k] = p;
    fen.update(m.i, best[k], k);
    if (top < 0 || best[k] > best[top]) top = k;
  });
  const inPlace = new Uint8Array(matches.length);
  for (let k = top; k >= 0; k = prev[k]) inPlace[k] = 1;

  const pairOfA = new Int32Array(a.length).fill(-1);
  const pairOfB = new Int32Array(b.length).fill(-1);
  const link = new Int32Array(matches.length).fill(-1);
  let links = 0;
  matches.forEach((m, k) => {
    pairOfA[m.i] = k;
    pairOfB[m.j] = k;
    if (!inPlace[k]) link[k] = links++;
  });

  const out: MoveOp<T>[] = [];
  const backbone = matches.filter((_, k) => inPlace[k]);
  let pi = 0;
  let pj = 0;
  const emitBetween = (ei: number, ej: number) => {
    for (let y = pj; y < ej; y++) {
      const k = pairOfB[y];
      if (k < 0) out.push({ op: 'insert', b: b[y] });
      else out.push({ op: 'moveTo', a: a[matches[k].i], b: b[y], link: link[k], forced: matches[k].forced });
    }
    for (let x = pi; x < ei; x++) {
      const k = pairOfA[x];
      if (k < 0) out.push({ op: 'delete', a: a[x] });
      else out.push({ op: 'moveFrom', a: a[x], link: link[k] });
    }
  };
  for (const m of backbone) {
    emitBetween(m.i, m.j);
    out.push({ op: ka[m.i] === kb[m.j] && !m.forced ? 'equal' : 'pair', a: a[m.i], b: b[m.j], forced: m.forced });
    pi = m.i + 1;
    pj = m.j + 1;
  }
  emitBetween(a.length, b.length);
  return out;
}
