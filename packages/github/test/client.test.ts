import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GithubClient, GithubError, nextPageUrl } from '../src';
import { type Call, call, type FakeReply, fakeFetch } from './fake-fetch';
import {
  BASE_SHA,
  HEAD_SHA,
  listedPullRequest,
  MERGE_SHA,
  owner,
  pullRequest,
  repository,
  workflowRun,
  wrappedBase64,
} from './fixtures';

const API = 'https://api.github.com';
const SECONDARY_LIMIT =
  'You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID 1234:5678.';

function setup(...replies: FakeReply[]) {
  const { calls, fetch } = fakeFetch(...replies);
  const sleep = vi.fn(async (_ms: number) => {});
  return { calls, sleep, github: new GithubClient({ token: 'ghs_test-token', fetch, sleep }) };
}

function only(calls: Call[]): Call {
  expect(calls).toHaveLength(1);
  return call(calls, 0);
}

async function rejection(promise: Promise<unknown>): Promise<GithubError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(GithubError);
  return error as GithubError;
}

beforeAll(async () => {
  await sodium.ready;
});

describe('requests', () => {
  it('sends the token, the API version and JSON', async () => {
    const { calls, github } = setup({ status: 201, body: { id: 1, number: 12 } });

    const issue = await github.request<{ number: number }>('POST', '/repos/acme/site/issues', { title: 'Hi' });

    expect(issue.number).toBe(12);
    const request = only(calls);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${API}/repos/acme/site/issues`);
    expect(request.body).toEqual({ title: 'Hi' });
    expect(request.headers).toEqual({
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ghs_test-token',
      'content-type': 'application/json',
      'user-agent': 'bohr (+https://bohr.io)',
      'x-github-api-version': '2022-11-28',
    });
  });

  it('returns undefined for 204 and sends no content type without a body', async () => {
    const { calls, github } = setup({ status: 204 });

    expect(await github.request('DELETE', '/repos/acme/site/actions/secrets/OLD')).toBeUndefined();
    expect(only(calls).headers['content-type']).toBeUndefined();
  });

  it('honors apiBase (GitHub Enterprise Server) and userAgent, for REST and GraphQL', async () => {
    const { calls, fetch } = fakeFetch(
      { body: repository('site', 501) },
      { body: { data: { viewer: { login: 'a' } } } },
    );
    const github = new GithubClient({
      token: 't',
      fetch,
      apiBase: 'https://ghe.example.com/api/v3/',
      userAgent: 'bohr-instance/2.0',
    });

    await github.getRepository('acme', 'site');
    await github.graphql('{ viewer { login } }');

    expect(github.apiBase).toBe('https://ghe.example.com/api/v3');
    expect(call(calls, 0).url).toBe('https://ghe.example.com/api/v3/repos/acme/site');
    expect(call(calls, 0).headers['user-agent']).toBe('bohr-instance/2.0');
    expect(call(calls, 1).url).toBe('https://ghe.example.com/api/graphql');
  });

  it('calls the global fetch detached, as Workers require', async () => {
    let receiver: unknown = 'not called';
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async function (this: unknown) {
      receiver = this;
      return Response.json({ id: 1, login: 'ada', name: null, email: null });
    });
    try {
      await new GithubClient({ token: 't' }).getAuthenticatedUser();
      expect(globalFetch).toHaveBeenCalledOnce();
      expect(receiver).toBeUndefined();
    } finally {
      globalFetch.mockRestore();
    }
  });

  it('keeps the token off the instance', () => {
    const github = new GithubClient({ token: 'ghs_do-not-leak' });

    expect(JSON.stringify(github)).not.toContain('ghs_do-not-leak');
    expect(Object.values(github).join(' ')).not.toContain('ghs_do-not-leak');
  });
});

describe('errors', () => {
  it('throws GithubError with the message, the validation details and the documentation URL', async () => {
    const body = {
      message: 'Validation Failed',
      errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists for acme:homolog.' }],
      documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
      status: '422',
    };
    const { github } = setup({ status: 422, body });

    const error = await rejection(
      github.createPullRequest('acme', 'site', { title: 'x', head: 'homolog', base: 'main' }),
    );

    expect(error.status).toBe(422);
    expect(error.message).toBe('GitHub 422: Validation Failed (A pull request already exists for acme:homolog.)');
    expect(error.body).toEqual(body);
    expect(error.documentationUrl).toBe('https://docs.github.com/rest/pulls/pulls#create-a-pull-request');
    expect(error.name).toBe('GithubError');
  });

  it('describes field errors that carry no message', async () => {
    const { github } = setup({
      status: 422,
      body: { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] },
    });

    const error = await rejection(github.request('POST', '/repos/acme/site/issues', {}));

    expect(error.message).toBe('GitHub 422: Validation Failed (Issue title missing_field)');
  });

  it('keeps bodies that are not JSON', async () => {
    const { github } = setup({ status: 502, text: '<html>\n  <body>Bad   Gateway</body>\n</html>' });

    const error = await rejection(github.getRepository('acme', 'site'));

    expect(error.status).toBe(502);
    expect(error.body).toBe('<html>\n  <body>Bad   Gateway</body>\n</html>');
    expect(error.message).toBe('GitHub 502: <html> <body>Bad Gateway</body> </html>');
    expect(error.documentationUrl).toBeUndefined();
  });

  it('can be built by callers, for example in their own tests', () => {
    const error = new GithubError(409, { message: 'Head branch was modified. Review and try the merge again.' });

    expect(error.message).toBe('GitHub 409: Head branch was modified. Review and try the merge again.');
    expect(new GithubError(500, undefined).message).toBe('GitHub 500: empty response');
  });
});

describe('rate limits', () => {
  it('retries once after retry-after, resending the same request', async () => {
    const { calls, sleep, github } = setup(
      { status: 403, body: { message: SECONDARY_LIMIT }, headers: { 'retry-after': '3' } },
      { status: 201, body: pullRequest() },
    );

    const created = await github.createPullRequest('acme', 'site', {
      title: 'Make the header blue',
      head: 'homolog',
      base: 'main',
    });

    expect(created.number).toBe(7);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(calls).toHaveLength(2);
    expect(call(calls, 1)).toEqual(call(calls, 0));
  });

  it('retries a 429 only once', async () => {
    const { calls, sleep, github } = setup(
      { status: 429, body: { message: 'Too many requests' }, headers: { 'retry-after': '1' } },
      { status: 429, body: { message: 'Too many requests' }, headers: { 'retry-after': '1' } },
    );

    const error = await rejection(github.getRepository('acme', 'site'));

    expect(error.status).toBe(429);
    expect(sleep).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
  });

  it('does not wait more than 10 seconds', async () => {
    const { calls, sleep, github } = setup({
      status: 403,
      body: { message: SECONDARY_LIMIT },
      headers: { 'retry-after': '60' },
    });

    expect((await rejection(github.getRepository('acme', 'site'))).status).toBe(403);
    expect(sleep).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('waits 10 seconds on a secondary rate limit without retry-after', async () => {
    const { calls, sleep, github } = setup(
      { status: 403, body: { message: SECONDARY_LIMIT } },
      { body: repository('site', 501) },
    );

    await github.getRepository('acme', 'site');

    expect(sleep).toHaveBeenCalledExactlyOnceWith(10_000);
    expect(calls).toHaveLength(2);
  });

  it('reads retry-after given as an HTTP date', async () => {
    const { sleep, github } = setup(
      { status: 429, body: {}, headers: { 'retry-after': new Date(Date.now() + 5000).toUTCString() } },
      { body: repository('site', 501) },
    );

    await github.getRepository('acme', 'site');

    const waited = sleep.mock.calls[0]?.[0] ?? -1;
    expect(waited).toBeGreaterThanOrEqual(3000);
    expect(waited).toBeLessThanOrEqual(6000);
  });

  it('does not retry a primary rate limit, a permission error or a server error', async () => {
    const { calls, sleep, github } = setup(
      {
        status: 403,
        body: { message: 'API rate limit exceeded for installation ID 42.' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791200000' },
      },
      { status: 403, body: { message: 'Resource not accessible by integration' } },
      { status: 500, body: { message: 'Server Error' } },
    );

    expect((await rejection(github.getRepository('acme', 'site'))).status).toBe(403);
    expect((await rejection(github.getRepository('acme', 'site'))).message).toBe(
      'GitHub 403: Resource not accessible by integration',
    );
    expect((await rejection(github.getRepository('acme', 'site'))).status).toBe(500);
    expect(sleep).not.toHaveBeenCalled();
    expect(calls).toHaveLength(3);
  });
});

describe('graphql', () => {
  it('posts the query and variables and returns data', async () => {
    const { calls, github } = setup({ body: { data: { repository: { id: 'R_1' } } } });

    const data = await github.graphql<{ repository: { id: string } }>(
      'query($o: String!) { repository(owner: $o) { id } }',
      {
        o: 'acme',
      },
    );

    expect(data).toEqual({ repository: { id: 'R_1' } });
    expect(only(calls).url).toBe(`${API}/graphql`);
    expect(call(calls, 0).body).toEqual({
      query: 'query($o: String!) { repository(owner: $o) { id } }',
      variables: { o: 'acme' },
    });
  });

  it('throws GithubError when the response carries errors', async () => {
    const body = {
      data: null,
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['revertPullRequest'],
          locations: [{ line: 2, column: 3 }],
          message: "Could not resolve to a node with the global id of 'PR_missing'",
        },
      ],
    };
    const { github } = setup({ body });

    const error = await rejection(github.revertPullRequest('PR_missing'));

    expect(error.status).toBe(200);
    expect(error.message).toBe("GitHub 200: Could not resolve to a node with the global id of 'PR_missing'");
    expect(error.body).toEqual(body);
  });

  it('throws GithubError on HTTP failures', async () => {
    const { github } = setup({ status: 401, body: { message: 'Bad credentials' } });

    expect((await rejection(github.graphql('{ viewer { login } }'))).message).toBe('GitHub 401: Bad credentials');
  });
});

describe('repositories and branches', () => {
  it('gets a repository summary', async () => {
    const { calls, github } = setup({ body: repository('site', 501) });

    expect(await github.getRepository('acme', 'site')).toEqual({
      id: 501,
      node_id: 'R_kgDOH501',
      name: 'site',
      full_name: 'acme/site',
      owner: { login: 'acme' },
      default_branch: 'main',
      private: true,
      html_url: 'https://github.com/acme/site',
    });
    expect(only(calls)).toMatchObject({ method: 'GET', url: `${API}/repos/acme/site` });
  });

  it('reads the head of a branch, keeping slashes in the name', async () => {
    const { calls, github } = setup({
      body: {
        ref: 'refs/heads/feature/x',
        node_id: 'REF_kwDOH',
        url: `${API}/repos/acme/site/git/refs/heads/feature/x`,
        object: { sha: HEAD_SHA, type: 'commit', url: `${API}/repos/acme/site/git/commits/${HEAD_SHA}` },
      },
    });

    expect(await github.getBranchSha('acme', 'site', 'feature/x')).toBe(HEAD_SHA);
    expect(only(calls)).toMatchObject({ method: 'GET', url: `${API}/repos/acme/site/git/ref/heads/feature/x` });
  });

  it('returns null for a branch that does not exist', async () => {
    const { github } = setup({ status: 404, body: { message: 'Not Found' } });

    expect(await github.getBranchSha('acme', 'site', 'homolog')).toBeNull();
  });

  it('creates a branch', async () => {
    const { calls, github } = setup({
      status: 201,
      body: { ref: 'refs/heads/homolog', node_id: 'REF_1', object: { sha: BASE_SHA, type: 'commit' } },
    });

    await github.createBranch('acme', 'site', 'homolog', BASE_SHA);

    expect(only(calls)).toMatchObject({
      method: 'POST',
      url: `${API}/repos/acme/site/git/refs`,
      body: { ref: 'refs/heads/homolog', sha: BASE_SHA },
    });
  });

  it('moves a branch, encoding characters other than slashes', async () => {
    const { calls, github } = setup({
      body: { ref: 'refs/heads/feat/a b#1', object: { sha: HEAD_SHA, type: 'commit' } },
    });

    await github.updateBranch('acme', 'site', 'feat/a b#1', HEAD_SHA, true);

    expect(only(calls)).toMatchObject({
      method: 'PATCH',
      url: `${API}/repos/acme/site/git/refs/heads/feat/a%20b%231`,
      body: { sha: HEAD_SHA, force: true },
    });
  });

  it('deletes a branch and tolerates one that is already gone', async () => {
    const { calls, github } = setup(
      { status: 204 },
      { status: 422, body: { message: 'Reference does not exist' } },
      { status: 404, body: { message: 'Not Found' } },
      { status: 403, body: { message: 'Resource not accessible by integration' } },
    );

    await github.deleteBranch('acme', 'site', 'feature/x');
    await github.deleteBranch('acme', 'site', 'feature/x');
    await github.deleteBranch('acme', 'site', 'feature/x');
    expect((await rejection(github.deleteBranch('acme', 'site', 'feature/x'))).status).toBe(403);

    expect(call(calls, 0)).toMatchObject({ method: 'DELETE', url: `${API}/repos/acme/site/git/refs/heads/feature/x` });
  });

  it('refuses path segments that URL parsing would resolve', async () => {
    const { calls, github } = setup();

    await expect(github.getBranchSha('acme', 'site', '../../../user')).rejects.toThrow('Invalid GitHub path segment');
    await expect(github.getRepository('..', 'site')).rejects.toThrow('Invalid GitHub path segment');
    await expect(github.getRepository('acme', '')).rejects.toThrow('Invalid GitHub path segment');
    await expect(github.getFile('acme', 'site', 'docs/../.env')).rejects.toThrow('Invalid GitHub path segment');
    await expect(github.deleteBranch('acme', 'site', 'a//b')).rejects.toThrow('Invalid GitHub path segment');
    expect(calls).toHaveLength(0);
  });

  it('compares two branches', async () => {
    const { calls, github } = setup({
      body: {
        url: `${API}/repos/acme/site/compare/main...feature/x`,
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        base_commit: { sha: BASE_SHA },
        merge_base_commit: { sha: BASE_SHA },
        commits: [
          { sha: HEAD_SHA, commit: { message: 'Make the header blue', author: { name: 'bohr' } }, parents: [] },
          { sha: MERGE_SHA, commit: { message: 'Fix the footer\n\nDetails', author: { name: 'bohr' } }, parents: [] },
        ],
        files: [{ filename: 'src/header.css', status: 'modified', additions: 1, deletions: 1 }],
      },
    });

    expect(await github.compare('acme', 'site', 'main', 'feature/x')).toEqual({
      status: 'ahead',
      ahead_by: 2,
      behind_by: 0,
      commits: [
        { sha: HEAD_SHA, message: 'Make the header blue' },
        { sha: MERGE_SHA, message: 'Fix the footer\n\nDetails' },
      ],
    });
    expect(only(calls)).toMatchObject({ method: 'GET', url: `${API}/repos/acme/site/compare/main...feature/x` });
  });
});

describe('pull requests', () => {
  const summary = {
    number: 7,
    node_id: 'PR_kwDOH1a2b85sXyZ',
    html_url: 'https://github.com/acme/site/pull/7',
    state: 'open',
    merged: false,
    head: { ref: 'homolog', sha: HEAD_SHA },
    base: { ref: 'main' },
    title: 'Make the header blue',
  };

  it('finds the open pull request of a branch', async () => {
    const { calls, github } = setup({ body: [listedPullRequest()] });

    expect(await github.findOpenPullRequest('acme', 'site', 'homolog', 'main')).toEqual(summary);
    const url = new URL(only(calls).url);
    expect(url.pathname).toBe('/repos/acme/site/pulls');
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'open', head: 'acme:homolog', base: 'main' });
  });

  it('returns null when the branch has no open pull request', async () => {
    const { github } = setup({ body: [] });

    expect(await github.findOpenPullRequest('acme', 'site', 'homolog', 'main')).toBeNull();
  });

  it('reads merged state from merged_at on listed pull requests', async () => {
    const { github } = setup({ body: [listedPullRequest({ merged_at: '2026-10-11T12:30:00Z' })] });

    expect((await github.findOpenPullRequest('acme', 'site', 'homolog', 'main'))?.merged).toBe(true);
  });

  it('opens a pull request', async () => {
    const { calls, github } = setup({ status: 201, body: pullRequest() });

    const created = await github.createPullRequest('acme', 'site', {
      title: 'Make the header blue',
      head: 'homolog',
      base: 'main',
      body: 'Requested through bohr.',
    });

    expect(created).toEqual(summary);
    expect(only(calls)).toMatchObject({
      method: 'POST',
      url: `${API}/repos/acme/site/pulls`,
      body: { title: 'Make the header blue', head: 'homolog', base: 'main', body: 'Requested through bohr.' },
    });
  });

  it('gets a merged pull request', async () => {
    const { calls, github } = setup({
      body: pullRequest({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-11T12:30:00Z',
        merge_commit_sha: MERGE_SHA,
      }),
    });

    expect(await github.getPullRequest('acme', 'site', 7)).toEqual({ ...summary, state: 'closed', merged: true });
    expect(only(calls)).toMatchObject({ method: 'GET', url: `${API}/repos/acme/site/pulls/7` });
  });

  it('merges a pull request at the reviewed head', async () => {
    const { calls, github } = setup({
      body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
    });

    const result = await github.mergePullRequest('acme', 'site', 7, {
      sha: HEAD_SHA,
      mergeMethod: 'squash',
      commitTitle: 'Make the header blue (#7)',
      commitMessage: 'Requested through bohr.',
    });

    expect(result).toEqual({ sha: MERGE_SHA, merged: true });
    expect(only(calls)).toMatchObject({
      method: 'PUT',
      url: `${API}/repos/acme/site/pulls/7/merge`,
      body: {
        sha: HEAD_SHA,
        merge_method: 'squash',
        commit_title: 'Make the header blue (#7)',
        commit_message: 'Requested through bohr.',
      },
    });
  });

  it('leaves 405 and 409 merge refusals to the caller', async () => {
    const { calls, github } = setup(
      { status: 405, body: { message: 'Pull Request is not mergeable' } },
      { status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } },
    );

    expect(
      (await rejection(github.mergePullRequest('acme', 'site', 7, { sha: HEAD_SHA, mergeMethod: 'merge' }))).status,
    ).toBe(405);
    expect(
      (await rejection(github.mergePullRequest('acme', 'site', 7, { sha: HEAD_SHA, mergeMethod: 'rebase' }))).status,
    ).toBe(409);
    expect(call(calls, 0).body).toEqual({ sha: HEAD_SHA, merge_method: 'merge' });
  });

  it('closes a pull request', async () => {
    const { calls, github } = setup({ body: pullRequest({ state: 'closed', closed_at: '2026-10-11T13:00:00Z' }) });

    await github.closePullRequest('acme', 'site', 7);

    expect(only(calls)).toMatchObject({
      method: 'PATCH',
      url: `${API}/repos/acme/site/pulls/7`,
      body: { state: 'closed' },
    });
  });

  it('opens a revert pull request through GraphQL', async () => {
    const { calls, github } = setup({
      body: {
        data: {
          revertPullRequest: {
            revertPullRequest: { number: 8, id: 'PR_kwDOH1a2b85sXzA', url: 'https://github.com/acme/site/pull/8' },
          },
        },
      },
    });

    const revert = await github.revertPullRequest('PR_kwDOH1a2b85sXyZ', {
      title: 'Revert the header',
      body: 'Undo #7',
    });

    expect(revert).toEqual({
      number: 8,
      node_id: 'PR_kwDOH1a2b85sXzA',
      html_url: 'https://github.com/acme/site/pull/8',
    });
    const request = only(calls);
    expect(request).toMatchObject({ method: 'POST', url: `${API}/graphql` });
    const { query, variables } = request.body as { query: string; variables: unknown };
    expect(query).toContain('revertPullRequest(input: { pullRequestId: $pullRequestId, title: $title, body: $body })');
    expect(query).toContain('revertPullRequest { number id url }');
    expect(variables).toEqual({ pullRequestId: 'PR_kwDOH1a2b85sXyZ', title: 'Revert the header', body: 'Undo #7' });
  });

  it('lets GitHub title the revert when no input is given', async () => {
    const { calls, github } = setup({
      body: {
        data: {
          revertPullRequest: {
            revertPullRequest: { number: 9, id: 'PR_9', url: 'https://github.com/acme/site/pull/9' },
          },
        },
      },
    });

    await github.revertPullRequest('PR_kwDOH1a2b85sXyZ');

    expect((only(calls).body as { variables: unknown }).variables).toEqual({ pullRequestId: 'PR_kwDOH1a2b85sXyZ' });
  });

  it('fails clearly when GitHub returns no revert pull request', async () => {
    const { github } = setup({ body: { data: null } }, { body: { data: { revertPullRequest: null } } });

    await expect(github.revertPullRequest('PR_1')).rejects.toThrow('GitHub did not return the revert pull request');
    await expect(github.revertPullRequest('PR_1')).rejects.toThrow('GitHub did not return the revert pull request');
  });
});

describe('workflow runs', () => {
  it('lists runs filtered by branch, commit and event', async () => {
    const { calls, github } = setup({
      body: {
        total_count: 2,
        workflow_runs: [workflowRun(30433642), workflowRun(30433643, { status: 'in_progress', conclusion: null })],
      },
    });

    const runs = await github.listWorkflowRuns('acme', 'site', {
      branch: 'main',
      headSha: MERGE_SHA,
      event: 'push',
      perPage: 5,
    });

    expect(runs).toEqual([
      {
        id: 30433642,
        name: 'Deploy',
        display_title: 'Make the header blue (#7)',
        run_number: 42,
        head_branch: 'main',
        head_sha: MERGE_SHA,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/site/actions/runs/30433642',
        event: 'push',
        created_at: '2026-10-11T12:10:00Z',
        updated_at: '2026-10-11T12:12:30Z',
      },
      expect.objectContaining({ id: 30433643, status: 'in_progress', conclusion: null }),
    ]);
    const url = new URL(only(calls).url);
    expect(url.pathname).toBe('/repos/acme/site/actions/runs');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      branch: 'main',
      head_sha: MERGE_SHA,
      event: 'push',
      per_page: '5',
    });
  });

  it('sends no query without a filter', async () => {
    const { calls, github } = setup({ body: { total_count: 0, workflow_runs: [] } });

    expect(await github.listWorkflowRuns('acme', 'site')).toEqual([]);
    expect(only(calls).url).toBe(`${API}/repos/acme/site/actions/runs`);
  });
});

describe('files', () => {
  const text = '# Guia rápido\n\nOlá, mundo ✓ — 🚀\n'.repeat(4);

  it('reads a file at a ref and decodes it as UTF-8', async () => {
    const { calls, github } = setup({
      body: {
        type: 'file',
        encoding: 'base64',
        size: 160,
        name: 'guia rápido.md',
        path: 'docs/guia rápido.md',
        content: wrappedBase64(text),
        sha: '3d21ec53a331a6f037a91c368710b99387d012c1',
        url: `${API}/repos/acme/site/contents/docs/guia%20r%C3%A1pido.md?ref=homolog`,
      },
    });

    expect(await github.getFile('acme', 'site', 'docs/guia rápido.md', 'homolog')).toEqual({
      sha: '3d21ec53a331a6f037a91c368710b99387d012c1',
      content: text,
    });
    expect(only(calls).url).toBe(`${API}/repos/acme/site/contents/docs/guia%20r%C3%A1pido.md?ref=homolog`);
  });

  it('returns null for a missing file', async () => {
    const { calls, github } = setup({ status: 404, body: { message: 'Not Found' } });

    expect(await github.getFile('acme', 'site', '/bohr.json')).toBeNull();
    expect(only(calls).url).toBe(`${API}/repos/acme/site/contents/bohr.json`);
  });

  it('refuses directories', async () => {
    const { github } = setup({ body: [{ type: 'file', name: 'a.ts', path: 'src/a.ts', sha: 'abc' }] });

    await expect(github.getFile('acme', 'site', 'src')).rejects.toThrow('src is not a file');
  });

  it('falls back to the blob API for files over 1 MB', async () => {
    const { calls, github } = setup(
      { body: { type: 'file', encoding: 'none', size: 2_000_000, content: '', sha: 'b10b' } },
      { body: { sha: 'b10b', size: 2_000_000, encoding: 'base64', content: wrappedBase64(text) } },
    );

    expect(await github.getFile('acme', 'site', 'big.json')).toEqual({ sha: 'b10b', content: text });
    expect(call(calls, 1).url).toBe(`${API}/repos/acme/site/git/blobs/b10b`);
  });

  it('writes a file as one commit, base64-encoding UTF-8', async () => {
    const { calls, github } = setup(
      {
        status: 201,
        body: {
          content: { name: 'bohr.json', path: 'bohr.json', sha: 'newblob' },
          commit: { sha: HEAD_SHA, message: 'Add bohr.json' },
        },
      },
      { body: { content: { name: 'bohr.json', sha: 'newer' }, commit: { sha: MERGE_SHA } } },
    );

    expect(
      await github.putFile('acme', 'site', 'bohr.json', { content: text, message: 'Add bohr.json', branch: 'homolog' }),
    ).toEqual({
      commitSha: HEAD_SHA,
    });
    const created = call(calls, 0);
    expect(created).toMatchObject({ method: 'PUT', url: `${API}/repos/acme/site/contents/bohr.json` });
    const body = created.body as { content: string };
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(text);
    expect(created.body).toEqual({ message: 'Add bohr.json', content: body.content, branch: 'homolog' });

    await github.putFile('acme', 'site', 'bohr.json', {
      content: '{}',
      message: 'Update',
      branch: 'homolog',
      sha: 'newblob',
    });
    expect(call(calls, 1).body).toMatchObject({ sha: 'newblob', content: 'e30=' });
  });

  it('lists a directory, empty when it does not exist', async () => {
    const { calls, github } = setup(
      {
        body: [
          { type: 'file', name: 'bohr.yml', path: '.github/workflows/bohr.yml', sha: 'b1', size: 10 },
          { type: 'dir', name: 'scripts', path: '.github/workflows/scripts', sha: 'd1', size: 0 },
        ],
      },
      { status: 404, body: { message: 'Not Found' } },
    );

    expect(await github.listDirectory('acme', 'site', '.github/workflows', 'main')).toEqual([
      { name: 'bohr.yml', path: '.github/workflows/bohr.yml', type: 'file', sha: 'b1' },
      { name: 'scripts', path: '.github/workflows/scripts', type: 'dir', sha: 'd1' },
    ]);
    expect(call(calls, 0).url).toBe(`${API}/repos/acme/site/contents/.github/workflows?ref=main`);
    expect(await github.listDirectory('acme', 'site', '.github/workflows')).toEqual([]);
  });

  it('deletes a file as one commit', async () => {
    const { calls, github } = setup({ body: { content: null, commit: { sha: HEAD_SHA } } });

    expect(
      await github.deleteFile('acme', 'site', '.github/workflows/bohr.yml', {
        message: 'Remove the v1 workflow',
        branch: 'homolog',
        sha: 'b1',
      }),
    ).toEqual({ commitSha: HEAD_SHA });
    expect(only(calls)).toMatchObject({
      method: 'DELETE',
      url: `${API}/repos/acme/site/contents/.github/workflows/bohr.yml`,
      body: { message: 'Remove the v1 workflow', branch: 'homolog', sha: 'b1' },
    });
  });
});

describe('workflow jobs', () => {
  it('lists the jobs of a run and reads a job log as text', async () => {
    const { calls, github } = setup(
      {
        body: {
          jobs: [
            {
              id: 7,
              name: 'deploy',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2026-10-11T10:00:00Z',
              completed_at: '2026-10-11T10:01:00Z',
              html_url: 'https://github.com/acme/site/actions/runs/1/job/7',
              steps: [{ number: 1, name: 'Build', status: 'completed', conclusion: 'failure', extra: 'x' }],
            },
          ],
        },
      },
      { body: '2026-10-11T10:00:01.0000000Z npm ERR! missing script: build' },
    );
    const jobs = await github.listRunJobs('acme', 'site', 1);
    expect(jobs[0]).toMatchObject({
      id: 7,
      conclusion: 'failure',
      steps: [{ number: 1, name: 'Build', status: 'completed', conclusion: 'failure' }],
    });
    expect(call(calls, 0)).toMatchObject({
      method: 'GET',
      url: `${API}/repos/acme/site/actions/runs/1/jobs?per_page=50`,
    });
    expect(await github.getJobLogs('acme', 'site', 7)).toContain('missing script: build');
    expect(call(calls, 1)).toMatchObject({ url: `${API}/repos/acme/site/actions/jobs/7/logs` });
  });
});

describe('Actions secrets', () => {
  it('deletes a secret, and a missing one is already gone', async () => {
    const { calls, github } = setup({ status: 204 }, { status: 404, body: { message: 'Not Found' } });
    await github.deleteActionsSecret('acme', 'site', 'BOHR_BUILD_API_URL');
    await github.deleteActionsSecret('acme', 'site', 'GONE');
    expect(call(calls, 0)).toMatchObject({
      method: 'DELETE',
      url: `${API}/repos/acme/site/actions/secrets/BOHR_BUILD_API_URL`,
    });
    expect(calls).toHaveLength(2);
  });

  it("seals the value with the repository's public key", async () => {
    const keys = sodium.crypto_box_keypair();
    const { calls, github } = setup(
      {
        body: { key_id: '568250167242549743', key: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL) },
      },
      { status: 201 },
    );

    await github.setActionsSecret('acme', 'site', 'BOHR_TOKEN', 'bohr_s3cr3t-välue');

    expect(call(calls, 0)).toMatchObject({ method: 'GET', url: `${API}/repos/acme/site/actions/secrets/public-key` });
    const put = call(calls, 1);
    expect(put).toMatchObject({ method: 'PUT', url: `${API}/repos/acme/site/actions/secrets/BOHR_TOKEN` });
    const body = put.body as { encrypted_value: string; key_id: string };
    expect(body.key_id).toBe('568250167242549743');
    const sealed = sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL);
    expect(sodium.to_string(sodium.crypto_box_seal_open(sealed, keys.publicKey, keys.privateKey))).toBe(
      'bohr_s3cr3t-välue',
    );
  });
});

describe('installations and users', () => {
  const page = (url: string) =>
    `<${url}>; rel="next", <${API}/installation/repositories?per_page=100&page=3>; rel="last"`;

  it('lists installation repositories across pages', async () => {
    const { calls, github } = setup(
      {
        body: {
          total_count: 3,
          repository_selection: 'selected',
          repositories: [repository('site', 501), repository('api', 502)],
        },
        headers: { link: page(`${API}/installation/repositories?per_page=100&page=2`) },
      },
      {
        body: { total_count: 3, repository_selection: 'selected', repositories: [repository('docs', 503)] },
        headers: {
          link: `<${API}/installation/repositories?per_page=100&page=1>; rel="prev", <${API}/installation/repositories?per_page=100&page=1>; rel="first"`,
        },
      },
    );

    const repositories = await github.listInstallationRepositories();

    expect(repositories.map((repo) => repo.full_name)).toEqual(['acme/site', 'acme/api', 'acme/docs']);
    expect(repositories[2]).toEqual({
      id: 503,
      node_id: 'R_kgDOH503',
      name: 'docs',
      full_name: 'acme/docs',
      owner: { login: 'acme' },
      default_branch: 'main',
      private: true,
      html_url: 'https://github.com/acme/docs',
    });
    expect(calls.map((request) => request.url)).toEqual([
      `${API}/installation/repositories?per_page=100`,
      `${API}/installation/repositories?per_page=100&page=2`,
    ]);
  });

  it('stops after 20 pages', async () => {
    let served = 0;
    const fetch = (async () => {
      served++;
      return Response.json(
        { total_count: 5000, repositories: [repository(`r${served}`, served)] },
        { headers: { link: `<${API}/installation/repositories?per_page=100&page=${served + 1}>; rel="next"` } },
      );
    }) as typeof globalThis.fetch;

    const repositories = await new GithubClient({ token: 't', fetch }).listInstallationRepositories();

    expect(served).toBe(20);
    expect(repositories).toHaveLength(20);
  });

  it('refuses to follow a pagination link to another host', async () => {
    const { calls, github } = setup({
      body: { total_count: 2, repositories: [repository('site', 501)] },
      headers: { link: '<https://api.github.com.evil.example/installation/repositories?page=2>; rel="next"' },
    });

    await expect(github.listInstallationRepositories()).rejects.toThrow('Refusing to follow a pagination link');
    expect(calls).toHaveLength(1);
  });

  it('resolves a relative pagination link against the current page', async () => {
    const { calls, github } = setup(
      {
        body: { total_count: 2, repositories: [repository('site', 501)] },
        headers: { link: '</installation/repositories?per_page=100&page=2>; rel="next"' },
      },
      { body: { total_count: 2, repositories: [repository('api', 502)] } },
    );

    expect((await github.listInstallationRepositories()).map((repo) => repo.name)).toEqual(['site', 'api']);
    expect(call(calls, 1).url).toBe(`${API}/installation/repositories?per_page=100&page=2`);
  });

  it("lists the user's installations", async () => {
    const { calls, github } = setup({
      body: {
        total_count: 3,
        installations: [
          { id: 42, account: owner, app_id: 12345, target_type: 'Organization', repository_selection: 'selected' },
          { id: 43, account: { login: 'ada', id: 7, type: 'User' }, app_id: 12345, target_type: 'User' },
          {
            id: 44,
            account: { slug: 'acme-enterprise', name: 'Acme Enterprise' },
            app_id: 12345,
            target_type: 'Enterprise',
          },
        ],
      },
    });

    expect(await github.listUserInstallations()).toEqual([
      { id: 42, account: { login: 'acme', type: 'Organization' } },
      { id: 43, account: { login: 'ada', type: 'User' } },
      { id: 44, account: { login: 'acme-enterprise', type: 'Enterprise' } },
    ]);
    expect(only(calls).url).toBe(`${API}/user/installations?per_page=100`);
  });

  it("lists the repositories of a user's installation", async () => {
    const { calls, github } = setup({
      body: { total_count: 1, repository_selection: 'all', repositories: [repository('site', 501)] },
    });

    expect((await github.listUserInstallationRepositories(42)).map((repo) => repo.name)).toEqual(['site']);
    expect(only(calls).url).toBe(`${API}/user/installations/42/repositories?per_page=100`);
  });

  it('creates a repository from a template, with the default branch only', async () => {
    const { calls, github } = setup({ status: 201, body: { ...repository('menu', 777), private: false } });

    const created = await github.generateRepository('bohr-io', 'template-menu', {
      owner: 'acme',
      name: 'menu',
      private: false,
    });

    expect(created).toMatchObject({ id: 777, full_name: 'acme/menu', default_branch: 'main', private: false });
    expect(only(calls)).toMatchObject({
      method: 'POST',
      url: `${API}/repos/bohr-io/template-menu/generate`,
      body: { owner: 'acme', name: 'menu', private: false, include_all_branches: false },
    });
  });

  it('adds a repository to an installation limited to selected repositories', async () => {
    const { calls, github } = setup({ status: 204 });

    await github.addRepositoryToInstallation(42, 777);

    expect(only(calls)).toMatchObject({ method: 'PUT', url: `${API}/user/installations/42/repositories/777` });
  });

  it('gets the authenticated user', async () => {
    const { calls, github } = setup({
      body: { login: 'ada', id: 7, node_id: 'U_1', type: 'User', name: 'Ada Lovelace', email: null, company: 'acme' },
    });

    expect(await github.getAuthenticatedUser()).toEqual({ id: 7, login: 'ada', name: 'Ada Lovelace', email: null });
    expect(only(calls)).toMatchObject({ method: 'GET', url: `${API}/user` });
  });
});

describe('organizations', () => {
  it('lists the members of a role across pages', async () => {
    const { calls, github } = setup(
      {
        body: [{ id: 1, login: 'ada', avatar_url: 'https://avatars.example/1' }],
        headers: { link: '<https://api.github.com/orgs/acme/members?role=admin&per_page=100&page=2>; rel="next"' },
      },
      { body: [{ id: 2, login: 'grace' }] },
    );

    expect(await github.listOrgMembers('acme', 'admin')).toEqual([
      { id: 1, login: 'ada', avatar_url: 'https://avatars.example/1' },
      { id: 2, login: 'grace', avatar_url: null },
    ]);
    expect(call(calls, 0).url).toBe(`${API}/orgs/acme/members?role=admin&per_page=100`);
    expect(call(calls, 1).url).toBe(`${API}/orgs/acme/members?role=admin&per_page=100&page=2`);
  });

  it('reports a missing Members permission as a 403', async () => {
    const { github } = setup({ status: 403, body: { message: 'Resource not accessible by integration' } });

    expect((await rejection(github.listOrgMembers('acme'))).status).toBe(403);
  });

  it('reads an organization and an installation with its account', async () => {
    const { calls, github } = setup(
      { body: { id: 9, login: 'acme', name: 'Acme Inc', avatar_url: 'https://avatars.example/9' } },
      {
        body: {
          id: 42,
          account: { id: 9, login: 'acme', type: 'Organization', avatar_url: 'https://avatars.example/9' },
          permissions: { members: 'read', metadata: 'read' },
          repository_selection: 'selected',
        },
      },
    );

    expect(await github.getOrganization('acme')).toEqual({
      id: 9,
      login: 'acme',
      name: 'Acme Inc',
      avatar_url: 'https://avatars.example/9',
    });
    expect(await github.getAppInstallation(42)).toEqual({
      id: 42,
      account: { id: 9, login: 'acme', type: 'Organization', avatar_url: 'https://avatars.example/9' },
      permissions: { members: 'read', metadata: 'read' },
      repository_selection: 'selected',
    });
    expect(call(calls, 1).url).toBe(`${API}/app/installations/42`);
  });
});

describe('nextPageUrl', () => {
  it('finds rel="next" in a Link header', () => {
    expect(
      nextPageUrl(`<${API}/user/installations?page=1>; rel="prev", <${API}/user/installations?page=3>; rel="next"`),
    ).toBe(`${API}/user/installations?page=3`);
    expect(nextPageUrl(`<${API}/x?page=2>; rel="next last"`)).toBe(`${API}/x?page=2`);
    expect(nextPageUrl(`<${API}/x?page=1>; rel="first"`)).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});
