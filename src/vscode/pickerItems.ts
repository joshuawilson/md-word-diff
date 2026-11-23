import type { RefItem } from './git';

export type PickItem =
  | { separator: true; label: string }
  | { separator?: false; label: string; description: string; rev: string; kind: RefItem['kind'] | 'typed'; typed?: true };

const SECTIONS: [RefItem['kind'], string][] = [
  ['branch', 'Branches'],
  ['remote', 'Remote branches'],
  ['tag', 'Tags'],
  ['commit', 'Commits touching this file'],
];

/**
 * Picker items: typed text first (exact label, so it outranks fuzzy matches like 'v1' → 'v1.2'),
 * then branches, remotes, tags and commits under separators.
 */
export function buildPickItems(refs: RefItem[], typed: string): PickItem[] {
  const items: PickItem[] = [];
  const value = typed.trim();
  if (value && !refs.some(r => r.rev === value || r.label === value)) {
    items.push({ label: value, description: 'use this revision', rev: value, kind: 'typed', typed: true });
  }
  for (const [kind, label] of SECTIONS) {
    const group = refs.filter(r => r.kind === kind);
    if (!group.length) continue;
    items.push({ separator: true, label });
    for (const r of group) items.push({ label: r.label, description: r.description, rev: r.rev, kind });
  }
  return items;
}
