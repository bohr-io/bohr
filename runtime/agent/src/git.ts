import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const LOCAL_TIMEOUT_MS = 2 * 60_000;
const NETWORK_TIMEOUT_MS = 10 * 60_000;

/** Never committed, even when the repository's .gitignore forgets them; `git clean -fd` keeps them too. */
const LOCAL_EXCLUDES = ['node_modules/', '.venv/', '__pycache__/', '.wrangler/'];

/** What git leaves behind when an operation stops halfway; a fresh run must not inherit any of it. */
const STALE_STATE = [
  'index.lock',
  'HEAD.lock',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
  'MERGE_HEAD',
  'MERGE_MSG',
  'MERGE_MODE',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
];

export interface GitCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | string | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Hides the password part of URLs (the remote carries a placeholder token, but logs need not show it). */
export function redactUrls(text: string): string {
  return text.replace(/(\/\/[^/@\s:]+):[^@\s/]+@/g, '$1:***@');
}

/** Runs git with an argument list (no shell) and resolves with its stdout. */
export function runGit(args: string[], options: GitCommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
        signal: options.signal,
        timeout: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const detail = stderr.trim().split('\n').slice(-5).join(' ').trim() || error.message;
        const command = args.find((arg) => !arg.startsWith('-')) ?? 'command';
        const code = typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null;
        reject(new GitError(redactUrls(`git ${command} failed: ${detail}`), code, stderr));
      },
    );
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export interface CommitInfo {
  sha: string;
  title: string;
}

/** The repository checkout the runner owns. */
export class Checkout {
  constructor(
    readonly dir: string,
    private readonly env?: NodeJS.ProcessEnv,
  ) {}

