import { diffArrays } from 'diff';
import { bagSimilarity, wordBag } from './similarity';

export type AlignOp<T> = { op: 'equal' | 'pair'; a: T; b: T } | { op: 'delete'; a: T } | { op: 'insert'; b: T };

export interface AlignOptions<T> {
  key: (x: T) => string;
  words: (x: T) => string[];
  compatible: (x: T, y: T) => boolean;
  threshold: number;
}

type Run = { kind: 'equal' | 'removed' | 'added'; count: number };

/**
 * LCS of exact keys. Items whose key never occurs on the other side cannot match,
 * so they are dropped before running Myers diff (keeps D small on drastic rewrites).
 */
function anchors(ka: string[], kb: string[]): Run[] {
  const inB = new Set(kb);
  const inA = new Set(ka);
  const fa = ka.map((k, x) => ({ k, x })).filter(e => inB.has(e.k));
  const fb = kb.map((k, y) => ({ k, y })).filter(e => inA.has(e.k));
  const runs: Run[] = [];
  const push = (kind: Run['kind'], count: number) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  let x = 0;
  let y = 0;
  let p = 0;
  let q = 0;
  for (const ch of diffArrays(fa.map(e => e.k), fb.map(e => e.k))) {
    const n = ch.count ?? ch.value.length;
    if (ch.removed) p += n;
    else if (ch.added) q += n;
    else {
      for (let k = 0; k < n; k++) {
        const ax = fa[p + k].x;
        const by = fb[q + k].y;
        push('removed', ax - x);
        push('added', by - y);
        push('equal', 1);
        x = ax + 1;
        y = by + 1;
      }
      p += n;
      q += n;
    }
  }
  push('removed', ka.length - x);
  push('added', kb.length - y);
  return runs;
}

const DP_LIMIT = 250_000;
const GREEDY_WINDOW = 200;

/**
 * Order-preserving alignment: exact-key anchors via LCS, then in each gap pair
 * compatible items whose similarity >= threshold, maximizing total similarity.
 * Pairs never cross. Within a gap, deletions are emitted before the items they precede.
 */
export function align<T>(a: T[], b: T[], opts: AlignOptions<T>): AlignOp<T>[] {
  const ka = a.map(opts.key);
  const kb = b.map(opts.key);
  const out: AlignOp<T>[] = [];
  let i = 0;
  let j = 0;
  let gapA: T[] = [];
  let gapB: T[] = [];
  const flush = () => {
    if (gapA.length || gapB.length) alignGap(gapA, gapB, opts, out);
    gapA = [];
    gapB = [];
  };
  for (const ch of anchors(ka, kb)) {
    if (ch.kind === 'removed') {
      gapA.push(...a.slice(i, i + ch.count));
      i += ch.count;
    } else if (ch.kind === 'added') {
      gapB.push(...b.slice(j, j + ch.count));
      j += ch.count;
    } else {
      flush();
      for (let k = 0; k < ch.count; k++) out.push({ op: 'equal', a: a[i + k], b: b[j + k] });
      i += ch.count;
      j += ch.count;
    }
  }
  flush();
  return out;
}

function alignGap<T>(a: T[], b: T[], opts: AlignOptions<T>, out: AlignOp<T>[]): void {
  if (!a.length || !b.length) {
    for (const x of a) out.push({ op: 'delete', a: x });
    for (const y of b) out.push({ op: 'insert', b: y });
    return;
  }
  const ba = a.map(x => wordBag(opts.words(x)));
  const bb = b.map(y => wordBag(opts.words(y)));
  const sim = (x: number, y: number): number => {
    if (!opts.compatible(a[x], b[y])) return -1;
    const s = bagSimilarity(ba[x], bb[y]);
    return s >= opts.threshold ? s : -1;
  };
  if (a.length * b.length > DP_LIMIT) greedy(a, b, sim, out);
  else dp(a, b, sim, out);
}

function dp<T>(a: T[], b: T[], sim: (x: number, y: number) => number, out: AlignOp<T>[]): void {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const score = new Float64Array((n + 1) * W);
  // 0 = up (delete a), 1 = left (insert b), 2 = pair
  const move = new Uint8Array((n + 1) * W);
  for (let x = 1; x <= n; x++) move[x * W] = 0;
  for (let y = 1; y <= m; y++) move[y] = 1;
  for (let x = 1; x <= n; x++) {
    for (let y = 1; y <= m; y++) {
      const up = score[(x - 1) * W + y];
      const left = score[x * W + y - 1];
      let best = left;
      let mv = 1;
      if (up > best) {
        best = up;
        mv = 0;
      }
      const s = sim(x - 1, y - 1);
      if (s >= 0 && score[(x - 1) * W + y - 1] + s > best) {
        best = score[(x - 1) * W + y - 1] + s;
        mv = 2;
      }
      score[x * W + y] = best;
      move[x * W + y] = mv;
    }
  }
  const rev: AlignOp<T>[] = [];
  let x = n;
  let y = m;
  while (x > 0 || y > 0) {
    const mv = x === 0 ? 1 : y === 0 ? 0 : move[x * W + y];
    if (mv === 2) {
      rev.push({ op: 'pair', a: a[x - 1], b: b[y - 1] });
      x--;
      y--;
    } else if (mv === 0) {
      rev.push({ op: 'delete', a: a[x - 1] });
      x--;
    } else {
      rev.push({ op: 'insert', b: b[y - 1] });
      y--;
    }
  }
  for (let k = rev.length - 1; k >= 0; k--) out.push(rev[k]);
}

function greedy<T>(a: T[], b: T[], sim: (x: number, y: number) => number, out: AlignOp<T>[]): void {
  let next = 0;
  for (let x = 0; x < a.length; x++) {
    let bestY = -1;
    let best = -1;
    const end = Math.min(b.length, next + GREEDY_WINDOW);
    for (let y = next; y < end; y++) {
      const s = sim(x, y);
      if (s > best) {
        best = s;
        bestY = y;
      }
    }
    if (bestY < 0) {
      out.push({ op: 'delete', a: a[x] });
      continue;
    }
    for (let y = next; y < bestY; y++) out.push({ op: 'insert', b: b[y] });
    out.push({ op: 'pair', a: a[x], b: b[bestY] });
    next = bestY + 1;
  }
  for (let y = next; y < b.length; y++) out.push({ op: 'insert', b: b[y] });
}
