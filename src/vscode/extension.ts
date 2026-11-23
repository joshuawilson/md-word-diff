import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { locate, showFile } from './git';
import { openDiffPanel } from './panel';
import { pickRevision } from './picker';

interface Target {
  uri: vscode.Uri;
  root: string;
  relPath: string;
}

async function resolveTarget(arg: unknown): Promise<Target | undefined> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Markdown Word Diff: open or select a markdown file first.');
    return undefined;
  }
  if (!/\.(md|markdown|mdx?)$/i.test(uri.fsPath)) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (doc?.languageId !== 'markdown') {
      void vscode.window.showErrorMessage(`Markdown Word Diff only compares markdown files: ${path.basename(uri.fsPath)}`);
      return undefined;
    }
  }
  try {
    const { root, relPath } = await locate(uri.fsPath);
    return { uri, root, relPath };
  } catch (err) {
    void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

async function compareWithRevision(ctx: vscode.ExtensionContext, arg: unknown): Promise<void> {
  const t = await resolveTarget(arg);
  if (!t) return;
  const rev = await pickRevision(t.root, t.relPath, `Compare ${path.basename(t.relPath)} with revision`);
  if (!rev) return;
  const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === t.uri.toString());
  openDiffPanel(ctx, `${path.basename(t.relPath)} ↔ ${rev}`, {
    label: rev,
    newLabel: 'working copy',
    getOld: () => showFile(t.root, rev, t.relPath),
    getNew: () => (openDoc && !openDoc.isClosed ? openDoc.getText() : readFile(t.uri.fsPath, 'utf8')),
    liveDoc: openDoc,
  });
}

async function compareTwoRevisions(ctx: vscode.ExtensionContext, arg: unknown): Promise<void> {
  const t = await resolveTarget(arg);
  if (!t) return;
  const name = path.basename(t.relPath);
  const a = await pickRevision(t.root, t.relPath, `${name}: pick the OLD revision (A)`);
  if (!a) return;
  const b = await pickRevision(t.root, t.relPath, `${name}: pick the NEW revision (B)`);
  if (!b) return;
  openDiffPanel(ctx, `${name} ${a} ↔ ${b}`, {
    label: a,
    newLabel: b,
    getOld: () => showFile(t.root, a, t.relPath),
    getNew: () => showFile(t.root, b, t.relPath),
  });
}

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mdWordDiff.compareWithRevision', (arg: unknown) => compareWithRevision(ctx, arg)),
    vscode.commands.registerCommand('mdWordDiff.compareTwoRevisions', (arg: unknown) => compareTwoRevisions(ctx, arg)),
  );
}

export function deactivate(): void {}
