import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import type { Nodes, PhrasingContent } from 'mdast';
import { tokenizeInline, tokensSig } from './inline';
import type { Block, BlockKind, Container } from './types';

interface Ctx {
  md: string;
  out: Block[];
}

interface ItemInfo {
  marker: string;
  checked: boolean | null;
}

function containerSig(cs: Container[]): string {
  return cs.map(c => (c.kind === 'quote' ? `q${c.depth}` : `${c.ordered ? 'o' : 'l'}${c.depth}`)).join('>');
}

function quoteDepth(cs: Container[]): number {
  return cs.filter(c => c.kind === 'quote').length;
}

function listDepth(cs: Container[]): number {
  return cs.filter(c => c.kind === 'list').length;
}

/** Strip blockquote markers and indentation from continuation lines. */
function stripPrefixes(text: string, qDepth: number): string {
  return text
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line;
      let l = line;
      for (let q = 0; q < qDepth; q++) l = l.replace(/^[ \t]*>[ \t]?/, '');
      return l.replace(/^[ \t]+/, '');
    })
    .join('\n');
}

function slice(ctx: Ctx, node: Nodes): string {
  const s = node.position?.start.offset ?? 0;
  const e = node.position?.end.offset ?? s;
  return ctx.md.slice(s, e);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function emit(ctx: Ctx, cs: Container[], item: ItemInfo | null, kind: BlockKind, source: string, content: string, extra: Partial<Block>): void {
  ctx.out.push({
    kind,
    containers: cs.slice(),
    itemStart: item !== null,
    checked: item?.checked ?? null,
    marker: item?.marker ?? '',
    source,
    key: `${kind}|${containerSig(cs)}|${content}`,
    ...extra,
  });
}

function walkBlocks(ctx: Ctx, nodes: Nodes[], cs: Container[], firstItem: ItemInfo | null): void {
  let item = firstItem;
  for (const node of nodes) {
    const consumed = walkBlock(ctx, node, cs, item);
    if (consumed) item = null;
  }
}

/** Returns true if the node produced at least one block (consuming the pending item marker). */
function walkBlock(ctx: Ctx, node: Nodes, cs: Container[], item: ItemInfo | null): boolean {
  const before = ctx.out.length;
  const q = quoteDepth(cs);
  switch (node.type) {
    case 'paragraph': {
      const inline = tokenizeInline(node.children as PhrasingContent[]);
      emit(ctx, cs, item, 'paragraph', stripPrefixes(slice(ctx, node), q), tokensSig(inline), { inline });
      break;
    }
    case 'heading': {
      const inline = tokenizeInline(node.children as PhrasingContent[]);
      emit(ctx, cs, item, 'heading', stripPrefixes(slice(ctx, node), q), `${node.depth}|${tokensSig(inline)}`, { inline, level: node.depth });
      break;
    }
    case 'code': {
      const lang = node.lang ?? '';
      const fence = '```';
      emit(ctx, cs, item, 'code', `${fence}${lang}\n${node.value}\n${fence}`, `${lang}|${node.value}`, { lang, code: node.value });
      break;
    }
    case 'yaml': {
      emit(ctx, cs, item, 'frontmatter', `---\n${node.value}\n---`, node.value, { lang: 'yaml', code: node.value });
      break;
    }
    case 'table': {
      const rows = node.children.map(r => r.children.map(c => tokenizeInline(c.children as PhrasingContent[])));
      const content = rows.map(r => r.map(tokensSig).join('\u0003')).join('\u0004');
      emit(ctx, cs, item, 'table', stripPrefixes(slice(ctx, node), q), content, { rows });
      break;
    }
    case 'thematicBreak':
      emit(ctx, cs, item, 'thematicBreak', '---', '---', {});
      break;
    case 'html':
      emit(ctx, cs, item, 'html', node.value, collapse(node.value), {});
      break;
    case 'definition': {
      const src = stripPrefixes(slice(ctx, node), q);
      emit(ctx, cs, item, 'html', src, collapse(src), {});
      break;
    }
    case 'blockquote':
      walkBlocks(ctx, node.children as Nodes[], [...cs, { kind: 'quote', depth: q + 1 }], item);
      break;
    case 'list': {
      const start = node.start ?? 1;
      const container: Container = { kind: 'list', ordered: !!node.ordered, start, depth: listDepth(cs) + 1 };
      const inner = [...cs, container];
      node.children.forEach((li, i) => {
        const checked = typeof li.checked === 'boolean' ? li.checked : null;
        const bullet = node.ordered ? `${start + i}. ` : '- ';
        const box = checked === null ? '' : checked ? '[x] ' : '[ ] ';
        const info: ItemInfo = { marker: bullet + box, checked };
        if (li.children.length === 0) {
          emit(ctx, inner, info, 'paragraph', '', '', { inline: [] });
        } else {
          walkBlocks(ctx, li.children as Nodes[], inner, info);
        }
      });
      break;
    }
    default:
      if ('children' in node && Array.isArray(node.children)) walkBlocks(ctx, node.children as Nodes[], cs, item);
  }
  return ctx.out.length > before;
}

/** Parse markdown into a flat list of blocks with container context. */
export function parseBlocks(md: string): Block[] {
  const text = md.replace(/\r\n?/g, '\n');
  const tree = fromMarkdown(text, {
    extensions: [gfm(), frontmatter(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
  });
  const ctx: Ctx = { md: text, out: [] };
  walkBlocks(ctx, tree.children as Nodes[], [], null);
  return ctx.out;
}
