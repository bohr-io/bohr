// Trimmed copies of real GitHub REST responses; the extra fields check that the client maps rather than passes through

export const HEAD_SHA = '6dcb09b5b57875f334f61aebed695e2e4193db5e';
export const BASE_SHA = 'e5bd3914e2e596debea16f433f57875b5b90bcd6';
export const MERGE_SHA = '7638417db6d59f3c431d3e1f261cc637155684cd';

export const owner = {
  login: 'acme',
  id: 1001,
  node_id: 'O_kgDOAbCdEf',
  type: 'Organization',
  site_admin: false,
  html_url: 'https://github.com/acme',
};

export function repository(name: string, id: number) {
  return {
    id,
    node_id: `R_kgDOH${id}`,
    name,
    full_name: `acme/${name}`,
    private: true,
    owner,
    html_url: `https://github.com/acme/${name}`,
    description: null,
    fork: false,
    url: `https://api.github.com/repos/acme/${name}`,
    created_at: '2026-01-05T10:00:00Z',
    updated_at: '2026-10-01T09:30:00Z',
    pushed_at: '2026-10-10T18:45:12Z',
    default_branch: 'main',
    visibility: 'private',
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
  };
}

/** As the list endpoint returns it: no `merged` field, only `merged_at`. */
export function listedPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://api.github.com/repos/acme/site/pulls/7',
    id: 2153687654,
    node_id: 'PR_kwDOH1a2b85sXyZ',
    html_url: 'https://github.com/acme/site/pull/7',
    diff_url: 'https://github.com/acme/site/pull/7.diff',
    number: 7,
    state: 'open',
    locked: false,
    title: 'Make the header blue',
    user: { login: 'bohr-dev[bot]', id: 2001, type: 'Bot' },
    body: 'Requested through bohr.',
    created_at: '2026-10-11T12:00:00Z',
    updated_at: '2026-10-11T12:05:00Z',
    closed_at: null,
    merged_at: null,
    merge_commit_sha: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8',
    draft: false,
    head: { label: 'acme:homolog', ref: 'homolog', sha: HEAD_SHA, user: owner, repo: repository('site', 501) },
    base: { label: 'acme:main', ref: 'main', sha: BASE_SHA, user: owner, repo: repository('site', 501) },
    author_association: 'NONE',
    ...overrides,
  };
}

/** As GET/POST/PATCH of a single pull request return it. */
export function pullRequest(overrides: Record<string, unknown> = {}) {
  return listedPullRequest({
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    merged_by: null,
    comments: 0,
    commits: 1,
    additions: 3,
    deletions: 1,
    changed_files: 1,
    ...overrides,
  });
}

export function workflowRun(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Deploy',
    node_id: `WFR_kwLOH${id}`,
    head_branch: 'main',
    head_sha: MERGE_SHA,
    path: '.github/workflows/bohr.yml',
    display_title: 'Make the header blue (#7)',
    run_number: 42,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    workflow_id: 9001,
    url: `https://api.github.com/repos/acme/site/actions/runs/${id}`,
    html_url: `https://github.com/acme/site/actions/runs/${id}`,
    created_at: '2026-10-11T12:10:00Z',
    updated_at: '2026-10-11T12:12:30Z',
    run_attempt: 1,
    run_started_at: '2026-10-11T12:10:05Z',
    ...overrides,
  };
}

/** GitHub's contents API wraps base64 at 60 characters. */
export function wrappedBase64(text: string): string {
  return (
    Buffer.from(text, 'utf8')
      .toString('base64')
      .match(/.{1,60}/g)
      ?.join('\n')
      .concat('\n') ?? ''
  );
}
