import { lcsRuns } from './lcs';
import { fmtSig } from './inline';
import type { Format, InlineToken } from './types';

export interface InlineSeg {
  op: 'equal' | 'insert' | 'delete';
  text: string;
  fmt: Format;
  /** Set only on equal segments whose formatting changed. */
  oldFmt?: Format;
}

export interface RawSeg {
  op: 'equal' | 'insert' | 'delete';
  text: string;
}

function pushSeg(out: InlineSeg[], seg: InlineSeg): void {
  const last = out[out.length - 1];
  if (
    last &&
    last.op === seg.op &&
    fmtSig(last.fmt) === fmtSig(seg.fmt) &&
    (last.oldFmt === undefined) === (seg.oldFmt === undefined) &&
    (last.oldFmt === undefined || fmtSig(last.oldFmt) === fmtSig(seg.oldFmt!))
  ) {
    last.text += seg.text;
  } else {
    out.push({ ...seg });
  }
}

/** Word-level diff over visible text; formatting differences on equal text are reported via oldFmt. */
export function diffInline(a: InlineToken[], b: InlineToken[]): InlineSeg[] {
  const out: InlineSeg[] = [];
  let ia = 0;
  let ib = 0;
  for (const ch of lcsRuns(a.map(t => t.text), b.map(t => t.text))) {
    const n = ch.count;
    if (ch.kind === 'removed') {
      for (let k = 0; k < n; k++) pushSeg(out, { op: 'delete', text: a[ia + k].text, fmt: a[ia + k].fmt });
      ia += n;
    } else if (ch.kind === 'added') {
      for (let k = 0; k < n; k++) pushSeg(out, { op: 'insert', text: b[ib + k].text, fmt: b[ib + k].fmt });
      ib += n;
    } else {
      for (let k = 0; k < n; k++) {
        const ta = a[ia + k];
        const tb = b[ib + k];
        const seg: InlineSeg = { op: 'equal', text: tb.text, fmt: tb.fmt };
        if (fmtSig(ta.fmt) !== fmtSig(tb.fmt)) seg.oldFmt = ta.fmt;
        pushSeg(out, seg);
      }
      ia += n;
      ib += n;
    }
  }
  return out;
}

/** Human description of a format, e.g. 'plain', 'bold, italic', 'link https://x'. */
export function describeFormat(f: Format): string {
  const parts: string[] = [];
  if (f.strong) parts.push('bold');
  if (f.emphasis) parts.push('italic');
  if (f.strike) parts.push('strikethrough');
  if (f.code) parts.push('code');
  if (f.link !== undefined) parts.push(`link ${f.link}`);
  if (f.image !== undefined) parts.push(`image ${f.image}`);
  return parts.length ? parts.join(', ') : 'plain';
}

const RAW_RE = /\]\([^)]*\)|`[^`\n]*`|<[^>\n]+>|\*\*|__|~~|[*_]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|\s+|./gsu;

function rawTokens(s: string): string[] {
  return Array.from(s.replace(/\r\n?/g, '\n').matchAll(RAW_RE), m => m[0]);
}

const isSpace = (t: string) => /^\s/.test(t);

function pushRaw(out: RawSeg[], op: RawSeg['op'], text: string): void {
  const last = out[out.length - 1];
  if (last && last.op === op) last.text += text;
  else out.push({ op, text });
}

/**
 * Source-text token diff. By default whitespace runs (incl. line breaks) compare equal to each other;
 * exactWhitespace (code) compares them exactly.
 */
export function diffRaw(a: string, b: string, opts: { exactWhitespace?: boolean } = {}): RawSeg[] {
  const ta = rawTokens(a);
  const tb = rawTokens(b);
  const out: RawSeg[] = [];
  let ia = 0;
  let ib = 0;
  const key = (t: string) => (!opts.exactWhitespace && isSpace(t) ? ' ' : t);
  for (const ch of lcsRuns(ta.map(key), tb.map(key))) {
    const n = ch.count;
    if (ch.kind === 'removed') {
      for (let k = 0; k < n; k++) pushRaw(out, 'delete', ta[ia + k]);
      ia += n;
    } else if (ch.kind === 'added') {
      for (let k = 0; k < n; k++) pushRaw(out, 'insert', tb[ib + k]);
      ib += n;
    } else {
      for (let k = 0; k < n; k++) pushRaw(out, 'equal', tb[ib + k]);
      ia += n;
      ib += n;
    }
  }
  return out;
}
