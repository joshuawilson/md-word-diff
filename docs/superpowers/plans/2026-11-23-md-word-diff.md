# Markdown Word Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local VSCode extension that compares a markdown file against a git revision (or two revisions) and shows an inline, word-level redline, in Rendered or Raw view.

**Architecture:** A pure diff engine (`src/engine/`, no VSCode imports) parses both versions into flat blocks with container context, aligns blocks (exact LCS anchors, then order-preserving similarity DP in gaps), and diffs tokens inside paired blocks. A pure renderer (`src/render/`) turns the result into two HTML strings. A thin VSCode layer (`src/vscode/`) handles git, revision picking, and the webview panel.

**Tech Stack:** TypeScript 5.6, esbuild 0.24 (bundle to CJS), vitest 2, `mdast-util-from-markdown@2` + `micromark-extension-gfm@3` + `mdast-util-gfm@3` + `micromark-extension-frontmatter@2` + `mdast-util-frontmatter@2` (parsing with positions), `diff@5.2.0` + `@types/diff@5` (token/line diffs), `@types/vscode@1.90` (engine `^1.90.0`), `@vscode/vsce@3` (packaging).

**Spec:** `docs/superpowers/specs/2026-11-23-md-word-diff-design.md`

## Global Constraints

- VSCode 1.133 on Linux; Node 22; git CLI. `engines.vscode`: `^1.90.0`.
- Engine and renderer modules import nothing from `vscode`.
- Setting `mdWordDiff.pairingThreshold`: number 0–1, default `0.35`.
- Toolbar pairing presets: Loose = `0.2`, Normal = setting value, Strict = `0.6`; panel-only, never writes the setting.
- Line breaks inside a paragraph are not a change; whitespace runs collapse to one space for comparison (not in code blocks).
- Pairs never cross; reordered block = deletion + insertion. No move detection.
- Compatible kinds: paragraph↔paragraph (any container), heading↔heading, heading↔paragraph, code↔code, table↔table, others same kind only.
- Ordered-list renumbering alone is not a change.
- Images are never loaded: show alt text + URL.
- All document text is HTML-escaped in output; webview has strict CSP, no remote resources.
- Colors: `--vscode-diffEditor-insertedTextBackground`, `--vscode-diffEditor-removedTextBackground`; deletions always `text-decoration: line-through`; formatting-change marker = dotted amber underline with `title="was: …"`.
- Debounce live re-diff 300 ms; preserve scroll position.
- Performance: 5,000-line document diffs + renders in < 1 s.
- Install via `.vsix` only.

## Review Focus

1. **Doc contains raw HTML / `<script>`** — must display as text, never execute or inject (pinned in Task 5).
2. **CRLF line endings** (old rev LF, working copy CRLF or vice versa) — must not register as changes (pinned in Task 1).
3. **Drastic rewrite with a large gap** (hundreds of non-matching blocks) — must stay under the perf budget, not hang (pinned in Task 4).
4. **Punctuation and non-ASCII words** (`word,` → `word.`, `café`, `naïve`) — only the punctuation or the actual word marked (pinned in Task 3).
5. **File missing at revision / file not in a repo / bad rev** — clear error naming rev and path, no blank panel (pinned in Task 6).

---

## File Structure

```
package.json, tsconfig.json, esbuild.mjs, vitest.config.ts, .vscodeignore, .gitignore, README.md
src/engine/types.ts        all engine types
src/engine/inline.ts       mdast inline nodes → InlineToken[]
src/engine/parse.ts        markdown → Block[]
src/engine/similarity.ts   similarity(a, b)
src/engine/align.ts        generic order-preserving aligner
src/engine/inlineDiff.ts   InlineToken[] diff with formatting changes
src/engine/rawDiff.ts      source-text token diff
src/engine/blockDiff.ts    table + code diffs
src/engine/diff.ts         diffMarkdown() orchestration + stats
src/render/escape.ts       escapeHtml
src/render/rendered.ts     renderRendered(result) → HTML
src/render/raw.ts          renderRaw(result) → HTML
src/vscode/git.ts          git helpers
src/vscode/picker.ts       revision QuickPick
src/vscode/panel.ts        webview panel, live update, pairing presets
src/vscode/extension.ts    activate, commands
media/webview.ts           toolbar, toggle, nav, hide-unchanged (bundled to dist/webview.js)
media/style.css
test/*.test.ts, test/fixtures/
```

