import type { PhrasingContent } from 'mdast';
import type { Format, InlineToken } from './types';

export const WORD_RE = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu;
export const IS_WORD = /^[\p{L}\p{N}]/u;

export interface TokenizeOptions {
  /** Treat soft-wrapped lines as spaces (hard breaks are always kept). */
  ignoreWrap?: boolean;
}

function pushText(out: InlineToken[], text: string, fmt: Format, opts: TokenizeOptions): void {
  for (const m of text.matchAll(WORD_RE)) {
    const t = m[0];
    if (/^\s/.test(t)) {
      const breaks = opts.ignoreWrap ? 0 : (t.match(/\n/g)?.length ?? 0);
      if (breaks) for (let k = 0; k < breaks; k++) pushBreak(out, fmt);
      else pushSpace(out, fmt);
    } else out.push({ text: t, fmt });
  }
}

function pushSpace(out: InlineToken[], fmt: Format): void {
  const last = out[out.length - 1]?.text;
  if (last === ' ' || last === '\n') return;
  out.push({ text: ' ', fmt });
}

/** A line break token ('\n'); replaces a pending space. */
function pushBreak(out: InlineToken[], fmt: Format): void {
  if (out.length && out[out.length - 1].text === ' ') out.pop();
  out.push({ text: '\n', fmt });
}

/** Plain text (e.g. a code block's contents) as tokens, keeping line breaks. */
export function textTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  pushText(out, text, {}, {});
  return out;
}

type AnyNode = { type: string; value?: string; children?: AnyNode[]; url?: string; alt?: string | null; identifier?: string; label?: string | null };

function walk(nodes: AnyNode[], fmt: Format, out: InlineToken[], opts: TokenizeOptions): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        pushText(out, n.value ?? '', fmt, opts);
        break;
      case 'break':
        pushBreak(out, fmt);
        break;
      case 'strong':
        walk(n.children ?? [], { ...fmt, strong: true }, out, opts);
        break;
      case 'emphasis':
        walk(n.children ?? [], { ...fmt, emphasis: true }, out, opts);
        break;
      case 'delete':
        walk(n.children ?? [], { ...fmt, strike: true }, out, opts);
        break;
      case 'inlineCode':
        out.push({ text: n.value ?? '', fmt: { ...fmt, code: true } });
        break;
      case 'link':
        walk(n.children ?? [], { ...fmt, link: n.url ?? '' }, out, opts);
        break;
      case 'linkReference':
        walk(n.children ?? [], { ...fmt, link: `[${n.label ?? n.identifier ?? ''}]` }, out, opts);
        break;
      case 'image':
      case 'imageReference': {
        const f: Format = { ...fmt, image: n.url ?? `[${n.label ?? n.identifier ?? ''}]` };
        if (n.alt) pushText(out, n.alt, f, opts);
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
        if (n.children) walk(n.children, fmt, out, opts);
        else if (n.value) pushText(out, n.value, fmt, opts);
    }
  }
}

/** Flatten mdast phrasing content into word/space/punctuation tokens carrying their formatting. */
export function tokenizeInline(nodes: PhrasingContent[], fmt: Format = {}, opts: TokenizeOptions = {}): InlineToken[] {
  const out: InlineToken[] = [];
  walk(nodes as AnyNode[], fmt, out, opts);
  const blank = (t: InlineToken) => t.text === ' ' || t.text === '\n';
  while (out.length && blank(out[0])) out.shift();
  while (out.length && blank(out[out.length - 1])) out.pop();
  return out;
}

export function fmtSig(f: Format): string {
  return [f.strong ? 'b' : '', f.emphasis ? 'i' : '', f.strike ? 's' : '', f.code ? 'c' : '', f.link !== undefined ? `l(${f.link})` : '', f.image !== undefined ? `m(${f.image})` : ''].join('');
}

export function tokensSig(tokens: InlineToken[]): string {
  return tokens.map(t => `${t.text}\u0001${fmtSig(t.fmt)}`).join('\u0002');
}
