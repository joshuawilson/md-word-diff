import * as vscode from 'vscode';
import { diffMarkdown } from '../engine/diff';
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
}

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
  <label><input type="checkbox" id="hide"> Hide unchanged</label>
  <span id="manual" class="view-hidden"><span id="manual-count"></span> <button id="clear-pairs" title="Remove all manual pairs">Clear</button></span>
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
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media'), vscode.Uri.joinPath(ctx.extensionUri, 'dist')],
  });
  panel.webview.html = shellHtml(panel.webview, ctx.extensionUri);

  let pairing: Pairing = 'normal';
  const cfg = vscode.workspace.getConfiguration('mdWordDiff').get<string>('grouping', '1');
  let grouping: Grouping = cfg === 'off' || cfg === '2' ? cfg : '1';
  let oldText: string | undefined;
  let ready = false;
  /** Manual pairs [old block index, new block index], kept for the life of the panel. */
  let forced: [number, number][] = [];
  const disposables: vscode.Disposable[] = [];

  const render = async () => {
    if (!ready) return;
    try {
      oldText ??= await src.getOld();
      const newText = await src.getNew();
      const result = diffMarkdown(oldText, newText, { threshold: thresholdFor(pairing), grouping, forced });
      void panel.webview.postMessage({
        type: 'render',
        rendered: renderRendered(result),
        raw: renderRaw(result),
        stats: result.stats,
        label: `${src.label} → ${src.newLabel}`,
        pairing,
        grouping,
        manualPairs: result.blocks.filter(b => b.forced).length,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      panel.dispose();
    }
  };

  disposables.push(
    panel.webview.onDidReceiveMessage((msg: { type: string; value?: string; oi?: number; ni?: number }) => {
      if (msg.type === 'ready') {
        ready = true;
        void render();
      } else if (msg.type === 'pairing' && (msg.value === 'loose' || msg.value === 'normal' || msg.value === 'strict')) {
        pairing = msg.value;
        void render();
      } else if (msg.type === 'grouping' && (msg.value === 'off' || msg.value === '1' || msg.value === '2')) {
        grouping = msg.value;
        void render();
      } else if (msg.type === 'forcePair' && Number.isInteger(msg.oi) && Number.isInteger(msg.ni)) {
        forced = forced.filter(([i, j]) => i !== msg.oi && j !== msg.ni);
        forced.push([msg.oi!, msg.ni!]);
        void render();
      } else if (msg.type === 'unpair' && Number.isInteger(msg.oi)) {
        forced = forced.filter(([i]) => i !== msg.oi);
        void render();
      } else if (msg.type === 'clearPairs') {
        forced = [];
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
