import { diffLines } from 'diff';
import { align } from './align';
import { tokensSig } from './inline';
import { diffInline, diffRaw, type InlineSeg, type RawSeg } from './inlineDiff';
import type { InlineToken } from './types';

export interface CodeLine {
  /** modified = paired changed line, segs word-diffed. */
  op: 'equal' | 'insert' | 'delete' | 'modified';
  segs: RawSeg[];
}

export type CellDiff = { op: 'equal' | 'pair' | 'insert' | 'delete'; segs: InlineSeg[] };
export type RowDiff = { op: 'equal' | 'pair' | 'insert' | 'delete'; cells: CellDiff[] };

/** Tokens as segments of a single op, merged where formatting matches. */
export function tokensAs(tokens: InlineToken[], op: InlineSeg['op']): InlineSeg[] {
  if (op === 'equal') return diffInline(tokens, tokens);
  return diffInline(op === 'delete' ? tokens : [], op === 'insert' ? tokens : []);
}

function splitLines(v: string): string[] {
  const lines = v.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line diff; adjacent delete/insert runs are paired index-by-index into word-diffed modified lines. */
export function diffCode(a: string, b: string): CodeLine[] {
  const out: CodeLine[] = [];
  let dels: string[] = [];
  let inss: string[] = [];
  const flush = () => {
    const n = Math.max(dels.length, inss.length);
    const paired = Math.min(dels.length, inss.length);
    for (let k = 0; k < paired; k++) out.push({ op: 'modified', segs: diffRaw(dels[k], inss[k], { exactWhitespace: true }) });
    for (let k = paired; k < n; k++) {
      if (k < dels.length) out.push({ op: 'delete', segs: [{ op: 'delete', text: dels[k] }] });
      else out.push({ op: 'insert', segs: [{ op: 'insert', text: inss[k] }] });
    }
    dels = [];
    inss = [];
  };
  const withNl = (s: string) => (s === '' ? '' : s.endsWith('\n') ? s : s + '\n');
  for (const ch of diffLines(withNl(a), withNl(b))) {
    const lines = splitLines(ch.value);
    if (ch.removed) dels.push(...lines);
    else if (ch.added) inss.push(...lines);
    else {
      flush();
      for (const l of lines) out.push({ op: 'equal', segs: [{ op: 'equal', text: l }] });
    }
  }
  flush();
  return out;
}

function diffRow(a: InlineToken[][], b: InlineToken[][]): CellDiff[] {
  const n = Math.max(a.length, b.length);
  const cells: CellDiff[] = [];
  for (let k = 0; k < n; k++) {
    if (k >= a.length) cells.push({ op: 'insert', segs: tokensAs(b[k], 'insert') });
    else if (k >= b.length) cells.push({ op: 'delete', segs: tokensAs(a[k], 'delete') });
    else {
      const segs = diffInline(a[k], b[k]);
      const same = segs.every(s => s.op === 'equal' && !s.oldFmt);
      cells.push({ op: same ? 'equal' : 'pair', segs });
    }
  }
  return cells;
}

/** Rows aligned like blocks; cells compared by index; extra cells are inserted/deleted. */
export function diffTable(a: InlineToken[][][], b: InlineToken[][][], threshold: number): RowDiff[] {
  const rowKey = (r: InlineToken[][]) => r.map(tokensSig).join('\u0003');
  const rowWords = (r: InlineToken[][]) => r.flat().map(t => t.text);
  return align(a, b, { key: rowKey, words: rowWords, compatible: () => true, threshold }).map((op): RowDiff => {
    switch (op.op) {
      case 'equal':
        return { op: 'equal', cells: op.b.map(c => ({ op: 'equal', segs: tokensAs(c, 'equal') })) };
      case 'pair': {
        const cells = diffRow(op.a, op.b);
        return { op: cells.every(c => c.op === 'equal') ? 'equal' : 'pair', cells };
      }
      case 'delete':
        return { op: 'delete', cells: op.a.map(c => ({ op: 'delete', segs: tokensAs(c, 'delete') })) };
      case 'insert':
        return { op: 'insert', cells: op.b.map(c => ({ op: 'insert', segs: tokensAs(c, 'insert') })) };
    }
  });
}
