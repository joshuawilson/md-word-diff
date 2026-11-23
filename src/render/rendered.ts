import type { DiffBlock, DiffResult } from '../engine/diff';
import { describeFormat, type InlineSeg } from '../engine/inlineDiff';
import type { Container, Format } from '../engine/types';
import { blockOpen, markers, moveLink, rawSegs, wrapOp } from './common';
import { escapeHtml, safeHref } from './escape';

function formatted(text: string, f: Format): string {
  let h = escapeHtml(text).replace(/\n/g, '<br>');
  if (f.image !== undefined) {
    return `<span class="img">🖼 ${h} <span class="url">${escapeHtml(f.image)}</span></span>`;
  }
  if (f.code) h = `<code>${h}</code>`;
  if (f.strike) h = `<s>${h}</s>`;
  if (f.emphasis) h = `<em>${h}</em>`;
  if (f.strong) h = `<strong>${h}</strong>`;
  if (f.link !== undefined) h = `<a href="${escapeHtml(safeHref(f.link))}" title="${escapeHtml(f.link)}">${h}</a>`;
  return h;
}

export function inlineHtml(segs: InlineSeg[]): string {
  return segs
    .map(s => {
      let h = formatted(s.text, s.fmt);
      if (s.oldFmt) h = `<span class="fmt-changed" title="was: ${escapeHtml(describeFormat(s.oldFmt))}">${h}</span>`;
      return wrapOp(s.op, h);
    })
    .join('');
}

function tableHtml(b: DiffBlock): string {
  const rows = (b.table ?? []).map((r, i) => {
    const tag = i === 0 ? 'th' : 'td';
    const cells = r.cells.map(c => `<${tag} class="cell ${c.op}">${inlineHtml(c.segs)}</${tag}>`).join('');
    return `<tr class="row ${r.op}">${cells}</tr>`;
  });
  return `<table>${rows.join('')}</table>`;
}

function codeHtml(b: DiffBlock): string {
  const lines = (b.code ?? []).map(l => `<div class="ln ${l.op}">${rawSegs(l.segs) || ' '}</div>`);
  return `<pre class="code">${lines.join('')}</pre>`;
}

function content(b: DiffBlock, lead: string): string {
  const blk = b.block;
  switch (blk.kind) {
    case 'heading':
      return `<h${blk.level}>${lead}${inlineHtml(b.inline ?? [])}</h${blk.level}>`;
    case 'paragraph':
      return `<p>${lead}${inlineHtml(b.inline ?? [])}</p>`;
    case 'code':
    case 'frontmatter':
      return codeHtml(b);
    case 'table':
      return tableHtml(b);
    case 'thematicBreak':
      return '<hr>';
    case 'html':
      return `<pre class="code html">${rawSegs(b.raw)}</pre>`;
  }
}

function checkbox(b: DiffBlock): string {
  const blk = b.block;
  if (!blk.itemStart || blk.checked === null) return '';
  return `<input type="checkbox" disabled${blk.checked ? ' checked' : ''}> `;
}

interface Open {
  sig: string;
  close: string;
  isList: boolean;
  liOpen: boolean;
}

function sigOf(c: Container): string {
  return c.kind === 'quote' ? `q${c.depth}` : `${c.ordered ? 'o' : 'l'}${c.depth}`;
}

/** Rendered view: blocks with real list/quote wrappers rebuilt around them. */
export function renderRendered(r: DiffResult): string {
  const out: string[] = [];
  const stack: Open[] = [];
  const closeTo = (n: number) => {
    while (stack.length > n) {
      const o = stack.pop()!;
      if (o.liOpen) out.push('</li>');
      out.push(o.close);
    }
  };
  for (const b of r.blocks) {
    const chain = b.block.containers;
    let common = 0;
    while (common < stack.length && common < chain.length && stack[common].sig === sigOf(chain[common])) common++;
    let innermostList = -1;
    chain.forEach((c, i) => {
      if (c.kind === 'list') innermostList = i;
    });
    if (b.block.itemStart && innermostList >= 0 && common > innermostList + 1) common = innermostList + 1;
    closeTo(common);
    if (b.block.itemStart && innermostList >= 0 && common === innermostList + 1) {
      const o = stack[innermostList];
      if (o.liOpen) out.push('</li>');
      out.push('<li>');
      o.liOpen = true;
    }
    for (let i = common; i < chain.length; i++) {
      const c = chain[i];
      if (c.kind === 'quote') {
        out.push('<blockquote>');
        stack.push({ sig: sigOf(c), close: '</blockquote>', isList: false, liOpen: false });
      } else {
        out.push(c.ordered ? `<ol start="${c.start}">` : '<ul>');
        out.push('<li>');
        stack.push({ sig: sigOf(c), close: c.ordered ? '</ol>' : '</ul>', isList: true, liOpen: true });
      }
    }
    const box = checkbox(b);
    const textual = b.block.kind === 'paragraph' || b.block.kind === 'heading';
    out.push(blockOpen(b), b.status === 'movedAway' ? moveLink(b) : markers(b), textual ? '' : box, content(b, textual ? box : ''), '</div>');
  }
  closeTo(0);
  return out.join('');
}
