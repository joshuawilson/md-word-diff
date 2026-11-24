export interface Format {
  strong?: true;
  emphasis?: true;
  strike?: true;
  code?: true;
  link?: string;
  image?: string;
}

/** One word, one ' ', one punctuation char, or one whole code span / inline html. */
export interface InlineToken {
  text: string;
  fmt: Format;
}

export type Container =
  | { kind: 'list'; ordered: boolean; start: number; depth: number }
  | { kind: 'quote'; depth: number };

export type BlockKind = 'heading' | 'paragraph' | 'code' | 'table' | 'thematicBreak' | 'html' | 'frontmatter';

export interface Block {
  kind: BlockKind;
  /** Position in the parsed document (0-based). */
  index: number;
  /** Line the block starts on in its file (1-based). */
  line: number;
  /** Outermost first. */
  containers: Container[];
  /** First block of a list item. */
  itemStart: boolean;
  /** Task-list state of the item, null if not a task item. */
  checked: boolean | null;
  /** Raw prefix shown in the Raw view, e.g. '- ', '3. ', '- [ ] ', or ''. */
  marker: string;
  /** Block source with container prefixes stripped from continuation lines, LF line endings. */
  source: string;
  /** Exact-match key: kind | container signature | normalized content. */
  key: string;
  inline?: InlineToken[];
  level?: number;
  lang?: string;
  code?: string;
  /** Table: rows -> cells -> tokens (row 0 = header). */
  rows?: InlineToken[][][];
}
