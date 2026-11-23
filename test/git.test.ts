import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { listRefs, locate, repoRoot, showFile, verifyRev } from '../src/vscode/git';

let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mdwd-git-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.md'), 'first\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('tag', 'v1');
  writeFileSync(join(root, 'docs', 'a.md'), 'second\n');
  git('commit', '-q', '-am', 'two');
});

test('repoRoot finds the root from a nested file', async () => {
  expect(await repoRoot(join(root, 'docs', 'a.md'))).toBe(root);
});

test('repoRoot outside a repo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdwd-norepo-'));
  await expect(repoRoot(join(dir, 'x.md'))).rejects.toThrow(/Not in a git repository/);
});

test('showFile reads old content', async () => {
  expect(await showFile(root, 'v1', 'docs/a.md')).toBe('first\n');
  expect(await showFile(root, 'HEAD', 'docs/a.md')).toBe('second\n');
});

test('showFile missing path', async () => {
  await expect(showFile(root, 'HEAD', 'missing.md')).rejects.toThrow('missing.md does not exist at HEAD');
});

test('verifyRev', async () => {
  expect(await verifyRev(root, 'HEAD~1')).toMatch(/^[0-9a-f]{40}$/);
  await expect(verifyRev(root, 'nope')).rejects.toThrow('Unknown revision: nope');
});

test('listRefs', async () => {
  const refs = await listRefs(root, 'docs/a.md');
  expect(refs).toContainEqual(expect.objectContaining({ kind: 'branch', rev: 'main' }));
  expect(refs).toContainEqual(expect.objectContaining({ kind: 'tag', rev: 'v1' }));
  const commits = refs.filter(r => r.kind === 'commit');
  expect(commits.length).toBe(2);
  expect(commits[0].description).toMatch(/^\d{4}-\d{2}-\d{2} two$/);
});

test('locate resolves a file opened through a symlinked directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdwd-link-'));
  symlinkSync(root, join(dir, 'link'));
  const loc = await locate(join(dir, 'link', 'docs', 'a.md'));
  expect(loc).toEqual({ root, relPath: 'docs/a.md' });
  expect(await showFile(loc.root, 'v1', loc.relPath)).toBe('first\n');
});

test('verifyRev accepts revisions containing spaces', async () => {
  expect(await verifyRev(root, 'HEAD@{10 years ago}')).toMatch(/^[0-9a-f]{40}$/);
});

test('verifyRev rejects option-like revisions', async () => {
  await expect(verifyRev(root, '--output=/tmp/x')).rejects.toThrow('Unknown revision: --output=/tmp/x');
});
