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

export function blockOpen(b: DiffBlock): string {
  const counted = b.status !== 'unchanged' && b.status !== 'movedAway';
  const cls = `blk ${b.status}${counted ? ' chg' : ''}`;
  return `<div class="${cls}" data-id="${b.id}">`;
}

export function markers(b: DiffBlock): string {
  return b.markers.map(m => `<span class="marker">${escapeHtml(m)}</span>`).join('');
}

/** Stub left where a moved block used to be; links to its new position. */
export function movedStub(b: DiffBlock): string {
  return `<div class="blk movedAway" data-id="${b.id}"><a class="move-link" data-target="${b.movedTo}" href="#">${escapeHtml(b.markers[0] ?? 'moved')}</a></div>`;
}
