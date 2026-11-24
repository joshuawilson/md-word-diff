import * as vscode from 'vscode';
import { refOf, resolvePairs, type BlockRef, type SavedPair } from '../engine/anchors';
import { diffMarkdown } from '../engine/diff';
import { parseBlocks } from '../engine/parse';
import type { Block } from '../engine/types';
import { renderRaw } from '../render/raw';
import { renderRendered } from '../render/rendered';
import type { Grouping } from '../engine/group';

export type Pairing = 'loose' | 'normal' | 'strict';

export interface PanelSource {
  /** Label of the old side, e.g. 'main' or 'v1.2'. */
  label: string;
  /** Label of the new side, e.g. 'working copy' or a revision. */
  newLabel: string;
  getOld(): Promise<string>;
  getNew(): string | Promise<string>;
  /** When set, re-diff as this document changes. */
  liveDoc?: vscode.TextDocument;
  /** File to open when a new-side line number is clicked (working-copy comparisons). */
  revealUri?: vscode.Uri;
  /** Workspace-state key under which manual pairs and unpairs are saved for this comparison. */
  storeKey?: string;
}

interface Stored {
  forced: SavedPair[];
  unpaired: SavedPair[];
}

const sameRef = (a: BlockRef, b: BlockRef) => a.text === b.text && a.nth === b.nth;

const LOOSE = 0.2;
const STRICT = 0.6;

