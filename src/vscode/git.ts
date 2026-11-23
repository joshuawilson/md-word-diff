import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';

export class GitError extends Error {}

export interface RefItem {
  kind: 'branch' | 'remote' | 'tag' | 'commit';
  rev: string;
  label: string;
  description: string;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

function checkRev(rev: string): void {
  // execFile uses no shell, so only option-like revisions are dangerous.
  if (!rev.trim() || rev.startsWith('-')) throw new GitError(`Unknown revision: ${rev}`);
}

export async function repoRoot(filePath: string): Promise<string> {
  try {
    return (await git(dirname(filePath), ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new GitError(`Not in a git repository: ${filePath}`);
  }
}

/**
 * Repo root and posix-style repo-relative path for a file. Symlinks are resolved first,
 * because git reports the real path of the repository root.
 */
export async function locate(filePath: string): Promise<{ root: string; relPath: string }> {
  let real = filePath;
  try {
    real = await realpath(filePath);
  } catch {
    try {
      real = `${await realpath(dirname(filePath))}${sep}${filePath.split(sep).pop()}`;
    } catch {
      // keep the path as given; repoRoot reports the error
    }
  }
  const root = await repoRoot(real);
  return { root, relPath: relative(root, real).split(sep).join('/') };
}

/** Resolve a revision expression to a full commit hash. */
export async function verifyRev(root: string, rev: string): Promise<string> {
  checkRev(rev);
  try {
    return (await git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim();
  } catch {
    throw new GitError(`Unknown revision: ${rev}`);
  }
}

/** File contents at a revision; relPath is posix-style, relative to the repo root. */
export async function showFile(root: string, rev: string, relPath: string): Promise<string> {
  checkRev(rev);
  try {
    return await git(root, ['show', `${rev}:${relPath}`]);
  } catch {
    throw new GitError(`${relPath} does not exist at ${rev}`);
  }
}

/** Branches, remote branches, tags, then the last 50 commits touching relPath. */
export async function listRefs(root: string, relPath: string): Promise<RefItem[]> {
  const out: RefItem[] = [];
  const refs = await git(root, ['for-each-ref', '--format=%(refname)%09%(refname:short)%09%(creatordate:short)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  for (const line of refs.split('\n')) {
    if (!line) continue;
    const [full, short, date] = line.split('\t');
    if (full.startsWith('refs/remotes/') && full.endsWith('/HEAD')) continue;
    const kind = full.startsWith('refs/heads/') ? 'branch' : full.startsWith('refs/tags/') ? 'tag' : 'remote';
    out.push({ kind, rev: short, label: short, description: date ?? '' });
  }
  const order = { branch: 0, remote: 1, tag: 2, commit: 3 } as const;
  out.sort((a, b) => order[a.kind] - order[b.kind]);
  const log = await git(root, ['log', '-n', '50', '--format=%H%x09%h%x09%cs%x09%s', '--', relPath]);
  for (const line of log.split('\n')) {
    if (!line) continue;
    const [hash, short, date, ...subject] = line.split('\t');
    out.push({ kind: 'commit', rev: hash, label: short, description: `${date} ${subject.join('\t')}` });
  }
  return out;
}
