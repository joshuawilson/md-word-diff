import * as vscode from 'vscode';
import { listRefs, verifyRev, type RefItem } from './git';

type Item = vscode.QuickPickItem & { rev?: string };

const SECTIONS: [RefItem['kind'], string][] = [
  ['branch', 'Branches'],
  ['remote', 'Remote branches'],
  ['tag', 'Tags'],
  ['commit', 'Commits touching this file'],
];

const ICONS: Record<RefItem['kind'], string> = { branch: '$(git-branch)', remote: '$(cloud)', tag: '$(tag)', commit: '$(git-commit)' };

/** Pick a branch/tag/commit or type any revision; returns the revision as chosen, verified, or undefined. */
export async function pickRevision(root: string, relPath: string, title: string): Promise<string | undefined> {
  const refs = await listRefs(root, relPath);
  const items: Item[] = [];
  for (const [kind, label] of SECTIONS) {
    const group = refs.filter(r => r.kind === kind);
    if (!group.length) continue;
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    for (const r of group) items.push({ label: `${ICONS[kind]} ${r.label}`, description: r.description, rev: r.rev });
  }

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = title;
  qp.placeholder = 'Pick a branch, tag or commit — or type any revision (e.g. HEAD~3, v1.2)';
  qp.matchOnDescription = true;
  qp.items = items;

  const chosen = await new Promise<string | undefined>(resolve => {
    let done = false;
    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0];
      done = true;
      resolve(sel?.rev ?? (qp.value.trim() || undefined));
      qp.hide();
    });
    qp.onDidHide(() => {
      if (!done) resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
  if (!chosen) return undefined;
  try {
    await verifyRev(root, chosen);
    return chosen;
  } catch (err) {
    void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