function thresholdFor(p: Pairing): number {
  if (p === 'loose') return LOOSE;
  if (p === 'strict') return STRICT;
  const v = vscode.workspace.getConfiguration('mdWordDiff').get<number>('pairingThreshold', 0.35);
  return Math.min(1, Math.max(0, v));
}

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function shellHtml(webview: vscode.Webview, extUri: vscode.Uri): string {
  const n = nonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'style.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'dist', 'webview.js'));
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; img-src 'none'; font-src ${webview.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head><body>
<div id="toolbar">
  <span class="seg" id="view"><button data-v="rendered" class="on">Rendered</button><button data-v="raw">Raw</button></span>
  <span id="label"></span>
  <span id="stats"></span>
  Pairing: <span class="seg" id="pairing" title="How similar two blocks must be to count as an edit (Loose pairs heavy rewrites)"><button data-p="loose">Loose</button><button data-p="normal" class="on">Normal</button><button data-p="strict">Strict</button></span>
  Grouping: <span class="seg" id="grouping" title="Merge nearby word changes: new text first, then old text struck through"><button data-g="off">Off</button><button data-g="1">1 word</button><button data-g="2">2 words</button></span>
  <button id="prev" title="Previous change (Alt+↑)">▲ Prev</button>
  <button id="next" title="Next change (Alt+↓)">▼ Next</button>
  <label title="Treat wrapped lines inside a paragraph as spaces (deliberate line breaks are kept)"><input type="checkbox" id="ignore-wrap"> Ignore line wrap</label>
  <label><input type="checkbox" id="hide"> Hide unchanged</label>
  <span id="manual" class="view-hidden"><span id="manual-count"></span> <button id="clear-pairs" title="Remove all manual pairs and unpairs saved for this file and revision">Clear</button></span>
</div>
<div id="pick-banner" class="view-hidden">Click the new block to compare with the selected old block · <button id="pick-cancel">Cancel (Esc)</button></div>
<div id="doc"><div id="rendered"></div><div id="raw" class="view-hidden"></div></div>
<script nonce="${n}" src="${js}"></script>
</body></html>`;
}

/** Open a webview showing the word diff between src.getOld() and src.getNew(). */
export function openDiffPanel(ctx: vscode.ExtensionContext, title: string, src: PanelSource): void {
  const panel = vscode.window.createWebviewPanel('mdWordDiff', title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    enableFindWidget: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media'), vscode.Uri.joinPath(ctx.extensionUri, 'dist')],
  });
  panel.webview.html = shellHtml(panel.webview, ctx.extensionUri);

  let pairing: Pairing = 'normal';
  const cfg = vscode.workspace.getConfiguration('mdWordDiff').get<string>('grouping', '1');
  let grouping: Grouping = cfg === 'off' || cfg === '2' ? cfg : '1';
  let ignoreWrap = vscode.workspace.getConfiguration('mdWordDiff').get<boolean>('ignoreLineWrap', false);
  let oldText: string | undefined;
  let ready = false;
  // Manual pairs and broken-apart automatic pairs, saved by block text so they survive edits,
  // closing the panel and reloading VSCode.
  const stored = (src.storeKey && ctx.workspaceState.get<Stored>(src.storeKey)) || { forced: [], unpaired: [] };
  let savedForced: SavedPair[] = stored.forced ?? [];
  let savedUnpaired: SavedPair[] = stored.unpaired ?? [];
  let lastOld: Block[] = [];
  let lastNew: Block[] = [];
  let persisted = JSON.stringify({ forced: savedForced, unpaired: savedUnpaired });
  const persist = () => {
    const now = JSON.stringify({ forced: savedForced, unpaired: savedUnpaired });
    if (!src.storeKey || now === persisted) return;
    persisted = now;
    const empty = !savedForced.length && !savedUnpaired.length;
    void ctx.workspaceState.update(src.storeKey, empty ? undefined : { forced: savedForced, unpaired: savedUnpaired });
  };
  const pairOf = (oi: number, ni: number): SavedPair | undefined =>
    lastOld[oi] && lastNew[ni] ? { old: refOf(lastOld, oi), new: refOf(lastNew, ni) } : undefined;
  const disposables: vscode.Disposable[] = [];

  const render = async () => {
    if (!ready) return;
    try {
      oldText ??= await src.getOld();
      const newText = await src.getNew();
      lastOld = parseBlocks(oldText, { ignoreWrap });
      lastNew = parseBlocks(newText, { ignoreWrap });
      const rf = resolvePairs(savedForced, lastOld, lastNew);
      const ru = resolvePairs(savedUnpaired, lastOld, lastNew);
      savedForced = rf.saved;
      savedUnpaired = ru.saved;
      persist();
      const result = diffMarkdown(oldText, newText, {
        threshold: thresholdFor(pairing),
        grouping,
        forced: rf.pairs,
        unpaired: ru.pairs,
        ignoreWrap,
      });
      void panel.webview.postMessage({
        type: 'render',
        rendered: renderRendered(result),
        raw: renderRaw(result),
        stats: result.stats,
        label: `${src.label} → ${src.newLabel}`,
        pairing,
        grouping,
        ignoreWrap,
        manualPairs: result.blocks.filter(b => b.forced).length,
        unpairs: ru.pairs.length,
        lost: rf.lost + ru.lost,
        canReveal: !!src.revealUri,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      panel.dispose();
    }
  };

  disposables.push(
    panel.webview.onDidReceiveMessage((msg: { type: string; value?: string | boolean; oi?: number; ni?: number; line?: number }) => {
      if (msg.type === 'reveal' && src.revealUri && Number.isInteger(msg.line) && msg.line! >= 1) {
        const pos = new vscode.Position(msg.line! - 1, 0);
        const uri = src.revealUri.toString();
        const shown = vscode.window.visibleTextEditors.find(ed => ed.document.uri.toString() === uri);
        void vscode.window.showTextDocument(src.revealUri, {
          viewColumn: shown?.viewColumn ?? vscode.ViewColumn.One,
          selection: new vscode.Range(pos, pos),
        });
      } else if (msg.type === 'ready') {
        ready = true;
        void render();
      } else if (msg.type === 'pairing' && (msg.value === 'loose' || msg.value === 'normal' || msg.value === 'strict')) {
        pairing = msg.value;
        void render();
      } else if (msg.type === 'grouping' && (msg.value === 'off' || msg.value === '1' || msg.value === '2')) {
        grouping = msg.value;
        void render();
      } else if (msg.type === 'forcePair' && Number.isInteger(msg.oi) && Number.isInteger(msg.ni)) {
        const p = pairOf(msg.oi!, msg.ni!);
        if (!p) return;
        savedForced = savedForced.filter(s => !sameRef(s.old, p.old) && !sameRef(s.new, p.new));
        savedForced.push(p);
        void render();
      } else if (msg.type === 'unpair' && Number.isInteger(msg.oi) && lastOld[msg.oi!]) {
        const ref = refOf(lastOld, msg.oi!);
        savedForced = savedForced.filter(s => !sameRef(s.old, ref));
        void render();
      } else if (msg.type === 'ignoreWrap' && typeof msg.value === 'boolean') {
        ignoreWrap = msg.value;
        void render();
      } else if (msg.type === 'split' && Number.isInteger(msg.oi) && Number.isInteger(msg.ni)) {
        const p = pairOf(msg.oi!, msg.ni!);
        if (!p) return;
        savedUnpaired.push(p);
        void render();
      } else if (msg.type === 'clearPairs') {
        savedForced = [];
        savedUnpaired = [];
        void render();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mdWordDiff.pairingThreshold') && pairing === 'normal') void render();
    }),
  );

  if (src.liveDoc) {
    const doc = src.liveDoc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document !== doc) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void render(), 300);
      }),
      { dispose: () => timer && clearTimeout(timer) },
    );
  }

  panel.onDidDispose(() => disposables.forEach(d => d.dispose()));
}