  run(args: string[], options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
    // Git must never look above the checkout for a repository: with a broken .git it would otherwise find an
    // enclosing one and reset or clean that instead.
    const env = { ...this.env, GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(this.dir)) };
    return runGit(args, { cwd: this.dir, env, ...options });
  }

  exists(): Promise<boolean> {
    return exists(path.join(this.dir, '.git'));
  }

  /**
   * Clones the repository when there is no checkout yet, otherwise fetches it. Without a URL an existing
   * checkout keeps its current remote.
   */
  async ensure(remoteUrl: string | undefined, signal?: AbortSignal): Promise<{ cloned: boolean }> {
    if ((await this.exists()) && remoteUrl && !(await this.isRepository())) {
      // What an interrupted clone leaves behind; cloning again is the only way forward.
      await rm(this.dir, { recursive: true, force: true });
    }
    if (!(await this.exists())) {
      if (!remoteUrl) throw new Error('No repository is checked out and its remote is unknown.');
      // A leftover directory without .git is an interrupted clone.
      await rm(this.dir, { recursive: true, force: true });
      await mkdir(path.dirname(this.dir), { recursive: true });
      await runGit(['clone', '--quiet', remoteUrl, this.dir], {
        cwd: path.dirname(this.dir),
        env: this.env,
        signal,
        timeoutMs: NETWORK_TIMEOUT_MS,
      });
      await this.excludeLocalFiles();
      return { cloned: true };
    }
    await this.clearStaleState();
    if (remoteUrl) {
      const current = await this.run(['remote', 'get-url', 'origin']).catch(() => undefined);
      if (current === undefined) await this.run(['remote', 'add', 'origin', remoteUrl]);
      else if (current.trim() !== remoteUrl) await this.run(['remote', 'set-url', 'origin', remoteUrl]);
    }
    await this.run(['fetch', '--quiet', '--prune', 'origin'], { signal, timeoutMs: NETWORK_TIMEOUT_MS });
    await this.excludeLocalFiles();
    return { cloned: false };
  }

  private isRepository(): Promise<boolean> {
    return this.run(['rev-parse', '--git-dir']).then(
      () => true,
      () => false,
    );
  }

  async setIdentity(name: string, email: string): Promise<void> {
    await this.run(['config', 'user.name', name]);
    await this.run(['config', 'user.email', email]);
  }

  /** The commit a ref points to, or undefined when the ref does not exist. */
  async resolve(ref: string): Promise<string | undefined> {
    try {
      const sha = (await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
      return sha || undefined;
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) return undefined;
      throw error;
    }
  }

  async head(): Promise<string> {
    return (await this.run(['rev-parse', 'HEAD'])).trim();
  }

  async currentBranch(): Promise<string | undefined> {
    const name = await this.run(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
    return name.trim() || undefined;
  }

  /** Points `branch` at `startPoint`, checks it out and drops every local change except ignored files. */
  async switchTo(branch: string, startPoint: string, options: { track: boolean }): Promise<void> {
    await this.run([
      'checkout',
      '--quiet',
      '--force',
      options.track ? '--track' : '--no-track',
      '-B',
      branch,
      startPoint,
    ]);
    await this.run(['reset', '--quiet', '--hard', startPoint]);
    await this.run(['clean', '-fdq']);
  }

  stageAll(): Promise<string> {
    return this.run(['add', '--all']);
  }

  /** Paths whose staged content differs from `commit`, with renames reported as a deletion plus an addition. */
  async stagedChangesSince(commit: string): Promise<string[]> {
    const output = await this.run(['diff', '--cached', '--name-only', '--no-renames', '-z', commit, '--']);
    return output.split('\0').filter(Boolean);
  }

  /** Puts `paths` back as they were in `commit` (removing the ones that did not exist), in the index and on disk. */
  async restorePaths(commit: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const literal = ['--literal-pathspecs'];
    const listed = await this.run([...literal, 'ls-tree', '-r', '--name-only', '-z', commit, '--', ...paths]);
    const existing = new Set(listed.split('\0').filter(Boolean));
    const restore = paths.filter((file) => existing.has(file));
    const remove = paths.filter((file) => !existing.has(file));
    if (restore.length > 0) await this.run([...literal, 'checkout', commit, '--', ...restore]);
    if (remove.length > 0) {
      await this.run([...literal, 'rm', '--cached', '--quiet', '--force', '--ignore-unmatch', '--', ...remove]);
      await Promise.all(remove.map((file) => rm(path.join(this.dir, file), { force: true })));
    }
  }

  async commit(title: string, body?: string): Promise<void> {
    // Hooks are skipped: nobody is around to fix a failing hook once the agent has finished, and the agent
    // was asked to run the project's own checks.
    await this.run(['commit', '--quiet', '--no-verify', '-m', title, ...(body ? ['-m', body] : [])]);
  }

  /** Pushes HEAD to `branch` without forcing, so a branch that moved meanwhile is never overwritten. */
  async push(branch: string): Promise<void> {
    await this.run(['push', '--quiet', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`], {
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
  }

  /** Commits after `since` up to HEAD, oldest first (the most recent 200). */
  async commitsSince(since: string): Promise<CommitInfo[]> {
    const output = await this.run(['log', '--reverse', '-n', '200', '--format=%H%x00%s', `${since}..HEAD`]);
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', title = ''] = line.split('\0');
        return { sha, title };
      });
  }

  /** Tracked and untracked (not ignored) files matching the pathspecs. */
  async listFiles(pathspecs: string[]): Promise<string[]> {
    const output = await this.run(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs]);
    return [...new Set(output.split('\0').filter(Boolean))];
  }

  private async excludeLocalFiles(): Promise<void> {
    const file = path.join(this.dir, '.git', 'info', 'exclude');
    const current = await readFile(file, 'utf8').catch(() => '');
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missing = LOCAL_EXCLUDES.filter((pattern) => !lines.has(pattern));
    if (missing.length === 0) return;
    await mkdir(path.dirname(file), { recursive: true });
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    await appendFile(file, `${prefix}# bohr\n${missing.join('\n')}\n`);
  }

  private async clearStaleState(): Promise<void> {
    const gitDir = path.join(this.dir, '.git');
    await Promise.all(STALE_STATE.map((name) => rm(path.join(gitDir, name), { recursive: true, force: true })));
  }
}
