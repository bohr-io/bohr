import { base64ToBytes, bytesToBase64, utf8, utf8Decode } from './encoding';
import { GithubError } from './errors';
import {
  createTransport,
  type Fetch,
  graphqlUrl,
  paginate,
  query,
  type Sleep,
  segment,
  segments,
  send,
  type Transport,
} from './http';
import { sealSecret } from './secrets';

export type GithubClientOptions = {
  /** Installation, user or App token; sent as `Authorization: Bearer`. */
  token: string;
  fetch?: Fetch;
  /** Defaults to https://api.github.com; GitHub Enterprise Server uses https://HOST/api/v3. */
  apiBase?: string;
  /** Defaults to "bohr". */
  userAgent?: string;
  /** Waits before the single retry of a rate-limited call; replaceable in tests. */
  sleep?: Sleep;
};

export type PullRequest = {
  number: number;
  node_id: string;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  title: string;
};

export type WorkflowRun = {
  id: number;
  name: string | null;
  /** The commit message's first line (or the PR title) GitHub shows for the run. */
  display_title?: string;
  run_number?: number;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  event: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowJob = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  steps: { number: number; name: string; status: string | null; conclusion: string | null }[];
};

export type RepositorySummary = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  html_url: string;
};

/** A member of a GitHub organization. */
export type OrgMember = { id: number; login: string; avatar_url: string | null };

/** An App installation and the account it is on (Organization or User). */
export type AppInstallation = {
  id: number;
  account: { id: number; login: string; type: string; avatar_url: string | null };
  permissions: Record<string, string>;
  /** "selected": the App only reaches the repositories chosen for it; null or absent when unknown. */
  repository_selection?: 'all' | 'selected' | null;
};

type RawPullRequest = Omit<PullRequest, 'merged'> & { merged?: boolean; merged_at?: string | null };
type RawContent = { type: string; sha: string; name?: string; path?: string; content?: string; encoding?: string };
type RawInstallation = { id: number; account: { login?: string; slug?: string; type?: string } | null };

const REVERT_PULL_REQUEST = `mutation RevertPullRequest($pullRequestId: ID!, $title: String, $body: String) {
  revertPullRequest(input: { pullRequestId: $pullRequestId, title: $title, body: $body }) {
    revertPullRequest { number id url }
  }
}`;

function toPullRequest(raw: RawPullRequest): PullRequest {
  return {
    number: raw.number,
    node_id: raw.node_id,
    html_url: raw.html_url,
    state: raw.state,
    // List endpoints omit `merged` and only carry `merged_at`
    merged: raw.merged ?? (raw.merged_at ?? null) !== null,
    head: { ref: raw.head.ref, sha: raw.head.sha },
    base: { ref: raw.base.ref },
    title: raw.title,
  };
}