---

### Task 1: Scaffold + block parser

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`, `.gitignore`, `.vscodeignore`
- Create: `src/engine/types.ts`, `src/engine/inline.ts`, `src/engine/parse.ts`
- Test: `test/parse.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface Format { strong?: true; emphasis?: true; strike?: true; code?: true; link?: string; image?: string }
  export interface InlineToken { text: string; fmt: Format }   // one word, one ' ', one punctuation char, or one whole code span
  export type Container =
    | { kind: 'list'; ordered: boolean; start: number; depth: number }   // depth 1 = top-level list
    | { kind: 'quote'; depth: number };
  export type BlockKind = 'heading' | 'paragraph' | 'code' | 'table' | 'thematicBreak' | 'html' | 'frontmatter';
  export interface Block {
    kind: BlockKind;
    containers: Container[];        // outermost first
    itemStart: boolean;             // first block of a list item
    checked: boolean | null;        // task-list state of the item, null if not a task
    marker: string;                 // raw prefix for Raw view, e.g. '- ', '3. ', '- [ ] ', '> ', '' ; heading marker is part of source
    source: string;                 // block source, container prefixes stripped from continuation lines, \r\n→\n
    key: string;                    // kind + '|' + containerSig + '|' + whitespace-collapsed source (list numbers excluded)
    inline?: InlineToken[];         // heading, paragraph
    level?: number;                 // heading 1–6
    lang?: string; code?: string;   // code, frontmatter (lang 'yaml')
    rows?: InlineToken[][][];       // table: rows → cells → tokens (row 0 = header)
  }
  ```
  `containerSig` = containers joined as `l`/`o`/`q` + depth, e.g. `q1>l1`; ordered `start` excluded.
- Produces: `tokenizeInline(nodes: PhrasingContent[], fmt?: Format): InlineToken[]` (`inline.ts`); `parseBlocks(md: string): Block[]` (`parse.ts`).

- [ ] **Step 1: Scaffold.** `package.json` with name `md-word-diff`, `displayName` "Markdown Word Diff", `main: dist/extension.js`, scripts `build` (`node esbuild.mjs`), `test` (`vitest run`), `package` (`vsce package --no-dependencies`), devDependencies/dependencies per Tech Stack. `esbuild.mjs` builds two bundles: `src/vscode/extension.ts` → `dist/extension.js` (cjs, platform node, external `vscode`) and `media/webview.ts` → `dist/webview.js` (iife, browser). `.gitignore`: `node_modules`, `dist`, `*.vsix`. Run `npm install`; expect exit 0.

- [ ] **Step 2: Write failing tests** in `test/parse.test.ts`:
  ```ts
  test('paragraph soft wraps collapse', () => {
    const [b] = parseBlocks('Hello\nbig   world.');
    expect(b.kind).toBe('paragraph');
    expect(b.inline!.map(t => t.text).join('')).toBe('Hello big world.');
    expect(b.key).toBe(parseBlocks('Hello big world.')[0].key);
  });
  test('tokens: words, spaces, punctuation, unicode', () => {
    const [b] = parseBlocks('Café, naïve.');
    expect(b.inline!.map(t => t.text)).toEqual(['Café', ',', ' ', 'naïve', '.']);
  });
  test('inline formatting', () => {
    const [b] = parseBlocks('a **b** `c d` [e](http://x) ![f](i.png)');
    const by = (s: string) => b.inline!.find(t => t.text === s)!.fmt;
    expect(by('b')).toEqual({ strong: true });
    expect(by('c d')).toEqual({ code: true });
    expect(by('e')).toEqual({ link: 'http://x' });
    expect(by('f')).toEqual({ image: 'i.png' });
  });
  test('list items carry container context and marker', () => {
    const bs = parseBlocks('3. one\n4. two\n   - [x] nested');
    expect(bs.map(b => b.containers.length)).toEqual([1, 1, 2]);
    expect(bs[0].containers[0]).toEqual({ kind: 'list', ordered: true, start: 3, depth: 1 });
    expect(bs[0].marker).toBe('3. ');
    expect(bs[2].checked).toBe(true);
    expect(bs[2].marker).toBe('- [x] ');
  });
  test('renumbering does not change key', () => {
    expect(parseBlocks('1. a\n2. b')[1].key).toBe(parseBlocks('5. a\n6. b')[1].key);
  });
  test('multi-paragraph list item: itemStart only on first', () => {
    expect(parseBlocks('- a\n\n  b').map(b => b.itemStart)).toEqual([true, false]);
  });
  test('quote continuation prefixes stripped', () => {
    const [b] = parseBlocks('> one\n> two');
    expect(b.containers).toEqual([{ kind: 'quote', depth: 1 }]);
    expect(b.source).toBe('one\ntwo');
  });
  test('heading, code, table, frontmatter, html, hr', () => {
    const md = '---\nt: 1\n---\n\n## H\n\n```js\nx\n```\n\n| a | b |\n|---|---|\n| c | d |\n\n<div>x</div>\n\n***';
    const bs = parseBlocks(md);
    expect(bs.map(b => b.kind)).toEqual(['frontmatter', 'heading', 'code', 'table', 'html', 'thematicBreak']);
    expect(bs[1].level).toBe(2);
    expect(bs[2]).toMatchObject({ lang: 'js', code: 'x' });
    expect(bs[3].rows!.length).toBe(2);
    expect(bs[3].rows![1][1].map(t => t.text)).toEqual(['d']);
  });
  test('CRLF equals LF', () => {
    expect(parseBlocks('a\r\nb\r\n\r\nc').map(b => b.key)).toEqual(parseBlocks('a\nb\n\nc').map(b => b.key));
  });
  ```

- [ ] **Step 3: Run** `npx vitest run test/parse.test.ts` — expect FAIL (module not found).

- [ ] **Step 4: Implement** `types.ts`, `tokenizeInline`, `parseBlocks`. Normalize `\r\n`→`\n` first. Parse with `fromMarkdown(md, { extensions: [gfm(), frontmatter(['yaml'])], mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])] })`. Walk the tree carrying the container stack; slice `source` by node `position.start.offset`/`end.offset`. Word tokenizer regex over text values: `/\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu`, whitespace tokens emitted as `' '`, consecutive spaces merged; `break` nodes → `' '`. `inlineCode` → one token. Nested emphasis merges fmt. Inline `html` → one token, text = its raw value, fmt `{}`.

- [ ] **Step 5: Run** `npx vitest run test/parse.test.ts` — expect all PASS.

- [ ] **Step 6: Commit** `feat: scaffold extension and markdown block parser`.

---

### Task 2: Similarity + aligner

**Files:**
- Create: `src/engine/similarity.ts`, `src/engine/align.ts`
- Test: `test/align.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function similarity(a: string[], b: string[]): number   // Dice over lowercased word multisets (punctuation & spaces ignored); both empty → 1
  export type AlignOp<T> = { op: 'equal' | 'pair'; a: T; b: T } | { op: 'delete'; a: T } | { op: 'insert'; b: T };
  export function align<T>(a: T[], b: T[], opts: {
    key: (x: T) => string;                    // exact-match key
    words: (x: T) => string[];
    compatible: (x: T, y: T) => boolean;
    threshold: number;
  }): AlignOp<T>[]
  ```
  Output order: follows `b` order; within a gap, deletions come before the insert/pair they precede in `a` order (merge both sides in order, emitting a-side items first when tied).

- [ ] **Step 1: Write failing tests:**
  ```ts
  const S = (s: string) => ({ s });
  const opts = { key: (x: any) => x.s, words: (x: any) => x.s.split(' '), compatible: () => true, threshold: 0.35 };
  const ops = (r: any[]) => r.map(o => o.op);
  test('similarity', () => {
    expect(similarity(['a','b','c','d'], ['a','b','c','e'])).toBeCloseTo(0.75);
    expect(similarity([], [])).toBe(1);
  });
  test('exact anchors', () => {
    expect(ops(align(['x','y'].map(S), ['x','y'].map(S), opts))).toEqual(['equal','equal']);
  });
  test('edited block pairs', () => {
    expect(ops(align([S('the quick brown fox')], [S('the quick red fox')], opts))).toEqual(['pair']);
  });
  test('below threshold → delete + insert', () => {
    expect(ops(align([S('a b c d')], [S('w x y z')], opts))).toEqual(['delete','insert']);
  });
  test('threshold changes outcome', () => {
    const a = [S('one two three four five six')], b = [S('one two nine ten eleven twelve')];
    expect(ops(align(a, b, { ...opts, threshold: 0.2 }))).toEqual(['pair']);
    expect(ops(align(a, b, { ...opts, threshold: 0.6 }))).toEqual(['delete','insert']);
  });
  test('pairs never cross: reorder is delete + insert', () => {
    const a = ['p q r s', 'k l m n'].map(S), b = ['k l m n x', 'p q r s x'].map(S);
    const r = align(a, b, opts);
    expect(r.filter(o => o.op === 'pair').length).toBe(1);
    expect(r.filter(o => o.op === 'delete').length).toBe(1);
  });
  test('incompatible never pair', () => {
    expect(ops(align([S('a b c')], [S('a b d')], { ...opts, compatible: () => false }))).toEqual(['delete','insert']);
  });
  ```

- [ ] **Step 2: Run** `npx vitest run test/align.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** Anchors: `diffArrays` from `diff` over keys. Gaps: DP over `n×m` maximizing summed similarity of allowed pairs (allowed = compatible && sim ≥ threshold); backtrack to ops. If `n*m > 250_000`, fall back to a greedy monotone pass (for each `a` in order, best allowed `b` after last paired index within a window of 200) — keeps the perf budget.

