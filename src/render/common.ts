import type { DiffBlock } from '../engine/diff';
import type { RawSeg } from '../engine/inlineDiff';
import { escapeHtml } from './escape';

export function wrapOp(op: 'equal' | 'insert' | 'delete', html: string): string {
  if (op === 'insert') return `<ins>${html}</ins>`;
  if (op === 'delete') return `<del>${html}</del>`;
  return html;
}

export function rawSegs(segs: RawSeg[]): string {
  return segs.map(s => wrapOp(s.op, escapeHtml(s.text))).join('');
}

/** Kinds that may be paired: text with text, code with code, table with table. */
export function family(kind: string): string {
  if (kind === 'paragraph' || kind === 'heading') return 'text';
  if (kind === 'code' || kind === 'frontmatter') return 'code';
  return kind;
}

/** Old-side and new-side block indexes, used by manual pairing. */
function sides(b: DiffBlock): { oi?: number; ni?: number } {
  switch (b.status) {
    case 'deleted':
    case 'movedAway':
      return { oi: b.block.index };
    case 'inserted':
      return { ni: b.block.index };
    default:
      return { oi: b.old?.index, ni: b.block.index };
  }
}

function attrs(b: DiffBlock): string {
  const { oi, ni } = sides(b);
  return `${oi !== undefined ? ` data-oi="${oi}"` : ''}${ni !== undefined ? ` data-ni="${ni}"` : ''} data-family="${family(b.block.kind)}"`;
}

/** Pair / Unpair controls for blocks that have an old side. */
export function pairControls(b: DiffBlock): string {
  const { oi } = sides(b);
  if (oi === undefined || b.status === 'unchanged') return '';
  if (b.forced) return `<button class="unpair-btn" data-oi="${oi}" title="Undo this manual pairing">Unpair</button>`;
  return `<button class="pair-btn" data-oi="${oi}" title="Compare this old block with a new block you pick">Pair with…</button>`;
}

export function blockOpen(b: DiffBlock): string {
  const counted = b.status !== 'unchanged' && b.status !== 'movedAway';
  const cls = `blk ${b.status}${counted ? ' chg' : ''}${b.forced ? ' forced' : ''}`;
  return `<div class="${cls}" data-id="${b.id}"${attrs(b)}>${pairControls(b)}`;
}

export function markers(b: DiffBlock): string {
  return b.markers.map(m => `<span class="marker">${escapeHtml(m)}</span>`).join('');
}

/** Stub left where a moved block used to be; links to its new position. */
export function movedStub(b: DiffBlock): string {
  return `<div class="blk movedAway" data-id="${b.id}"${attrs(b)}>${pairControls(b)}<a class="move-link" data-target="${b.movedTo}" href="#">${escapeHtml(b.markers[0] ?? 'moved')}</a></div>`;
}