function toWorkflowRun(raw: WorkflowRun): WorkflowRun {
  return {
    id: raw.id,
    name: raw.name,
    ...(raw.display_title !== undefined ? { display_title: raw.display_title } : {}),
    ...(raw.run_number !== undefined ? { run_number: raw.run_number } : {}),
    head_branch: raw.head_branch,
    head_sha: raw.head_sha,
    status: raw.status,
    conclusion: raw.conclusion,
    html_url: raw.html_url,
    event: raw.event,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

function toRepositorySummary(raw: RepositorySummary): RepositorySummary {
  return {
    id: raw.id,
    node_id: raw.node_id,
    name: raw.name,
    full_name: raw.full_name,
    owner: { login: raw.owner.login },
    default_branch: raw.default_branch,
    private: raw.private,
    html_url: raw.html_url,
  };
}

function toInstallation(raw: RawInstallation): { id: number; account: { login: string; type: string } } {
  // Enterprise installations have an account without login/type
  return {
    id: raw.id,
    account: { login: raw.account?.login ?? raw.account?.slug ?? '', type: raw.account?.type ?? 'Enterprise' },
  };
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${segment(owner)}/${segment(repo)}`;
}

function contentsPath(owner: string, repo: string, path: string): string {
  return `${repoPath(owner, repo)}/contents/${segments(path.replace(/^\/+/, ''))}`;
}

export class GithubClient {
  // Private field, so the token stays out of console.log and JSON.stringify of the client
  readonly #transport: Transport;

  constructor(options: GithubClientOptions) {
    this.#transport = createTransport(options, options.token);
  }

  /** REST base URL, without a trailing slash. */
  get apiBase(): string {
    return this.#transport.apiBase;
  }

  /** JSON in and out; `path` is relative to the API base. Throws GithubError on non-2xx; 204 gives undefined. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const reply = await send(this.#transport, method, this.#url(path), body);
    return reply.data as T;
  }

  /** Throws GithubError (with the HTTP status, usually 200) when the response carries `errors`. */
  async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const reply = await send(this.#transport, 'POST', graphqlUrl(this.#transport.apiBase), { query, variables });
    const result = reply.data as { data?: T; errors?: unknown } | undefined;
    if (Array.isArray(result?.errors) && result.errors.length > 0) throw new GithubError(reply.status, reply.data);
    return result?.data as T;
  }

  /** GETs `path` and follows Link rel="next" (up to 20 pages). Include per_page in `path`. */
  paginate<Page, Item>(path: string, pick: (page: Page) => Item[]): Promise<Item[]> {
    return paginate(this.#transport, this.#url(path), pick);
  }

  async getRepository(owner: string, repo: string): Promise<RepositorySummary> {
    return toRepositorySummary(await this.request<RepositorySummary>('GET', repoPath(owner, repo)));
  }

  /** Head commit of a branch, or null when the branch does not exist. */
  async getBranchSha(owner: string, repo: string, branch: string): Promise<string | null> {
    const ref = await orNull(
      this.request<{ object: { sha: string } }>('GET', `${repoPath(owner, repo)}/git/ref/heads/${segments(branch)}`),
    );
    return ref === null ? null : ref.object.sha;
  }

  async createBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request('POST', `${repoPath(owner, repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async updateBranch(owner: string, repo: string, branch: string, sha: string, force: boolean): Promise<void> {
    await this.request('PATCH', `${repoPath(owner, repo)}/git/refs/heads/${segments(branch)}`, { sha, force });
  }

  /** Succeeds when the branch is already gone (404, or 422 "Reference does not exist"). */
  async deleteBranch(owner: string, repo: string, branch: string): Promise<void> {
    try {
      await this.request('DELETE', `${repoPath(owner, repo)}/git/refs/heads/${segments(branch)}`);
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) return;
      throw error;
    }
  }

  async compare(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<{ status: string; ahead_by: number; behind_by: number; commits: { sha: string; message: string }[] }> {
    const comparison = await this.request<{
      status: string;
      ahead_by: number;
      behind_by: number;
      commits: { sha: string; commit: { message: string } }[];
    }>('GET', `${repoPath(owner, repo)}/compare/${segments(base)}...${segments(head)}`);
    return {
      status: comparison.status,
      ahead_by: comparison.ahead_by,
      behind_by: comparison.behind_by,
      commits: comparison.commits.map((commit) => ({ sha: commit.sha, message: commit.commit.message })),
    };
  }

  /** The open pull request from `head` (a branch of this repository) into `base`, or null. */
  async findOpenPullRequest(owner: string, repo: string, head: string, base: string): Promise<PullRequest | null> {
    const pulls = await this.request<RawPullRequest[]>(
      'GET',
      `${repoPath(owner, repo)}/pulls${query({ state: 'open', head: `${owner}:${head}`, base })}`,
    );
    const pull = pulls.find((candidate) => candidate.head.ref === head && candidate.base.ref === base);
    return pull === undefined ? null : toPullRequest(pull);
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; head: string; base: string; body?: string },
  ): Promise<PullRequest> {
    const { title, head, base, body } = input;
    return toPullRequest(
      await this.request<RawPullRequest>('POST', `${repoPath(owner, repo)}/pulls`, { title, head, base, body }),
    );
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    return toPullRequest(
      await this.request<RawPullRequest>('GET', `${repoPath(owner, repo)}/pulls/${segment(number)}`),
    );
  }

  /** `sha` must be the head the caller reviewed: GitHub answers 409 if the branch moved, 405 if not mergeable. */
  async mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    input: { sha: string; mergeMethod: 'squash' | 'merge' | 'rebase'; commitTitle?: string; commitMessage?: string },
  ): Promise<{ sha: string; merged: boolean }> {
    const result = await this.request<{ sha: string; merged: boolean }>(
      'PUT',
      `${repoPath(owner, repo)}/pulls/${segment(number)}/merge`,
      {
        sha: input.sha,
        merge_method: input.mergeMethod,
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
      },
    );
    return { sha: result.sha, merged: result.merged };
  }

  async closePullRequest(owner: string, repo: string, number: number): Promise<void> {
    await this.request('PATCH', `${repoPath(owner, repo)}/pulls/${segment(number)}`, { state: 'closed' });
  }

  /** Opens a pull request that reverts a merged one (GraphQL revertPullRequest). */
  async revertPullRequest(
    pullRequestNodeId: string,
    input: { title?: string; body?: string } = {},
  ): Promise<{ number: number; node_id: string; html_url: string }> {
    const data = await this.graphql<{
      revertPullRequest: { revertPullRequest: { number: number; id: string; url: string } | null } | null;
    }>(REVERT_PULL_REQUEST, { pullRequestId: pullRequestNodeId, title: input.title, body: input.body });
    const revert = data?.revertPullRequest?.revertPullRequest;
    if (revert === null || revert === undefined) throw new Error('GitHub did not return the revert pull request');
    return { number: revert.number, node_id: revert.id, html_url: revert.url };
  }

  /** One page of runs, newest first (GitHub's default page size is 30, max 100). */
  async listWorkflowRuns(
    owner: string,
    repo: string,
    filter: { branch?: string; headSha?: string; event?: string; perPage?: number } = {},
  ): Promise<WorkflowRun[]> {
    const search = query({
      branch: filter.branch,
      head_sha: filter.headSha,
      event: filter.event,
      per_page: filter.perPage,
    });
    const page = await this.request<{ workflow_runs: WorkflowRun[] }>(
      'GET',
      `${repoPath(owner, repo)}/actions/runs${search}`,
    );
    return page.workflow_runs.map(toWorkflowRun);
  }

  /** The jobs of a workflow run, with their steps. */
  async listRunJobs(owner: string, repo: string, runId: number): Promise<WorkflowJob[]> {
    const page = await this.request<{ jobs: WorkflowJob[] }>(
      'GET',
      `${repoPath(owner, repo)}/actions/runs/${segment(runId)}/jobs?per_page=50`,
    );
    return page.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      html_url: job.html_url,
      steps: (job.steps ?? []).map(({ number, name, status, conclusion }) => ({ number, name, status, conclusion })),
    }));
  }

  /** A job's log as plain text (GitHub redirects to it); empty while the job has not started. */
  async getJobLogs(owner: string, repo: string, jobId: number): Promise<string> {
    const text = await orNull(
      this.request<unknown>('GET', `${repoPath(owner, repo)}/actions/jobs/${segment(jobId)}/logs`),
    );
    return typeof text === 'string' ? text : '';
  }

  /** A file's blob sha and its content decoded as UTF-8, or null when the path does not exist at `ref`. */
  async getFile(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ sha: string; content: string } | null> {
    const file = await orNull(
      this.request<RawContent | RawContent[]>('GET', `${contentsPath(owner, repo, path)}${query({ ref })}`),
    );
    if (file === null) return null;
    if (Array.isArray(file) || file.type !== 'file') throw new Error(`${path} is not a file`);
    let content = file.content ?? '';
    // Files over 1 MB can come back with encoding "none" and no content; the blob API serves up to 100 MB
    if (file.encoding !== undefined && file.encoding !== 'base64') {
      const blob = await this.request<{ content: string }>(
        'GET',
        `${repoPath(owner, repo)}/git/blobs/${segment(file.sha)}`,
      );
      content = blob.content;
    }
    return { sha: file.sha, content: utf8Decode(base64ToBytes(content.replace(/\s+/g, ''))) };
  }

  /** Creates or updates a file with one commit. Pass the current blob `sha` to update an existing file. */
  async putFile(
    owner: string,
    repo: string,
    path: string,
    input: { content: string; message: string; branch: string; sha?: string },
  ): Promise<{ commitSha: string }> {
    const result = await this.request<{ commit: { sha: string } }>('PUT', contentsPath(owner, repo, path), {
      message: input.message,
      content: bytesToBase64(utf8(input.content)),
      branch: input.branch,
      sha: input.sha,
    });
    return { commitSha: result.commit.sha };
  }

  /** The entries of a directory at `ref`; empty when the directory does not exist there. */
  async listDirectory(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ name: string; path: string; type: string; sha: string }[]> {
    const entries = await orNull(
      this.request<RawContent | RawContent[]>('GET', `${contentsPath(owner, repo, path)}${query({ ref })}`),
    );
    if (entries === null) return [];
    if (!Array.isArray(entries)) throw new Error(`${path} is not a directory`);
    return entries.map((entry) => ({
      name: entry.name ?? '',
      path: entry.path ?? '',
      type: entry.type,
      sha: entry.sha,
    }));
  }

  /** Deletes a file with one commit; `sha` is the blob being deleted. */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    input: { message: string; branch: string; sha: string },
  ): Promise<{ commitSha: string }> {
    const result = await this.request<{ commit: { sha: string } }>('DELETE', contentsPath(owner, repo, path), {
      message: input.message,
      branch: input.branch,
      sha: input.sha,
    });
    return { commitSha: result.commit.sha };
  }

  /** Creates or updates a repository Actions secret, sealed with the repository's public key. */
  async setActionsSecret(owner: string, repo: string, name: string, value: string): Promise<void> {
    const secrets = `${repoPath(owner, repo)}/actions/secrets`;
    const secretPath = `${secrets}/${segment(name)}`;
    const key = await this.request<{ key_id: string; key: string }>('GET', `${secrets}/public-key`);
    await this.request('PUT', secretPath, { encrypted_value: sealSecret(key.key, value), key_id: key.key_id });
  }

  /** Deletes a repository Actions secret; one that does not exist is already gone. */
  async deleteActionsSecret(owner: string, repo: string, name: string): Promise<void> {
    await orNull(this.request('DELETE', `${repoPath(owner, repo)}/actions/secrets/${segment(name)}`));
  }

  /** Repositories the installation token can access. */
  listInstallationRepositories(): Promise<RepositorySummary[]> {
    return this.paginate('/installation/repositories?per_page=100', (page: { repositories: RepositorySummary[] }) =>
      page.repositories.map(toRepositorySummary),
    );
  }

  /** Installations of this App the user (user access token) can access. */
  listUserInstallations(): Promise<{ id: number; account: { login: string; type: string } }[]> {
    return this.paginate('/user/installations?per_page=100', (page: { installations: RawInstallation[] }) =>
      page.installations.map(toInstallation),
    );
  }

  /** Repositories of an installation that the user (user access token) can access. */
  listUserInstallationRepositories(installationId: number): Promise<RepositorySummary[]> {
    return this.paginate(
      `/user/installations/${segment(installationId)}/repositories?per_page=100`,
      (page: { repositories: RepositorySummary[] }) => page.repositories.map(toRepositorySummary),
    );
  }

  /**
   * Members of an organization (installation token with Organization › Members: read, or a member's token).
   * role "admin" lists the organization owners. GitHub answers 403 when the App lacks the permission.
   */
  listOrgMembers(org: string, role: 'all' | 'admin' | 'member' = 'all'): Promise<OrgMember[]> {
    return this.paginate(
      `/orgs/${segment(org)}/members${query({ role, per_page: 100 })}`,
      (page: { id: number; login: string; avatar_url?: string | null }[]) =>
        page.map((member) => ({ id: member.id, login: member.login, avatar_url: member.avatar_url ?? null })),
    );
  }

  /** An organization's public profile. */
  async getOrganization(
    org: string,
  ): Promise<{ id: number; login: string; name: string | null; avatar_url: string | null }> {
    const found = await this.request<{ id: number; login: string; name?: string | null; avatar_url?: string | null }>(
      'GET',
      `/orgs/${segment(org)}`,
    );
    return { id: found.id, login: found.login, name: found.name ?? null, avatar_url: found.avatar_url ?? null };
  }

  /** An installation of this App and its account (App JWT). */
  async getAppInstallation(installationId: number): Promise<AppInstallation> {
    const found = await this.request<{
      id: number;
      account: { id?: number; login?: string; slug?: string; type?: string; avatar_url?: string | null } | null;
      permissions?: Record<string, string>;
      repository_selection?: string;
    }>('GET', `/app/installations/${segment(installationId)}`);
    return {
      id: found.id,
      account: {
        id: found.account?.id ?? 0,
        login: found.account?.login ?? found.account?.slug ?? '',
        type: found.account?.type ?? 'Enterprise',
        avatar_url: found.account?.avatar_url ?? null,
      },
      permissions: found.permissions ?? {},
      repository_selection:
        found.repository_selection === 'all' || found.repository_selection === 'selected'
          ? found.repository_selection
          : null,
    };
  }

  /**
   * Creates a repository from a template repository (user access token with Administration: write; the user
   * must be a member of an organization `owner`). GitHub copies the files after answering: the default branch
   * appears a few seconds later.
   */
  async generateRepository(
    templateOwner: string,
    templateRepo: string,
    input: { owner: string; name: string; private: boolean; description?: string },
  ): Promise<RepositorySummary> {
    return toRepositorySummary(
      await this.request<RepositorySummary>('POST', `${repoPath(templateOwner, templateRepo)}/generate`, {
        owner: input.owner,
        name: input.name,
        description: input.description,
        private: input.private,
        include_all_branches: false,
      }),
    );
  }

  /** Gives an installation limited to selected repositories one more (user access token, admin of the repository). */
  async addRepositoryToInstallation(installationId: number, repositoryId: number): Promise<void> {
    await this.request('PUT', `/user/installations/${segment(installationId)}/repositories/${segment(repositoryId)}`);
  }

  async getAuthenticatedUser(): Promise<{ id: number; login: string; name: string | null; email: string | null }> {
    const user = await this.request<{ id: number; login: string; name?: string | null; email?: string | null }>(
      'GET',
      '/user',
    );
    return { id: user.id, login: user.login, name: user.name ?? null, email: user.email ?? null };
  }

  #url(path: string): string {
    return `${this.#transport.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