- [ ] **Step 4: Run** tests — expect PASS.

- [ ] **Step 5: Commit** `feat: block similarity and order-preserving aligner`.

---

### Task 3: Inline diff with formatting changes + raw diff

**Files:**
- Create: `src/engine/inlineDiff.ts`, `src/engine/rawDiff.ts`
- Test: `test/inlineDiff.test.ts`

**Interfaces:**
- Consumes: `InlineToken`, `Format` (Task 1).
- Produces:
  ```ts
  export interface InlineSeg { op: 'equal' | 'insert' | 'delete'; text: string; fmt: Format; oldFmt?: Format }  // oldFmt set only on equal segs whose fmt changed
  export function diffInline(a: InlineToken[], b: InlineToken[]): InlineSeg[]   // adjacent segs with same op+fmt+oldFmt merged
  export function describeFormat(f: Format): string    // 'plain' | 'bold' | 'italic' | 'strikethrough' | 'code' | 'link https://…' | 'image i.png', joined with ', '
  export interface RawSeg { op: 'equal' | 'insert' | 'delete'; text: string }
  export function diffRaw(a: string, b: string): RawSeg[]
  ```
  `diffInline` compares by `text` only (`diffArrays` with comparator), then on equal tokens sets `oldFmt` when `fmt` differs (deep compare). Raw tokenizer: atomic `\]\([^)]*\)`, `` `[^`]*` ``, `<[^>]+>`, `\*\*|__|~~|[*_]`, words (same regex as Task 1), whitespace, single chars; whitespace tokens compare equal to each other.

- [ ] **Step 1: Write failing tests:**
  ```ts
  const toks = (md: string) => parseBlocks(md)[0].inline!;
  const ins = (s: InlineSeg[]) => s.filter(x => x.op === 'insert').map(x => x.text).join('|');
  const del = (s: InlineSeg[]) => s.filter(x => x.op === 'delete').map(x => x.text).join('|');
  test('word edit', () => {
    const s = diffInline(toks('Install the old package and restart.'), toks('Install the new package and reload.'));
    expect(del(s)).toBe('old|restart'); expect(ins(s)).toBe('new|reload');
  });
  test('punctuation only', () => {
    const s = diffInline(toks('the word, here'), toks('the word. here'));
    expect(del(s)).toBe(','); expect(ins(s)).toBe('.');
  });
  test('rewrap is no change', () => {
    expect(diffInline(toks('a b\nc'), toks('a\nb c')).every(x => x.op === 'equal')).toBe(true);
  });
  test('emphasis added is a format change, not a word change', () => {
    const s = diffInline(toks('the package now'), toks('the **package** now'));
    expect(ins(s)).toBe(''); expect(del(s)).toBe('');
    const f = s.find(x => x.text === 'package')!;
    expect(f.fmt).toEqual({ strong: true }); expect(f.oldFmt).toEqual({});
    expect(describeFormat(f.oldFmt!)).toBe('plain');
  });
  test('link url change', () => {
    const f = diffInline(toks('[docs](http://a)'), toks('[docs](http://b)')).find(x => x.text === 'docs')!;
    expect(describeFormat(f.oldFmt!)).toBe('link http://a');
  });
  test('raw diff shows syntax', () => {
    const r = diffRaw('the package', 'the **package**');
    expect(r.filter(x => x.op === 'insert').map(x => x.text)).toEqual(['**', '**']);
  });
  test('raw diff: changed url is one token', () => {
    const r = diffRaw('[d](http://a)', '[d](http://b)');
    expect(r.filter(x => x.op === 'delete').map(x => x.text)).toEqual(['](http://a)']);
  });
  test('raw diff ignores rewrap', () => {
    expect(diffRaw('a b\nc', 'a\nb c').every(x => x.op === 'equal')).toBe(true);
  });
  ```

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat: inline word diff with formatting changes and raw diff`.

