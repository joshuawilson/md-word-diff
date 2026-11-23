import type { DiffBlock, DiffResult } from '../engine/diff';
import { blockOpen, markers, moveLink, rawSegs } from './common';
import { escapeHtml } from './escape';

function prefix(b: DiffBlock): string {
  const cs = b.block.containers;
  const quotes = cs.filter(c => c.kind === 'quote').length;
  const lists = cs.filter(c => c.kind === 'list').length;
  const indent = '  '.repeat(Math.max(0, b.block.itemStart ? lists - 1 : lists));
  return '> '.repeat(quotes) + indent + b.block.marker;
}

/** Raw view: each block's markdown source with token-level marks. */
export function renderRaw(r: DiffResult): string {
  return r.blocks
    .map(b => `${blockOpen(b)}${b.status === 'movedAway' ? moveLink(b) : markers(b)}<pre class="raw">${escapeHtml(prefix(b))}${rawSegs(b.raw)}</pre></div>`)
    .join('');
}
