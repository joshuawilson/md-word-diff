# Markdown Word Diff

VSCode extension that compares a markdown file against a git revision and shows an
inline, word-by-word redline — edited paragraphs show as edits, not as
"these lines replaced those lines". Re-wrapping text is not a change.

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
| **▲ Prev / ▼ Next** (`Alt+↑` / `Alt+↓`) | Jump between changes |
| **Hide unchanged** | Fold runs of unchanged blocks |

Marks: <del>red strikethrough</del> = removed, <ins>green</ins> = added, dotted amber
underline = formatting-only change (hover to see what it was, e.g. `was: plain`,
`was: link https://old-url`). Labels like `heading 2 → 3` or `became list item` flag
structural changes. Reordered paragraphs show as deleted in the old spot and inserted in the new one.

## Setting

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