---

### Task 4: Table/code diffs + `diffMarkdown` orchestration

**Files:**
- Create: `src/engine/blockDiff.ts`, `src/engine/diff.ts`
- Test: `test/diff.test.ts`, `test/fixtures/` (pairs `<name>.old.md` / `<name>.new.md` as needed)

**Interfaces:**
- Consumes: `parseBlocks`, `align`, `similarity`, `diffInline`, `diffRaw`.
- Produces:
  ```ts
  export interface CodeLine { op: 'equal' | 'insert' | 'delete' | 'modified'; segs: RawSeg[] }   // modified = paired changed line, segs word-diffed
  export function diffCode(a: string, b: string): CodeLine[]
  export type CellDiff = { op: 'equal' | 'pair' | 'insert' | 'delete'; segs: InlineSeg[] };
  export type RowDiff = { op: 'equal' | 'pair' | 'insert' | 'delete'; cells: CellDiff[] };
  export function diffTable(a: InlineToken[][][], b: InlineToken[][][], threshold: number): RowDiff[]   // rows via align(); cells by index; extra cells insert/delete
  export interface DiffBlock {
    id: number;                       // sequential
    status: 'unchanged' | 'modified' | 'inserted' | 'deleted';
    block: Block;                     // new block (old for deleted) — used for kind/containers/marker
    old?: Block;
    inline?: InlineSeg[];             // heading/paragraph (for inserted/deleted: all-insert/all-delete segs)
    code?: CodeLine[];                // code/frontmatter
    table?: RowDiff[];
    raw: RawSeg[];                    // diffRaw(old.source, new.source) or all-insert/all-delete
    markers: string[];                // e.g. 'heading 2 → 3', 'became list item', 'was list item', 'list depth 1 → 2', 'was heading', 'became heading', 'checked', 'unchecked'
  }
  export interface DiffResult { blocks: DiffBlock[]; stats: { changes: number; wordsAdded: number; wordsRemoved: number } }
  export function diffMarkdown(oldMd: string, newMd: string, opts: { threshold: number }): DiffResult
  ```
  `changes` = count of non-unchanged blocks. Words counted from word tokens (letters/digits) in insert/delete segs. A paired block with no inline/code/table changes and no markers but differing `key` (e.g. format-only) is `modified`. Compatible rule from Global Constraints.

