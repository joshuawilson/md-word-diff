# Markdown Word Diff

VSCode extension that compares a markdown file against a git revision and shows an
inline, word-by-word redline — edited paragraphs show as edits, not as
"these lines replaced those lines". Line breaks are kept and compared; turn on
**Ignore line wrap** to treat re-wrapped text as unchanged.

## Install

```bash
npm install
npm run build
npm run package          # creates md-word-diff-0.0.1.vsix
code --install-extension md-word-diff-0.0.1.vsix
```

Reload VSCode after installing (Command Palette → "Developer: Reload Window").

## Use

Right-click a `.md` file (Explorer, editor, or editor tab), or use the Command Palette:

- **Markdown Word Diff: Compare with Revision…** — pick a branch, tag or commit
  (or type any revision such as `HEAD~3`, `v1.2`, `origin/main`). Compares it with the
  current file, including unsaved edits; the view updates as you type.
- **Markdown Word Diff: Compare Two Revisions…** — pick an old revision (A), then a new one (B).

In the panel:

| Control | What it does |
|---|---|
| **Rendered / Raw** | Formatted document, or markdown source with the same marks |
| **Pairing: Loose · Normal · Strict** | How readily a rewritten paragraph counts as an *edit* (word marks) vs. a whole deletion + insertion. Use **Loose** for drastic rewrites. |
| **Grouping: Off · 1 word · 2 words** | Merge nearby word changes into one block: new text first, then the old text struck through. Off = every changed word separately. |
| **▲ Prev / ▼ Next** (`Alt+↑` / `Alt+↓`) | Jump between changes |
| **Ignore line wrap** | Off (default): line breaks inside paragraphs are shown and compared. On: wrapped lines count as spaces, so re-wrapping isn't a change. Deliberate breaks (trailing `\` or two spaces) are always kept. |
| **Hide unchanged** | Fold runs of unchanged blocks |
| **Pair with…** (hover a deleted, moved or modified block) | Pick the new block it became; the two are compared word by word. Use it when a paragraph was reworded so much that automatic matching can't tell. **Unpair** undoes it. |
| **Unpair** (hover an automatically paired or moved block) | The two blocks don't belong together: show them as deleted + inserted and keep them out of automatic matching. **Clear** in the toolbar resets manual pairs and unpairs. |

Marks: <ins>green</ins> = added, followed by <del>red strikethrough</del> = removed (new text always comes first), dotted amber
underline = formatting-only change (hover to see what it was, e.g. `was: plain`,
`was: link https://old-url`). Labels like `heading 2 → 3` or `became list item` flag
structural changes. A block that moved shows at its new position labelled `moved from above/below`,
with a small `↓ moved below` / `↑ moved above` link left at its old spot.

## Settings

`mdWordDiff.ignoreLineWrap` (default `false`): treat wrapped lines inside paragraphs as spaces.

`mdWordDiff.grouping` (default `1`): `off`, `1` or `2` — how many unchanged words between two changes get absorbed so the changes show as one block. Word counts in the toolbar always count real word changes.

`mdWordDiff.pairingThreshold` (default `0.35`): share of words two blocks must have in
common to be paired as an edit. Lower it if heavy rewrites show up as whole
deletions + insertions; raise it if unrelated paragraphs get paired. The toolbar's
**Normal** uses this value; **Loose** = 0.2, **Strict** = 0.6.

## Develop

```bash
npm test          # engine, renderer and git tests (vitest)
npm run typecheck
```

Engine (`src/engine/`) and renderer (`src/render/`) have no VSCode dependency.
Design: `docs/superpowers/specs/2026-11-23-md-word-diff-design.md`.
