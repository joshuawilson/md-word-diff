import * as vscode from 'vscode';
import { listRefs, verifyRev, type RefItem } from './git';
import { buildPickItems, type PickItem } from './pickerItems';

type Item = vscode.QuickPickItem & { rev?: string };

const ICONS: Record<RefItem['kind'] | 'typed', string> = {
  branch: '$(git-branch)',
  remote: '$(cloud)',
  tag: '$(tag)',
  commit: '$(git-commit)',
  typed: '$(edit)',
};

function toQuickPick(items: PickItem[]): Item[] {
  return items.map(i =>
    i.separator
      ? { label: i.label, kind: vscode.QuickPickItemKind.Separator }
      : { label: i.typed ? i.label : `${ICONS[i.kind]} ${i.label}`, description: i.typed ? `${ICONS.typed} ${i.description}` : i.description, rev: i.rev, alwaysShow: i.typed },
  );
}

/** Pick a branch/tag/commit or type any revision; returns the revision as chosen, verified, or undefined. */
export async function pickRevision(root: string, relPath: string, title: string): Promise<string | undefined> {
  const refs = await listRefs(root, relPath);
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = title;
  qp.placeholder = 'Pick a branch, tag or commit — or type any revision (e.g. HEAD~3, v1.2)';
  qp.matchOnDescription = true;
  qp.items = toQuickPick(buildPickItems(refs, ''));
  qp.onDidChangeValue(v => {
    qp.items = toQuickPick(buildPickItems(refs, v));
  });

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