- [ ] **Step 1: Write failing tests:**
  ```ts
  const st = (r: DiffResult) => r.blocks.map(b => b.status);
  const T = { threshold: 0.35 };
  test('edited paragraph is modified, not replaced', () => {
    const r = diffMarkdown('# T\n\nThe quick brown fox jumps over the lazy dog.', '# T\n\nThe quick red fox leaps over the lazy dog.', T);
    expect(st(r)).toEqual(['unchanged', 'modified']);
    expect(r.stats).toEqual({ changes: 1, wordsAdded: 2, wordsRemoved: 2 });
  });
  test('rewrapped paragraph unchanged', () => {
    expect(st(diffMarkdown('a b c\nd e', 'a b\nc d e', T))).toEqual(['unchanged']);
  });
  test('inserted and deleted paragraphs', () => {
    expect(st(diffMarkdown('keep\n\nzap zap zap', 'keep\n\nbrand new words', T))).toEqual(['unchanged', 'deleted', 'inserted']);
  });
  test('drastic rewrite pairs at 0.2 but not at 0.6', () => {
    const a = 'one two three four five six', b = 'one two nine ten eleven twelve';
    expect(st(diffMarkdown(a, b, { threshold: 0.2 }))).toEqual(['modified']);
    expect(st(diffMarkdown(a, b, { threshold: 0.6 }))).toEqual(['deleted', 'inserted']);
  });
  test('table cell edit', () => {
    const r = diffMarkdown('| a | b |\n|---|---|\n| c | d |', '| a | b |\n|---|---|\n| c | e |', T);
    expect(st(r)).toEqual(['modified']);
    expect(r.blocks[0].table![1].op).toBe('pair');
    expect(r.blocks[0].table![1].cells[1].segs.map(s => s.op)).toEqual(['delete', 'insert']);
  });
  test('list item edit and reorder', () => {
    const r = diffMarkdown('- alpha one\n- beta two\n- gamma three', '- beta two\n- alpha one changed\n- gamma three', T);
    expect(r.blocks.filter(b => b.status === 'unchanged').length).toBe(2);
    expect(r.blocks.some(b => b.status === 'deleted') && r.blocks.some(b => b.status === 'inserted')).toBe(true);
  });
  test('code block line edit', () => {
    const r = diffMarkdown('```\na = 1\nb = 2\n```', '```\na = 1\nb = 3\n```', T);
    expect(r.blocks[0].code!.map(l => l.op)).toEqual(['equal', 'modified']);
  });
  test('heading level change marker', () => {
    expect(diffMarkdown('## Title', '### Title', T).blocks[0]).toMatchObject({ status: 'modified', markers: ['heading 2 → 3'] });
  });
  test('paragraph became list item', () => {
    expect(diffMarkdown('do the thing now', '- do the thing now', T).blocks[0]).toMatchObject({ status: 'modified', markers: ['became list item'] });
  });
  test('renumbering is unchanged', () => {
    expect(st(diffMarkdown('1. a\n2. b', '3. a\n4. b', T))).toEqual(['unchanged', 'unchanged']);
  });
  test('empty old file → all inserted', () => {
    expect(st(diffMarkdown('', 'a\n\nb', T))).toEqual(['inserted', 'inserted']);
  });
  test('perf: 5000-line drastic rewrite under 1s', () => {
    const para = (i: number, w: string) => `Paragraph ${i} ${w} lorem ipsum dolor sit amet ${i * 7}.`;
    const a = Array.from({ length: 2500 }, (_, i) => para(i, 'alpha')).join('\n\n');
    const b = Array.from({ length: 2500 }, (_, i) => (i % 3 ? para(i, 'beta') : `Totally new text ${i} here`)).join('\n\n');
    const t = performance.now(); diffMarkdown(a, b, T);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  ```
  (Render time is added to the budget in Task 5.)

