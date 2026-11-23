import { diffArrays } from 'diff';

export type Run = { kind: 'equal' | 'removed' | 'added'; count: number };

/** Bounds on Myers diff work; past them the remaining sequence is treated as replaced. */
const MAX_EDIT_LENGTH = 4000;
const TIMEOUT_MS = 250;

/**
 * Longest-common-subsequence runs over string keys.
 * Items whose key never occurs on the other side cannot match, so they are dropped
 * before running Myers diff (keeps the edit distance small on heavy rewrites).
 * If the diff still exceeds the work bounds, everything that is left counts as replaced.
 */
export function lcsRuns(ka: string[], kb: string[]): Run[] {
  const inB = new Set(kb);
  const inA = new Set(ka);
  const fa: number[] = [];
  const fb: number[] = [];
  ka.forEach((k, x) => inB.has(k) && fa.push(x));
  kb.forEach((k, y) => inA.has(k) && fb.push(y));
  const runs: Run[] = [];
  const push = (kind: Run['kind'], count: number) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  let x = 0;
  let y = 0;
  const changes =
    fa.length && fb.length
      ? diffArrays(
          fa.map(i => ka[i]),
          fb.map(i => kb[i]),
          { maxEditLength: MAX_EDIT_LENGTH, timeout: TIMEOUT_MS } as Parameters<typeof diffArrays>[2],
        )
      : [];
  let p = 0;
  let q = 0;
  for (const ch of changes ?? []) {
    const n = ch.count ?? ch.value.length;
    if (ch.removed) p += n;
    else if (ch.added) q += n;
    else {
      for (let k = 0; k < n; k++) {
        const ax = fa[p + k];
        const by = fb[q + k];
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
