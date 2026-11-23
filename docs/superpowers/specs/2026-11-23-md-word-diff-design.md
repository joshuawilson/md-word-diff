# Markdown Word Diff — VSCode extension design

Date: 2026-11-23
Status: approved 2026-11-23

## Intent

The user compares older versions of markdown documents with updated ones and
wants to see exactly what changed, word by word. Existing VSCode tools (built-in
diff with tuned settings, GitDiff, Rich Markdown Diff, SemanticDiff) are
line-oriented: when a paragraph is edited, especially a long single-line
paragraph or a re-wrapped one, they report "these lines replaced those lines"
instead of showing the few words that changed. Tuning the built-in diff
settings did not help.

Success: open a comparison against any git revision or branch and read the
document with each edit shown as word-level insertions and deletions, in place.

## Goals

- Compare a markdown file against any git revision (branch, tag, commit,
  any rev expression like `HEAD~3`).
- Word-level changes inside edited blocks. An edited paragraph shows as edits,
  never as delete-whole-paragraph + insert-whole-paragraph.
- Line breaks inside a paragraph are ignored (re-wrapping is not a change).
- Two views, toggled: **Rendered** (default) and **Raw** markdown source.
- One inline pane: deletions red + strikethrough, insertions green.

## Non-goals

- Side-by-side layout.
- Publishing to the VSCode marketplace (install locally from `.vsix`).
- Editing, merging, or accepting/rejecting changes from the diff view.
- Non-markdown files.
- Following file renames across history (if `git show rev:path` fails, show a
  clear error).
- Move detection (a moved block shows as a deletion plus an insertion).

## Anti-goals (fail even if it "works")

- An edited paragraph rendered as fully replaced when most words are shared.
- Diff marks breaking markdown rendering (broken tables, links, code blocks,
  literal `<ins>` tags visible in the rendered view).
- Slow enough on long docs that the user goes back to the built-in diff.

## Constraints

- VSCode 1.133 on Linux (Fedora); Node 22; git 2.55 CLI available.
- Personal tool: simplicity and maintainability over features.

## Approaches considered

Choice of **how the rendered redline is produced**:

- **A. Diff source text, inject marks, render.** Simplest, but marks landing
  inside table pipes, link URLs or code fences break rendering. Rejected:
  conflicts with an anti-goal.
- **B. Render both to HTML, diff the HTML.** Keeps structure valid, but HTML
  diff libraries degrade to whole-block replacement on table cells and nested
  lists — the original problem. Rejected.
- **C. Block-by-block (chosen by user).** Parse each version into blocks, pair
  old blocks to new blocks by similarity, word-diff inside each pair, render
  each block with marks placed only around text, never inside syntax.

Layout: inline one pane (chosen) over side-by-side or both.
Views: Rendered + Raw with toggle (chosen).

## Decided by the user

- Build a custom extension rather than fork an existing one.
- Both views with a toggle; Rendered is the default.
- Inline, single pane.
- Block-by-block approach (C).
- Formatting-only changes shown as a hover marker (B), not as old+new.

## Design

### Commands and entry points

- **Markdown Word Diff: Compare with Revision…** — Command Palette, and
  right-click on a `.md` file in the Explorer and in the editor (title bar /
  context menu). Compares the chosen revision (old) with the current editor
  text (new), including unsaved edits; if the file is not open, the file on disk.