- [ ] **Step 2: Run** `npx vitest run test/diff.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `diffCode` (`diffLines`, then pair adjacent delete/insert line runs index-by-index → `modified` with `diffRaw`), `diffTable`, `diffMarkdown` (`align` over blocks with `key`, `words` = inline/code/table word texts, compatible rule, threshold).
- [ ] **Step 4: Run** all tests `npx vitest run` — expect PASS.
- [ ] **Step 5: Commit** `feat: diffMarkdown orchestration with table and code diffs`.

---

### Task 5: HTML renderers

**Files:**
- Create: `src/render/escape.ts`, `src/render/rendered.ts`, `src/render/raw.ts`, `media/style.css`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `DiffResult`, `DiffBlock`, `describeFormat`.
- Produces: `escapeHtml(s: string): string`; `renderRendered(r: DiffResult): string`; `renderRaw(r: DiffResult): string`.
- HTML contract (webview in Task 7 relies on it):
  - Every block: `<div class="blk {status}" data-id="{id}">`; non-unchanged blocks also get class `chg`.
  - Word insert: `<ins>…</ins>`; delete: `<del>…</del>`; format change: `<span class="fmt-changed" title="was: {describeFormat(oldFmt)}">…</span>`; markers: `<span class="marker">{text}</span>` at block start.
  - Inline fmt → `<strong>`, `<em>`, `<s>`, `<code>`, `<a href="{url}">` (href escaped, links not followed by the webview), image → `<span class="img">🖼 {alt} <span class="url">{url}</span></span>`.
  - Rendered view wraps consecutive blocks sharing a container chain in real `<ul>`/`<ol start>`/`<blockquote>`; `itemStart` opens a new `<li>`; task items render a disabled checkbox.
  - Code: `<pre class="code"><div class="ln {op}">…</div>…</pre>`; html blocks and frontmatter render as escaped code.
  - Raw view: `<pre class="raw">` per block, `marker` + raw segs, heading `#`s included via source.

