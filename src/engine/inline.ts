import type { PhrasingContent } from 'mdast';
import type { Format, InlineToken } from './types';

export const WORD_RE = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu;
export const IS_WORD = /^[\p{L}\p{N}]/u;

function pushText(out: InlineToken[], text: string, fmt: Format): void {
  for (const m of text.matchAll(WORD_RE)) {
    const t = m[0];
    if (/^\s/.test(t)) pushSpace(out, fmt);
    else out.push({ text: t, fmt });
  }
}

function pushSpace(out: InlineToken[], fmt: Format): void {
  if (out.length && out[out.length - 1].text === ' ') return;
  out.push({ text: ' ', fmt });
}

type AnyNode = { type: string; value?: string; children?: AnyNode[]; url?: string; alt?: string | null; identifier?: string; label?: string | null };

function walk(nodes: AnyNode[], fmt: Format, out: InlineToken[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        pushText(out, n.value ?? '', fmt);
        break;
      case 'break':
        pushSpace(out, fmt);
        break;
      case 'strong':
        walk(n.children ?? [], { ...fmt, strong: true }, out);
        break;
      case 'emphasis':
        walk(n.children ?? [], { ...fmt, emphasis: true }, out);
        break;
      case 'delete':
        walk(n.children ?? [], { ...fmt, strike: true }, out);
        break;
      case 'inlineCode':
        out.push({ text: n.value ?? '', fmt: { ...fmt, code: true } });
        break;
      case 'link':
        walk(n.children ?? [], { ...fmt, link: n.url ?? '' }, out);
        break;
      case 'linkReference':
        walk(n.children ?? [], { ...fmt, link: `[${n.label ?? n.identifier ?? ''}]` }, out);
        break;
      case 'image':
      case 'imageReference': {
        const f: Format = { ...fmt, image: n.url ?? `[${n.label ?? n.identifier ?? ''}]` };
        if (n.alt) pushText(out, n.alt, f);
        else out.push({ text: '[image]', fmt: f });
        break;
      }
      case 'html':
        out.push({ text: n.value ?? '', fmt });
        break;
      case 'footnoteReference':
        out.push({ text: `[^${n.label ?? n.identifier ?? ''}]`, fmt });
        break;
      default:
        if (n.children) walk(n.children, fmt, out);
        else if (n.value) pushText(out, n.value, fmt);
    }
  }
}

/** Flatten mdast phrasing content into word/space/punctuation tokens carrying their formatting. */
export function tokenizeInline(nodes: PhrasingContent[], fmt: Format = {}): InlineToken[] {
  const out: InlineToken[] = [];
  walk(nodes as AnyNode[], fmt, out);
  while (out.length && out[0].text === ' ') out.shift();
  while (out.length && out[out.length - 1].text === ' ') out.pop();
  return out;
}

export function fmtSig(f: Format): string {
  return [f.strong ? 'b' : '', f.emphasis ? 'i' : '', f.strike ? 's' : '', f.code ? 'c' : '', f.link !== undefined ? `l(${f.link})` : '', f.image !== undefined ? `m(${f.image})` : ''].join('');
}

export function tokensSig(tokens: InlineToken[]): string {
  return tokens.map(t => `${t.text}\u0001${fmtSig(t.fmt)}`).join('\u0002');
}
