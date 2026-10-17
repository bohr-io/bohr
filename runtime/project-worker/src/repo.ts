import { GithubClient, GithubError } from '@bohr/github';
import { githubToken } from './broker';
import type { Env } from './env';

export type PullRequestRef = { number: number; nodeId: string; url: string };
export type WorkflowRunState = { status: string | null; conclusion: string | null; url: string };

/** The repository operations the project needs; tests replace them with a fake. */
export interface RepoApi {
  branchSha(branch: string): Promise<string | null>;
  /** Points a branch at a commit, creating it when missing; history is discarded. */
  resetBranch(branch: string, sha: string): Promise<void>;
  /** The open pull request from head to base, or a new one. */
  openPullRequest(input: { head: string; base: string; title: string; body: string }): Promise<PullRequestRef>;
  /** Squash-merges only when the head is still `sha`, so nothing unreviewed is published. */
  mergePullRequest(number: number, input: { sha: string; title: string }): Promise<{ sha: string }>;
  /** Opens a pull request that reverts a merged one, and returns it with its head commit. */
  revertPullRequest(
    nodeId: string,
    input: { title: string; body: string },
  ): Promise<PullRequestRef & { headSha: string }>;
  /** The newest workflow run for a commit pushed to a branch, or null. */
  latestWorkflowRun(branch: string, sha: string): Promise<WorkflowRunState | null>;
  /** A text file at a branch or commit, or null when it does not exist. */
  readFile(path: string, ref: string): Promise<{ content: string; sha: string } | null>;
  /** Commits a text file to a branch (`sha` is the blob it replaces) and returns the new commit. */
  writeFile(input: { path: string; branch: string; content: string; message: string; sha?: string }): Promise<{
    commitSha: string;
  }>;
  /** The files directly inside a directory at a branch or commit (subdirectories left out); empty when missing. */
  listFiles(directory: string, ref: string): Promise<{ path: string; sha: string }[]>;
  /** Deletes a file from a branch (`sha` is its blob) and returns the new commit. */
  deleteFile(input: { path: string; branch: string; message: string; sha: string }): Promise<{ commitSha: string }>;
}

export class RepoError extends Error {}

function describe(error: unknown): string {
  if (error instanceof GithubError) {
    if (error.status === 405 || error.status === 409) return 'the pull request cannot be merged (conflict or checks)';
    return `GitHub answered ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function githubRepo(env: Env, fetchFn: typeof fetch): RepoApi {
  const owner = env.REPO_OWNER;
  const repo = env.REPO_NAME;
  // The Worker's own token; the sandbox's git traffic gets a narrower one (see gateway.ts)
  const client = async () =>
    new GithubClient({ token: await githubToken(env, 'worker', fetchFn), fetch: fetchFn, userAgent: 'bohr-project' });
  const wrap = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      throw new RepoError(describe(error));
    }
  };

  return {
    branchSha: (branch) => wrap(async () => (await client()).getBranchSha(owner, repo, branch)),
    resetBranch: (branch, sha) =>
      wrap(async () => {
        const github = await client();
        if ((await github.getBranchSha(owner, repo, branch)) === null) {
          await github.createBranch(owner, repo, branch, sha);
        } else {
          await github.updateBranch(owner, repo, branch, sha, true);
        }
      }),
    openPullRequest: (input) =>
      wrap(async () => {
        const github = await client();
        const pull =
          (await github.findOpenPullRequest(owner, repo, input.head, input.base)) ??
          (await github.createPullRequest(owner, repo, input));
        return { number: pull.number, nodeId: pull.node_id, url: pull.html_url };
      }),
    mergePullRequest: (number, input) =>
      wrap(async () => {
        const github = await client();
        const result = await github.mergePullRequest(owner, repo, number, {
          sha: input.sha,
          mergeMethod: 'squash',
          commitTitle: input.title,
        });
        if (!result.merged) throw new RepoError('GitHub did not merge the pull request');
        return { sha: result.sha };
      }),
    revertPullRequest: (nodeId, input) =>
      wrap(async () => {
        const github = await client();
        const revert = await github.revertPullRequest(nodeId, input);
        const pull = await github.getPullRequest(owner, repo, revert.number);
        return { number: revert.number, nodeId: revert.node_id, url: revert.html_url, headSha: pull.head.sha };
      }),
    latestWorkflowRun: (branch, sha) =>
      wrap(async () => {
        const runs = await (await client()).listWorkflowRuns(owner, repo, { branch, headSha: sha, perPage: 10 });
        const run = runs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return run === undefined ? null : { status: run.status, conclusion: run.conclusion, url: run.html_url };
      }),
    readFile: (path, ref) => wrap(async () => (await client()).getFile(owner, repo, path, ref)),
    writeFile: (input) =>
      wrap(async () =>
        (await client()).putFile(owner, repo, input.path, {
          content: input.content,
          message: input.message,
          branch: input.branch,
          ...(input.sha !== undefined ? { sha: input.sha } : {}),
        }),
      ),
    listFiles: (directory, ref) =>
      wrap(async () =>
        (await (await client()).listDirectory(owner, repo, directory, ref))
          .filter((entry) => entry.type === 'file')
          .map((entry) => ({ path: entry.path, sha: entry.sha })),
      ),
    deleteFile: (input) =>
      wrap(async () =>
        (await client()).deleteFile(owner, repo, input.path, {
          message: input.message,
          branch: input.branch,
          sha: input.sha,
        }),
      ),
  };
}