- [ ] **Step 1: Write failing tests:**
  ```ts
  const R = (a: string, b: string) => diffMarkdown(a, b, { threshold: 0.35 });
  test('ins/del marks', () => {
    const h = renderRendered(R('the old pkg', 'the new pkg'));
    expect(h).toContain('<del>old</del>'); expect(h).toContain('<ins>new</ins>');
    expect(h).toContain('class="blk modified chg"');
  });
  test('format change marker', () => {
    expect(renderRendered(R('the package', 'the **package**'))).toContain('<span class="fmt-changed" title="was: plain"><strong>package</strong></span>');
  });
  test('html in doc is escaped', () => {
    const h = renderRendered(R('', '<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>'));
    expect(h).not.toContain('<script>'); expect(h).not.toContain('<img');
    expect(h).toContain('&lt;script&gt;');
    expect(renderRaw(R('', '<script>x</script>'))).not.toContain('<script>');
  });
  test('lists rebuild real wrappers', () => {
    const h = renderRendered(R('', '3. a\n4. b'));
    expect(h).toMatch(/<ol start="3">[\s\S]*<li>[\s\S]*<li>[\s\S]*<\/ol>/);
  });
  test('raw shows syntax tokens', () => {
    expect(renderRaw(R('the package', 'the **package**'))).toContain('<ins>**</ins>');
  });
  test('image not loaded', () => {
    expect(renderRendered(R('', '![cat](c.png)'))).not.toContain('<img');
  });
  test('perf: render 5000-line diff within total budget', () => { /* same inputs as Task 4 perf test; diff + both renders < 1000 ms */ });
  ```
  (Fill the perf test with the Task 4 generator, measuring `diffMarkdown` + `renderRendered` + `renderRaw` together.)

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** renderers per the HTML contract; `style.css` with the Global Constraints colors (`ins` green bg, `del` red bg + line-through, `.fmt-changed` `text-decoration: underline dotted #d29922`, `.blk.inserted`/`.deleted` left bar 3px + bg, `.ln.*` line bgs).
- [ ] **Step 4: Run** `npx vitest run` — expect PASS.
- [ ] **Step 5: Commit** `feat: rendered and raw HTML renderers`.

---

### Task 6: Git helpers

**Files:**
- Create: `src/vscode/git.ts` (no `vscode` import — testable)
- Test: `test/git.test.ts` (creates temp repos with real `git` in `os.tmpdir()`)

**Interfaces:**
- Produces:
  ```ts
  export class GitError extends Error {}
  export function repoRoot(filePath: string): Promise<string>                          // GitError('Not in a git repository: {filePath}')
  export function verifyRev(root: string, rev: string): Promise<string>                // full hash; GitError('Unknown revision: {rev}')
  export function showFile(root: string, rev: string, relPath: string): Promise<string> // GitError('{relPath} does not exist at {rev}')
  export interface RefItem { kind: 'branch' | 'remote' | 'tag' | 'commit'; rev: string; label: string; description: string }
  export function listRefs(root: string, relPath: string): Promise<RefItem[]>          // branches, remotes, tags, then last 50 commits touching relPath: label = short hash, description = 'YYYY-MM-DD subject'
  ```
  All via `execFile('git', args, { cwd: root, maxBuffer: 64 MiB })`; `relPath` posix-style relative to root.

- [ ] **Step 1: Write failing tests:** temp repo with `a.md` committed twice on `main`, tag `v1` on first commit. Assert: `showFile(root,'v1','a.md')` equals first content; `showFile(root,'HEAD','missing.md')` rejects with message `missing.md does not exist at HEAD`; `verifyRev(root,'nope')` rejects `Unknown revision: nope`; `repoRoot` of a non-repo temp dir rejects matching `/Not in a git repository/`; `listRefs` contains `{kind:'branch',rev:'main'}`, `{kind:'tag',rev:'v1'}`, and 2 `commit` items.
- [ ] **Step 2: Run** `npx vitest run test/git.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat: git helpers for revisions and file contents`.

---

### Task 7: Webview panel + toolbar

**Files:**
- Create: `src/vscode/panel.ts`, `media/webview.ts`
- Modify: `media/style.css` (toolbar)

**Interfaces:**
- Consumes: `diffMarkdown`, `renderRendered`, `renderRaw`.
- Produces:
  ```ts
  export interface PanelSource { label: string; getOld(): Promise<string>; getNew(): string | Promise<string>; liveDoc?: vscode.TextDocument }
  export function openDiffPanel(ctx: vscode.ExtensionContext, title: string, src: PanelSource): void
  ```
  Messages ext→webview: `{ type: 'render', rendered: string, raw: string, stats, label, pairing: 'loose'|'normal'|'strict' }`. webview→ext: `{ type: 'pairing', value: 'loose'|'normal'|'strict' }`. Webview persists `view` (rendered/raw), `hideUnchanged`, `scrollY` via `vscode.setState`.

