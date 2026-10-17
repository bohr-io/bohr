// What the CLI reads from the local git repository: its root, branch, commit and GitHub remote
import { execFile } from 'node:child_process';

/** Runs git in `cwd`; null when git is missing, the folder is not a repository or the command fails. */
export function git(args: readonly string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd, windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

export async function gitRoot(cwd: string): Promise<string | null> {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

/** The checked-out branch; null on a detached HEAD. */
export async function currentBranch(cwd: string): Promise<string | null> {
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  return branch === null || branch === '' ? null : branch;
}

export async function headCommit(cwd: string): Promise<string | null> {
  const sha = await git(['rev-parse', 'HEAD'], cwd);
  return sha !== null && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

/** "owner/name" of the remote's GitHub repository (origin by default), or null. */
export async function githubRepository(cwd: string, remote = 'origin'): Promise<string | null> {
  const url = await git(['remote', 'get-url', remote], cwd);
  return url === null ? null : parseGithubRemote(url);
}

/**
 * "owner/name" from a GitHub remote URL: https://github.com/o/r(.git), git@github.com:o/r.git,
 * ssh://git@github.com/o/r.git. Other hosts give null.
 */
export function parseGithubRemote(url: string): string | null {
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git:\/\/|[^@/]+@)github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return match ? `${match[1]}/${match[2]}` : null;
}
