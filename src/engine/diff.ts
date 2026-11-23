import { align } from './align';
import { diffCode, diffTable, tokensAs, type CodeLine, type RowDiff } from './blockDiff';
import { IS_WORD } from './inline';
import { diffInline, diffRaw, type InlineSeg, type RawSeg } from './inlineDiff';
import { parseBlocks } from './parse';
import type { Block, Container } from './types';

export type { CodeLine, RowDiff, CellDiff } from './blockDiff';

export interface DiffBlock {
  id: number;
  status: 'unchanged' | 'modified' | 'inserted' | 'deleted';
  /** New block (old for deleted): kind, containers, marker. */
  block: Block;
  old?: Block;
  inline?: InlineSeg[];
  code?: CodeLine[];
  table?: RowDiff[];
  raw: RawSeg[];
  markers: string[];
}

export interface DiffResult {
  blocks: DiffBlock[];
  stats: { changes: number; wordsAdded: number; wordsRemoved: number };
}

const TEXTUAL = new Set(['paragraph', 'heading']);

function compatible(x: Block, y: Block): boolean {
  if (TEXTUAL.has(x.kind) && TEXTUAL.has(y.kind)) return true;
  return x.kind === y.kind;
}

function blockWords(b: Block): string[] {
  if (b.inline) return b.inline.map(t => t.text);
  if (b.rows) return b.rows.flat(2).map(t => t.text);
  if (b.code !== undefined) return b.code.split(/\s+/);
  return b.source.split(/\s+/);
}

const inList = (cs: Container[]) => cs.filter(c => c.kind === 'list').length;
const quoteDepth = (cs: Container[]) => cs.filter(c => c.kind === 'quote').length;
const innerList = (cs: Container[]) => [...cs].reverse().find(c => c.kind === 'list') as Extract<Container, { kind: 'list' }> | undefined;

function markersFor(a: Block, b: Block): string[] {
  const m: string[] = [];
  if (a.kind === 'heading' && b.kind === 'heading' && a.level !== b.level) m.push(`heading ${a.level} → ${b.level}`);
  if (a.kind === 'paragraph' && b.kind === 'heading') m.push('became heading');
  if (a.kind === 'heading' && b.kind === 'paragraph') m.push('was heading');
  const la = inList(a.containers);
  const lb = inList(b.containers);
  if (!la && lb) m.push('became list item');
  else if (la && !lb) m.push('was list item');
  else if (la !== lb) m.push(`list depth ${la} → ${lb}`);
  const qa = quoteDepth(a.containers);
  const qb = quoteDepth(b.containers);
  if (!qa && qb) m.push('became quote');
  else if (qa && !qb) m.push('was quote');
  else if (qa !== qb) m.push(`quote depth ${qa} → ${qb}`);
  const oa = innerList(a.containers);
  const ob = innerList(b.containers);
  if (oa && ob && oa.ordered !== ob.ordered) m.push(ob.ordered ? 'became numbered list' : 'became bullet list');
  if (isCode(a) && isCode(b) && (a.lang ?? '') !== (b.lang ?? '')) m.push(`language ${a.lang || 'none'} → ${b.lang || 'none'}`);
  if (b.checked !== null && a.checked !== b.checked) m.push(b.checked ? 'checked' : 'unchecked');
  return m;
}

function isCode(b: Block): boolean {
  return b.kind === 'code' || b.kind === 'frontmatter';
}

function whole(b: Block, op: 'equal' | 'insert' | 'delete'): Partial<DiffBlock> {
  const lineOp = op;
  const res: Partial<DiffBlock> = { raw: [{ op, text: b.source }] };
  if (b.inline) res.inline = tokensAs(b.inline, op);
  if (b.code !== undefined) res.code = b.code.split('\n').map(l => ({ op: lineOp, segs: [{ op, text: l }] }));
  if (b.rows) res.table = b.rows.map(r => ({ op, cells: r.map(c => ({ op, segs: tokensAs(c, op) })) }));
  return res;
}

function countWords(text: string): number {
  let n = 0;
  for (const t of text.split(/[^\p{L}\p{N}]+/u)) if (t && IS_WORD.test(t)) n++;
  return n;
}

function tally(b: DiffBlock, stats: DiffResult['stats']): void {
  const add = (op: string, text: string) => {
    if (op === 'insert') stats.wordsAdded += countWords(text);
    else if (op === 'delete') stats.wordsRemoved += countWords(text);
  };
  if (b.inline) for (const s of b.inline) add(s.op, s.text);
  else if (b.table) for (const r of b.table) for (const c of r.cells) for (const s of c.segs) add(s.op, s.text);
  else if (b.code) for (const l of b.code) for (const s of l.segs) add(s.op, s.text);
  else for (const s of b.raw) add(s.op, s.text);
}

/** Compare two markdown documents block by block with word-level diffs inside paired blocks. */
export function diffMarkdown(oldMd: string, newMd: string, opts: { threshold: number }): DiffResult {
  const a = parseBlocks(oldMd);
  const b = parseBlocks(newMd);
  const ops = align(a, b, { key: x => x.key, words: blockWords, compatible, threshold: opts.threshold });
  const stats = { changes: 0, wordsAdded: 0, wordsRemoved: 0 };
  const blocks: DiffBlock[] = ops.map((op, id): DiffBlock => {
    switch (op.op) {
      case 'equal':
        return { id, status: 'unchanged', block: op.b, old: op.a, markers: [], ...whole(op.b, 'equal') } as DiffBlock;
      case 'insert':
        return { id, status: 'inserted', block: op.b, markers: [], ...whole(op.b, 'insert') } as DiffBlock;
      case 'delete':
        return { id, status: 'deleted', block: op.a, markers: [], ...whole(op.a, 'delete') } as DiffBlock;
      case 'pair': {
        const x = op.a;
        const y = op.b;
        const d: DiffBlock = { id, status: 'modified', block: y, old: x, markers: markersFor(x, y), raw: [] };
        if (isCode(y)) {
          d.code = diffCode(x.code ?? '', y.code ?? '');
          d.raw = diffRaw(x.source, y.source, { exactWhitespace: true });
        } else {
          d.raw = diffRaw(x.source, y.source);
          if (y.rows) d.table = diffTable(x.rows ?? [], y.rows, opts.threshold);
          if (y.inline) d.inline = diffInline(x.inline ?? [], y.inline);
        }
        return d;
      }
    }
  });
  for (const blk of blocks) {
    if (blk.status !== 'unchanged') stats.changes++;
    tally(blk, stats);
  }
  return { blocks, stats };
}