- [ ] **Step 1: Implement `openDiffPanel`.** Title `{fileName} ↔ {label}`; CSP `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-…'; img-src 'none'`; loads `dist/webview.js` and `media/style.css`. Threshold from `pairing` (loose 0.2 / normal = `mdWordDiff.pairingThreshold` / strict 0.6). If `liveDoc`, subscribe `onDidChangeTextDocument` for that doc, debounce 300 ms, re-render. Dispose listener with panel. Errors from `getOld` → `vscode.window.showErrorMessage(err.message)` and close panel.
- [ ] **Step 2: Implement `media/webview.ts`.** Sticky toolbar: `[Rendered|Raw]` toggle, label `old → new`, stats `N changes · +A / −R words`, `Pairing: Loose · Normal · Strict` segmented control (posts message), `▲ Prev`/`▼ Next` (scroll to previous/next `.chg` in visible view, highlight briefly), `Alt+ArrowUp`/`Alt+ArrowDown` keys do the same, `Hide unchanged` checkbox (collapse runs of ≥2 consecutive `.blk.unchanged` into a clickable `… N unchanged blocks …` row). On re-render restore `scrollY`. Links: `preventDefault` on `<a>` clicks.
- [ ] **Step 3: Build** `npm run build` — expect exit 0, `dist/extension.js` and `dist/webview.js` exist.
- [ ] **Step 4: Commit** `feat: diff webview panel with toolbar and live update`.

(Verified manually in Task 8; the logic it drives is covered by Tasks 1–6.)

---

### Task 8: Commands, picker, packaging, README

**Files:**
- Create: `src/vscode/picker.ts`, `src/vscode/extension.ts`, `README.md`
- Modify: `package.json` (`contributes`)

**Interfaces:**
- Consumes: `git.ts`, `openDiffPanel`.
- Produces: `pickRevision(root: string, relPath: string, title: string): Promise<string | undefined>` (verified rev or undefined).

- [ ] **Step 1: `package.json` contributes.** Commands `mdWordDiff.compareWithRevision` ("Markdown Word Diff: Compare with Revision…") and `mdWordDiff.compareTwoRevisions` ("Markdown Word Diff: Compare Two Revisions…"); menus `explorer/context`, `editor/context`, `editor/title/context` with `when: resourceLangId == markdown`; configuration `mdWordDiff.pairingThreshold` (`type: number, default: 0.35, minimum: 0, maximum: 1`, description explaining lower = more paragraphs treated as edits). `activationEvents` empty (commands auto-activate).
- [ ] **Step 2: Implement `pickRevision`.** QuickPick with separators Branches / Remote branches / Tags / Commits touching this file; typed text with no matching item is accepted as a rev; run `verifyRev`, show error and return undefined on failure.
- [ ] **Step 3: Implement commands.** Resolve file from command arg URI or active editor; reject non-markdown with a message. Compare with Revision: old = `showFile(rev)`, new = open document text (unsaved included) else disk, `liveDoc` set when open. Compare Two Revisions: pick A ("old") then B ("new"), no live update. Label = rev as typed/selected.
- [ ] **Step 4: README** — install (`npm install && npm run build && npm run package && code --install-extension md-word-diff-*.vsix`), usage, the setting and the toolbar pairing control.
- [ ] **Step 5: Package & install.** `npm run build && npx vitest run && npm run package` — expect tests PASS and `md-word-diff-0.0.1.vsix` created. `code --install-extension md-word-diff-0.0.1.vsix` — expect "successfully installed".
- [ ] **Step 6: Manual check** in a scratch repo with a committed markdown doc, then edits (word edit, rewrap, bold a word, change link URL, edit table cell, reorder list items, add paragraph): run Compare with Revision → `HEAD`; confirm each change shows as spec'd, toggle Raw, Prev/Next and Alt+↑/↓, Hide unchanged, Pairing Loose/Strict changes pairing, typing in editor updates within ~300 ms, compare against a rev where file is missing shows the error.
- [ ] **Step 7: Commit** `feat: commands, revision picker, packaging and README`.
