import { fmtSig } from './inline';
import type { Format } from './types';

type Seg = { op: 'equal' | 'insert' | 'delete'; text: string; fmt?: Format; oldFmt?: Format };

export type Grouping = 'off' | '1' | '2';

/** Max unchanged words absorbed between two changes; -1 = never absorb. */
export function gapWordsFor(g: Grouping): number {
  return g === 'off' ? -1 : Number(g);
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function sameStyle(a: Seg, b: Seg): boolean {
  return a.op === b.op && fmtSig(a.fmt ?? {}) === fmtSig(b.fmt ?? {}) && !a.oldFmt && !b.oldFmt;
}

function pushMerged<T extends Seg>(out: T[], s: T): void {
  const last = out[out.length - 1];
  if (last && last.op !== 'equal' && sameStyle(last, s)) last.text += s.text;
  else out.push({ ...s });
}

/**
 * Display grouping: within each run of changes, all inserted text comes first, then all deleted
 * text. Unchanged stretches of at most gapWords words that sit between two changes are absorbed
 * into both sides. Stretches carrying a formatting change are never absorbed.
 */
export function groupSegs<T extends Seg>(segs: T[], gapWords: number): T[] {
  const out: T[] = [];
  let ins: T[] = [];
  let del: T[] = [];
  let held: T | null = null;
  const inRegion = () => ins.length > 0 || del.length > 0;
  const flush = () => {
    for (const s of ins) pushMerged(out, s);
    for (const s of del) pushMerged(out, s);
    ins = [];
    del = [];
  };
  for (const s of segs) {
    if (s.op === 'equal') {
      if (inRegion() && held === null && !s.oldFmt && wordCount(s.text) <= gapWords) {
        held = s;
        continue;
      }
      flush();
      if (held) {
        out.push(held);
        held = null;
      }
      out.push(s);
    } else {
      if (held) {
        ins.push({ ...held, op: 'insert' });
        del.push({ ...held, op: 'delete' });
        held = null;
      }
      (s.op === 'insert' ? ins : del).push(s);
    }
  }
  flush();
  if (held) out.push(held);
  return out;
}
