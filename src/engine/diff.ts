import { align, type AlignOp } from './align';
import { alignWithMoves, type MoveOp } from './moves';
import { diffCode, diffTable, tokensAs, type CodeLine, type RowDiff } from './blockDiff';
import { IS_WORD } from './inline';
import { diffInline, diffRaw, type InlineSeg, type RawSeg } from './inlineDiff';
import { parseBlocks } from './parse';
import { bagSimilarity, wordBag } from './similarity';
import { gapWordsFor, groupSegs, type Grouping } from './group';
import type { Block, Container } from './types';

export type { CodeLine, RowDiff, CellDiff } from './blockDiff';

export interface DiffBlock {
  id: number;
  /** movedAway = stub left at the old position of a block that moved (see movedTo). */
  status: 'unchanged' | 'modified' | 'inserted' | 'deleted' | 'movedAway';
  /** New block (old for deleted): kind, containers, marker. */
  block: Block;
  old?: Block;
  inline?: InlineSeg[];
  code?: CodeLine[];
  table?: RowDiff[];
  raw: RawSeg[];
  markers: string[];
  /** Stub only: id of the block this one moved to. */
  movedTo?: number;
  /** Moved block only: id of the stub at its old position. */
  movedFrom?: number;
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

function fromOp(op: AlignOp<Block>, id: number, threshold: number): DiffBlock {
  switch (op.op) {
    case 'equal':
      return { id, status: 'unchanged', block: op.b, old: op.a, markers: [], ...whole(op.b, 'equal') } as DiffBlock;
    case 'insert':
      return { id, status: 'inserted', block: op.b, markers: [], ...whole(op.b, 'insert') } as DiffBlock;
    case 'delete':
      return { id, status: 'deleted', block: op.a, markers: [], ...whole(op.a, 'delete') } as DiffBlock;
    case 'pair':
      return pairBlock(id, op.a, op.b, threshold);
  }
}

function movedStub(id: number, block: Block, fromAbove: boolean, movedTo: number): DiffBlock {
  return { id, status: 'movedAway', block, raw: [], markers: [fromAbove ? '↓ moved below' : '↑ moved above'], movedTo };
}

function fromMoveOps(ops: MoveOp<Block>[], threshold: number): DiffBlock[] {
  const toId = new Map<number, number>();
  const fromId = new Map<number, number>();
  ops.forEach((op, id) => {
    if (op.op === 'moveTo') toId.set(op.link, id);
    else if (op.op === 'moveFrom') fromId.set(op.link, id);
  });
  return ops.map((op, id): DiffBlock => {
    if (op.op === 'moveTo') {
      const src = fromId.get(op.link)!;
      const d = pairBlock(id, op.a, op.b, threshold);
      d.markers.unshift(src < id ? 'moved from above' : 'moved from below');
      d.movedFrom = src;
      return d;
    }
    if (op.op === 'moveFrom') {
      const dst = toId.get(op.link)!;
      return movedStub(id, op.a, id < dst, dst);
    }
    return fromOp(op, id, threshold);
  });
}

function pairBlock(id: number, x: Block, y: Block, threshold: number): DiffBlock {
  const d: DiffBlock = { id, status: 'modified', block: y, old: x, markers: markersFor(x, y), raw: [] };
  if (isCode(y)) {
    d.code = diffCode(x.code ?? '', y.code ?? '');
    d.raw = diffRaw(x.source, y.source, { exactWhitespace: true });
  } else {
    d.raw = diffRaw(x.source, y.source);
    if (y.rows) d.table = diffTable(x.rows ?? [], y.rows, threshold);
    if (y.inline) d.inline = diffInline(x.inline ?? [], y.inline);
  }
  return d;
}

/** Above this many deleted × inserted candidates the move pass is skipped (keeps big rewrites fast). */
const MOVE_PAIR_LIMIT = 2_000_000;

/**
 * Move pass: leftover deleted and inserted blocks anywhere in the document are matched by
 * shared words (compatible kinds, similarity >= threshold, exact copies included), most shared
 * words first. The inserted block becomes a modified block labelled as moved; the deleted
 * block becomes a stub pointing at it.
 */
function detectMoves(blocks: DiffBlock[], threshold: number): void {
  const dels = blocks.filter(b => b.status === 'deleted');
  const inss = blocks.filter(b => b.status === 'inserted');
  if (!dels.length || !inss.length || dels.length * inss.length > MOVE_PAIR_LIMIT) return;
  const bagD = dels.map(d => wordBag(blockWords(d.block)));
  const bagI = inss.map(i => wordBag(blockWords(i.block)));
  const cands: { d: number; i: number; score: number }[] = [];
  dels.forEach((d, x) => {
    inss.forEach((ins, y) => {
      let score: number;
      if (d.block.key === ins.block.key) score = Math.max(0.5, bagD[x].length);
      else {
        if (!compatible(d.block, ins.block)) return;
        const sim = bagSimilarity(bagD[x], bagI[y]);
        if (sim < threshold) return;
        score = (sim * (bagD[x].length + bagI[y].length)) / 2;
      }
      cands.push({ d: x, i: y, score });
    });
  });
  cands.sort((p, q) => q.score - p.score);
  const usedD = new Set<number>();
  const usedI = new Set<number>();
  const pos = new Map(blocks.map((b, k) => [b.id, k]));
  for (const c of cands) {
    if (usedD.has(c.d) || usedI.has(c.i)) continue;
    usedD.add(c.d);
    usedI.add(c.i);
    const stub = dels[c.d];
    const ins = inss[c.i];
    const moved = pairBlock(ins.id, stub.block, ins.block, threshold);
    const fromAbove = pos.get(stub.id)! < pos.get(ins.id)!;
    moved.markers.unshift(fromAbove ? 'moved from above' : 'moved from below');
    moved.movedFrom = stub.id;
    blocks[pos.get(ins.id)!] = moved;
    blocks[pos.get(stub.id)!] = movedStub(stub.id, stub.block, fromAbove, ins.id);
  }
}

/** Compare two markdown documents block by block with word-level diffs inside paired blocks. */
export function diffMarkdown(oldMd: string, newMd: string, opts: { threshold: number; grouping?: Grouping }): DiffResult {
  const a = parseBlocks(oldMd);
  const b = parseBlocks(newMd);
  const alignOpts = { key: (x: Block) => x.key, words: blockWords, compatible, threshold: opts.threshold };
  const stats = { changes: 0, wordsAdded: 0, wordsRemoved: 0 };
  const moveOps = alignWithMoves(a, b, alignOpts, MOVE_PAIR_LIMIT);
  let blocks: DiffBlock[];
  if (moveOps) {
    blocks = fromMoveOps(moveOps, opts.threshold);
  } else {
    // Too many candidates for global matching: in-order alignment, then match leftovers as moves.
    blocks = align(a, b, alignOpts).map((op, id) => fromOp(op, id, opts.threshold));
    detectMoves(blocks, opts.threshold);
  }
  for (const blk of blocks) {
    if (blk.status === 'movedAway') continue;
    if (blk.status !== 'unchanged') stats.changes++;
    tally(blk, stats);
  }
  // Grouping is display-only: applied after word counts so absorbed words don't count.
  const gap = gapWordsFor(opts.grouping ?? '1');
  for (const blk of blocks) {
    if (blk.status !== 'modified') continue;
    blk.raw = groupSegs(blk.raw, gap);
    if (blk.inline) blk.inline = groupSegs(blk.inline, gap);
    if (blk.table) for (const r of blk.table) for (const c of r.cells) c.segs = groupSegs(c.segs, gap);
    if (blk.code) for (const l of blk.code) if (l.op === 'modified') l.segs = groupSegs(l.segs, gap);
  }
  return { blocks, stats };
}