- **Markdown Word Diff: Compare Two Revisions…** — pick revision A (old), then
  B (new). (Claude's proposal; cheap to add.)

Revision picker (QuickPick): local branches, remote branches, tags, and the
last 50 commits that touched the file (`short-hash  date  subject`). Free-text
entry accepted as a rev expression; validated with `git rev-parse --verify`.

### Git access

`child_process.execFile('git', ...)`, run in the file's repo root
(`git rev-parse --show-toplevel`). Old text via `git show <rev>:<repo-relative-path>`.
Errors (not a repo, path missing at that rev, bad rev) shown as a VSCode error
message naming the rev and path.

### Diff engine (pure module, no VSCode imports, unit-tested)

1. **Parse** each version into a flat list of blocks using a markdown parser with
   GFM support and source positions. Block kinds: heading, paragraph,
   list item (with nesting depth; nested items are their own blocks),
   blockquote paragraph, table (with rows and cells), code block (fenced or
   indented, with info string), thematic break, HTML block, YAML front matter
   (treated as a code block).
   Each block carries its container context (Claude's call): chain of
   containers (list type ordered/bullet, start number, list depth, blockquote
   depth), so the renderer rebuilds real `<ul>`/`<ol>`/`<blockquote>` wrappers
   around consecutive blocks. A list item with several paragraphs or a nested
   code block becomes several blocks sharing that item's context. Ordered-list
   renumbering alone is not a change.
2. **Normalize** text blocks: collapse internal whitespace and soft line breaks
   to single spaces before comparing.
3. **Pair blocks:**
   - First anchor exact matches (same kind + same normalized text) with an LCS
     over the block sequences — these are unchanged.
   - In each gap between anchors, pair remaining old/new blocks of compatible
     kind by word similarity (shared-word ratio ≥ threshold). Pairs never cross
     (Claude's call): pairing is an order-preserving alignment inside the gap
     (e.g. DP maximizing total similarity), so output order is unambiguous and
     follows new-document order with deletions placed where they were. A
     reordered block therefore shows as deletion + insertion (consistent with
     move detection being a non-goal). Unpaired blocks are whole insertions or
     deletions.
   - Compatible kinds (Claude's call): paragraph, list item and blockquote
     paragraph pair with each other, so "paragraph became a bullet" shows as a
     word diff plus a block-kind marker. Heading pairs with heading or
     paragraph. Code with code. Table with table. Others only with same kind.
   - The similarity threshold is a setting (`mdWordDiff.pairingThreshold`,
     number 0–1, default **0.35** — user's docs often have drastic rewrites,
     user approved). Overridable per comparison from the toolbar (below).
4. **Diff inside pairs:**
   - Text blocks: token-level diff where tokens are words, whitespace, and
     punctuation; inline syntax units that must not be split (link/image
     destination, inline code span, autolink, HTML inline tag) are atomic
     tokens; emphasis delimiters (`*`, `**`, `_`, `~~`) are their own tokens
     in the Raw view, where a changed link URL marks the whole link as
     changed. The Rendered view diffs visible text and reports formatting
     changes separately (see Rendering).
   - Tables: pair rows (same LCS+similarity method), then word-diff cell by cell.
     Added/removed columns: show the cells as inserted/deleted.
   - Code blocks: line-level diff with word highlights within changed lines;
     no whitespace normalization.
   - Heading level change or list-item depth change counts as a change even if
     text is identical (shown as a small marker on the block).
5. **Output:** an ordered list of diff blocks, each with kind, status
   (unchanged / modified / inserted / deleted), and token segments
   (equal / insert / delete), plus source text for the Raw view.

### Rendering (webview)

- **Rendered view:** each diff block rendered to HTML with a markdown renderer
  (GFM tables, task lists). Marks are applied as `<del>`/`<ins>` around text
  token runs only, after parsing inline structure, so they never land inside
  syntax. Whole inserted/deleted blocks get a green/red left bar and
  background. Code blocks render as `<pre>` with per-line marks.
- **Raw view:** each block's markdown source in monospace with the same
  token marks; unchanged blocks shown plain.
- **Formatting-only changes (user decision: marker).** When words are the
  same but inline formatting differs — emphasis/strong/strikethrough added or
  removed, inline code toggled, link or image URL changed, link text unchanged
  — the Rendered view renders the *new* version with a dotted amber underline
  (`<span class="fmt-changed" title="was: …">`). Tooltip shows the old form
  in words or source (e.g. `was: plain`, `was: https://old-url`). Word
  insertions/deletions keep red/green; a run can carry both (e.g. inserted
  word inside a newly bolded phrase → green inside amber). The diff engine
  therefore emits, for text blocks, a word-level diff over *visible text* plus
  a separate list of formatting-change spans (ranges in the new text with the
  old formatting description), computed by comparing the inline formatting
  attached to equal text tokens. Deleted text is rendered with the old
  formatting it had, inside `<del>`. The Raw view shows the syntax tokens
  (`**`, `](url)`) as ordinary insert/delete marks.
- Images: show alt text + URL, don't load (avoids CSP/path issues). Builder may
  render local images if trivial.
- Colors from VSCode theme variables (`--vscode-diffEditor-insertedTextBackground`,
  `--vscode-diffEditor-removedTextBackground`) so it fits light/dark themes.
  Strikethrough on deletions regardless of theme.
- Strict CSP, no remote resources, scripts only from the extension.

### Toolbar (top of webview, sticky)

`[Rendered | Raw]` toggle · `old rev → new rev` label · change count summary
(e.g. `12 changes · +84 / −51 words`) · `▲ Prev` / `▼ Next` change buttons
(also keybindings while the panel is focused: `Alt+↑` / `Alt+↓`) ·
option "Hide unchanged" collapsing runs of unchanged blocks to
`… 14 unchanged blocks …` (click to expand). Default: show everything. ·
`Pairing: Loose · Normal · Strict` control (user approved): Loose = 0.2,
Normal = the `mdWordDiff.pairingThreshold` setting value, Strict = 0.6.
Changing it re-runs the diff immediately for this panel only and preserves
scroll position as best it can; the setting itself is not modified. Starts
at Normal.

### Live update

When comparing against the editor, re-diff on document change (debounced
~300 ms) and preserve scroll position. Panel title: `foo.md ↔ main`.

## Performance target

A 5,000-line document diffs and renders in under 1 second.

## Packaging and project

- New git repo at `~/git/md-word-diff`.
- TypeScript, bundled with esbuild; packaged with `vsce package` into a
  `.vsix`, installed with `code --install-extension`.
- Libraries: builder's choice, suggested `jsdiff` (`diff` package) for token
  diffs; a markdown parser with positions and GFM (e.g. remark/mdast or
  markdown-it) — builder picks one parser and uses it for both parsing and
  rendering if possible.
- Tests: unit tests for the diff engine with markdown fixture pairs covering
  edited paragraph, re-wrapped paragraph, inserted/deleted paragraph, table
  cell edit, list item edit and reorder, link URL change, emphasis added,
  code block edit, heading level change.
- README with install and usage.

## Left to the builder

- Exact parser/renderer library and tokenizer implementation.
- Similarity metric details beyond the threshold setting.
- Webview styling details, icons, exact toolbar layout.
- Test framework.

## Addendum 2026-11-23: grouping and new-first order (user approved)

- **Grouping.** Display-only merge of nearby word changes. Between two change
  runs, an unchanged stretch of at most N words (spaces/punctuation don't count)
  is absorbed: shown once in the inserted text and once in the deleted text.
  Toolbar control `Grouping: Off · 1 word · 2 words` (re-diffs instantly, panel
  only); setting `mdWordDiff.grouping` (`off` | `1` | `2`, default `1`).
  Applies to paragraph/heading text, table cells, Raw view and changed code
  lines. Unchanged stretches carrying a formatting change are never absorbed.
  Toolbar word counts are computed before grouping (absorbed words don't count).
- **New first.** Everywhere a change shows both versions, the new version comes
  first, then the struck-through old one: within text, within code lines, for
  table rows, and for whole blocks (inserted paragraph above the deleted one it
  replaced).

## Addendum 2026-11-23 (2): moves (user approved, supersedes the "move detection" non-goal)

- Identical runs anchor the alignment only when they carry at least 8 words; shorter
  ones (an image line, a short heading) are matched with their neighbours, maximizing
  total shared words, so a small moved block can't block an edit from pairing.
- **Move pass.** After the in-order alignment, leftover deleted and inserted blocks
  anywhere in the document are matched by shared words (compatible kinds,
  similarity ≥ threshold, exact copies included), highest overlap first. A matched
  pair shows at its **new** position as a modified block with the label
  `moved from above` / `moved from below` and the usual word marks; the old position
  keeps a small stub (`↓ moved below` / `↑ moved above`) that jumps to it. The stub
  is not counted as a separate change.
- Matching runs globally: identical runs with >= 8 words anchor; every other block is
  matched by shared words, most first; the heaviest order-preserving set stays in place
  and the rest are moves. Falls back to in-order alignment + leftover move pass when
  there are too many candidates.
- Default `mdWordDiff.pairingThreshold` stays **0.35** (Normal); 0.30 was tried on the
  user's chapter and added false pairs. Loose 0.2, Strict 0.6.

## Addendum 2026-11-23 (3): manual pairing (user approved)

Word matching can't see paraphrase (a paragraph rewritten sentence by sentence), so the
user can pair blocks by hand. Blocks with an old side (deleted, moved stubs, modified)
show a **Pair with…** button; clicking it enters pick mode (banner, Esc cancels) where
compatible blocks with a new side (text↔text, code↔code, table↔table) are clickable.
The chosen pair is diffed word by word at the new block's position, labelled
`paired manually`, with an **Unpair** link. Partners previously matched to either block
are released and re-matched. Manual pairs are kept per panel (by old/new block index),
survive Grouping/Pairing changes and live edits, and are dropped if an index no longer
exists or the kinds are incompatible. Engine: `diffMarkdown(..., { forced: [oldIdx, newIdx][] })`.

## Addendum 2026-11-23 (4): line breaks (user approved; replaces "line breaks inside a paragraph are not a change")

- Line breaks inside paragraphs are **kept by default**: shown as line breaks and compared
  (a re-wrap is a change). Hard breaks (`\` or two trailing spaces) are always kept.
- **Ignore line wrap** switch (toolbar checkbox + setting `mdWordDiff.ignoreLineWrap`,
  default `false`): when on, soft-wrapped lines inside a paragraph compare and display as
  spaces (the previous behavior). Hard breaks are still kept.
- Manual pairing may pair a code block with text (either direction); they are compared
  as plain text, line by line. Tables still pair only with tables.

## Addendum 2026-11-23 (5): unpair automatic pairs (user approved)

Automatic pairs (edited or moved blocks) get an **Unpair** button beside **Pair with…**.
Unpairing shows both blocks as deleted + inserted and keeps both out of automatic matching
(they can still be paired by hand; a manual pair wins). Engine:
`diffMarkdown(..., { unpaired: [oldIdx, newIdx][] })`. Kept per panel like manual pairs;
the toolbar **Clear** resets manual pairs and unpairs together.
