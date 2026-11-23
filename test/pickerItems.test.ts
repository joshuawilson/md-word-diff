import { expect, test } from 'vitest';
import { buildPickItems, type PickItem } from '../src/vscode/pickerItems';
import type { RefItem } from '../src/vscode/git';

const refs: RefItem[] = [
  { kind: 'branch', rev: 'main', label: 'main', description: '2026-11-01' },
  { kind: 'tag', rev: 'v1.2', label: 'v1.2', description: '2026-10-01' },
];

test('no typed text: sections only', () => {
  const items = buildPickItems(refs, '');
  expect(items[0]).toEqual({ separator: true, label: 'Branches' });
  expect(items.some((i: PickItem) => !i.separator && i.rev === 'v1.2')).toBe(true);
});

test('typed text becomes the first, exact-label item', () => {
  const items = buildPickItems(refs, ' v1 ');
  expect(items[0]).toMatchObject({ label: 'v1', rev: 'v1', typed: true });
});

test('typed text equal to an existing ref is not duplicated', () => {
  expect(buildPickItems(refs, 'main').filter((i: PickItem) => !i.separator && i.typed).length).toBe(0);
});
