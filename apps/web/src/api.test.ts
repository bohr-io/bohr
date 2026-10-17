import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  agentApi,
  api,
  detailAccess,
  detailOrg,
  loginPath,
  safeRedirect,
  setRequestLocale,
  setUnauthorizedHandler,
  toApiError,
} from './api';
import { fakeApi, json } from './test-utils';

describe('API client', () => {
  beforeEach(() => {
    setRequestLocale('pt-BR');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => undefined);
  });

  it('sends mutations as JSON, with the session cookie and the interface language', async () => {
    const { fetch } = fakeApi({ 'POST /api/onboarding/cloudflare': { body: { status: 'connected' } } });

    await api.connectCloudflare('a-cloudflare-token');

    const [url, init] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe('/api/onboarding/cloudflare');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Accept-Language')).toBe('pt-BR');
    expect(init?.body).toBe(JSON.stringify({ token: 'a-cloudflare-token' }));
  });

  it('sends an empty JSON object for mutations without a body (the API answers 415 otherwise)', async () => {
    const { calls } = fakeApi({ 'POST /api/projects/p1/agent/rollback': { body: { message: 'ok' } } });

    await agentApi('p1').rollback();

    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toEqual({});
  });

  it('sends neither a body nor Content-Type with GET and DELETE', async () => {
    const { fetch } = fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'DELETE /api/projects/p1/agent/members/tg%3A42': { body: { revoked: true } },
    });

    await api.projects();
    await agentApi('p1').revoke('tg:42');

    for (const [, init] of fetch.mock.calls) {
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    }
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/projects/p1/agent/members/tg%3A42');
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });

  it('sends a JSON body with DELETE when the call has one (deleting a project)', async () => {
    const { calls } = fakeApi({ 'DELETE /api/projects/p1': { body: { warnings: [] } } });

    await expect(api.deleteProject('p1', { confirm: 'Loja', deleteSite: true })).resolves.toEqual({ warnings: [] });

    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toEqual({ confirm: 'Loja', deleteSite: true });
  });

  it('reads, saves and removes the agent settings of the user', async () => {
    const agent = {
      configured: true,
      provider: 'anthropic',
      baseUrl: null,
      model: null,
      effort: null,
      keyHint: '…abcd',
    };
    const { calls } = fakeApi({
      'GET /api/me/agent': { body: { agent } },
      'PUT /api/me/agent': { body: { agent, projects: { applied: 1, failed: 0 } } },
      'DELETE /api/me/agent': { body: { agent: { ...agent, configured: false } } },
    });

    expect((await api.agentSettings()).agent.keyHint).toBe('…abcd');
    await api.saveAgentSettings({ provider: 'compatible', baseUrl: 'https://openrouter.ai/api', model: 'x/y' });
    await api.removeAgentSettings();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/me/agent',
      'PUT /api/me/agent',
      'DELETE /api/me/agent',
    ]);
    expect(calls[1]?.body).toEqual({ provider: 'compatible', baseUrl: 'https://openrouter.ai/api', model: 'x/y' });
    expect(calls[2]?.body).toBeUndefined();
  });

  it('connects a Claude subscription: start, finish with the code, cancel', async () => {
    // The instance's sign-in container: no project (projectId null)
    const login = { projectId: null, loginId: 'login_0123456789', url: 'https://claude.com/cai/oauth/authorize?x=1' };
    const agent = {
      configured: true,
      provider: 'subscription',
      baseUrl: null,
      model: null,
      effort: null,
      keyHint: '…wxyz',
    };
    const { calls } = fakeApi({
      'POST /api/me/agent/subscription/start': { body: login },
      'POST /api/me/agent/subscription/finish': { body: { agent, projects: { applied: 1, failed: 0 } } },
      'POST /api/me/agent/subscription/cancel': { body: { cancelled: true } },
    });

    expect(await api.startSubscription()).toEqual(login);
    expect((await api.finishSubscription({ projectId: null, loginId: login.loginId, code: 'a#b' })).agent).toEqual(
      agent,
    );
    await api.cancelSubscription({ projectId: null, loginId: login.loginId });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/me/agent/subscription/start',
      'POST /api/me/agent/subscription/finish',
      'POST /api/me/agent/subscription/cancel',
    ]);
    expect(calls[0]?.body).toEqual({});
    expect(calls[1]?.body).toEqual({ projectId: null, loginId: 'login_0123456789', code: 'a#b' });
  });

  it('creates projects and reads builds at their own paths', async () => {
    const { calls } = fakeApi({
      'GET /api/repositories': { body: { repositories: [] } },
      'POST /api/projects': { status: 201, body: { projectId: 'p9' } },
      'GET /api/projects/p9/builds': { body: { builds: [] } },
      'GET /api/projects/p9/builds/42': { body: { jobs: [] } },
    });

    await api.repositories();
    await expect(api.createProject({ repository: 'acme/loja', locale: 'en' })).resolves.toEqual({ projectId: 'p9' });
    await api.builds('p9');
    await api.buildJobs('p9', 42);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/repositories',
      'POST /api/projects',
      'GET /api/projects/p9/builds',
      'GET /api/projects/p9/builds/42',
    ]);
  });

  it('signs in with a code sent by email, leaving its 401s to the page', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const { calls } = fakeApi({
      'GET /auth/methods': { body: { github: false, email: true } },
      'POST /auth/email/start': { body: { sent: true } },
      'POST /auth/email/verify': [
        { status: 400, body: { error: 'Wrong code.', attemptsLeft: 4 } },
        { body: { redirect: '/projects' } },
      ],
    });

    await expect(api.authMethods()).resolves.toEqual({ github: false, email: true });
    await api.emailStart({ email: 'ana@example.com', redirect: '/projects/p1', locale: 'en' });
    const wrong = await api
      .emailVerify({ email: 'ana@example.com', code: '000000' })
      .catch((caught: unknown) => caught);
    await expect(api.emailVerify({ email: 'ana@example.com', code: '123456' })).resolves.toEqual({
      redirect: '/projects',
    });

    expect(calls[1]?.body).toEqual({ email: 'ana@example.com', redirect: '/projects/p1', locale: 'en' });
    expect(wrong).toMatchObject({ status: 400, message: 'Wrong code.', body: { attemptsLeft: 4 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('manages the connected accounts and deletes the account', async () => {
    // The instance answers the disconnections with the connections as they are now (GET /api/me/connections)
    const view = {
      identities: [],
      githubInstallations: [],
      cloudflare: [],
      telegram: null,
      agent: { configured: false, provider: null, baseUrl: null, model: null, effort: null, keyHint: null },
      subscription: null,
    };
    const { calls } = fakeApi({
      'GET /api/me/connections': { body: view },
      'DELETE /api/me/identities/email': { body: view },
      'POST /api/me/email/start': { body: { sent: true } },
      'POST /api/me/email/verify': { body: { identity: { provider: 'email', username: 'ana@example.com' } } },
      'DELETE /api/me/github-installations/41001': { body: view },
      'DELETE /api/me/cloudflare/cf_1': { body: { ...view, hint: 'Delete the token.' } },
      'DELETE /api/me': { body: { warnings: [] } },
    });

    await api.connections();
    await api.removeIdentity('email');
    await api.linkEmailStart('ana@example.com');
    await api.linkEmailVerify('ana@example.com', '123456');
    // GitHub's installation ids are numbers
    await api.disconnectGithubInstallation(41001);
    await expect(api.disconnectCloudflare('cf_1')).resolves.toMatchObject({ hint: 'Delete the token.' });
    await api.deleteAccount({ deleteSites: true });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/me/connections',
      'DELETE /api/me/identities/email',
      'POST /api/me/email/start',
      'POST /api/me/email/verify',
      'DELETE /api/me/github-installations/41001',
      'DELETE /api/me/cloudflare/cf_1',
      'DELETE /api/me',
    ]);
    expect(calls[1]?.body).toBeUndefined();
    expect(calls[3]?.body).toEqual({ email: 'ana@example.com', code: '123456' });
    expect(calls[6]?.body).toEqual({ confirm: true, deleteSites: true });
  });

  it('calls the admin API', async () => {
    const { calls } = fakeApi({
      'GET /api/manage/overview': { body: {} },
      'POST /api/manage/runtimes/update': { body: { version: '0.9.3', updating: [] } },
      'GET /api/manage/users': { body: { users: [], total: 0 } },
      'GET /api/manage/users/u_2': { body: {} },
      'PUT /api/manage/users/u_2/role': { body: {} },
      'DELETE /api/manage/users/u_2': { body: { warnings: [] } },
      'GET /api/manage/projects': { body: { projects: [], total: 0 } },
      'GET /api/manage/telemetry': { body: {} },
      'PUT /api/manage/telemetry': { body: {} },
      'GET /api/projects/p1': { body: { project: { access: 'admin', org: null }, access: 'admin', org: null } },
    });

    await api.manageOverview();
    await api.updateRuntimes();
    await api.manageUsers({ query: 'ana', page: 2 });
    await api.manageUser('u_2');
    await api.setUserRole('u_2', 'admin');
    await api.deleteUser('u_2', { deleteSites: false });
    await api.manageProjects({ page: 1 });
    await api.telemetry();
    await api.setTelemetry(true);
    await expect(api.project('p1')).resolves.toMatchObject({ access: 'admin' });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/manage/overview',
      'POST /api/manage/runtimes/update',
      'GET /api/manage/users',
      'GET /api/manage/users/u_2',
      'PUT /api/manage/users/u_2/role',
      'DELETE /api/manage/users/u_2',
      'GET /api/manage/projects',
      'GET /api/manage/telemetry',
      'PUT /api/manage/telemetry',
      'GET /api/projects/p1',
    ]);
    expect(calls[2]?.query.toString()).toBe('query=ana&page=2');
    expect(calls[4]?.body).toEqual({ role: 'admin' });
    expect(calls[5]?.body).toEqual({ deleteSites: false });
    expect(calls[6]?.query.get('query')).toBeNull();
    expect(calls[8]?.body).toEqual({ enabled: true });
  });

  it('puts query parameters on the runtime calls', async () => {
    const { calls } = fakeApi({ 'GET /api/projects/p%2F1/agent/messages': { body: { messages: [], last: 0 } } });

    await agentApi('p/1').messages(42, 100);

    expect(calls[0]?.query.get('after')).toBe('42');
    expect(calls[0]?.query.get('limit')).toBe('100');
  });

  it('keeps the runtime error code and message', async () => {
    fakeApi({
      'POST /api/projects/p1/agent/messages': {
        status: 409,
        body: { error: 'not_accepted', message: 'O agente está desligado.' },
      },
    });

    const error = await agentApi('p1')
      .send('oi')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'not_accepted', message: 'O agente está desligado.' });
  });

  it('turns the instance sentence into the message, with an http_<status> code', async () => {
    fakeApi({ 'GET /api/projects/p1/runtime': { status: 404, body: { error: 'Project not found.' } } });

    const error = await api.runtime('p1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 404, code: 'http_404', message: 'Project not found.' });
  });

  it('maps bodies that are not JSON and bodies without error', () => {
    expect(toApiError(502, 'Bad gateway', 'Bad Gateway')).toMatchObject({ code: 'http_502', message: 'Bad Gateway' });
    expect(toApiError(403, { error: 'not_a_member' }, 'Forbidden')).toMatchObject({
      code: 'not_a_member',
      message: 'Forbidden',
    });
    expect(toApiError(400, { error: 'Invalid request.', issues: [] }, 'Bad Request')).toMatchObject({
      code: 'http_400',
      message: 'Invalid request.',
    });
  });

  it('reports a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await api.projects().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('resolves 204 responses to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(204, null)));

    await expect(api.logout()).resolves.toBeNull();
  });

  it('sends a 401 to the sign-in handler with the current path', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    window.history.replaceState({}, '', '/projects/p1?tab=versions');
    fakeApi({ 'GET /api/projects': { status: 401, body: { error: 'Not signed in.' } } });

    await expect(api.projects()).rejects.toMatchObject({ status: 401 });

    expect(handler).toHaveBeenCalledWith('/projects/p1?tab=versions');
  });

  it('leaves the 401 of the session probe to its caller', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fakeApi({ 'GET /api/me': { status: 401, body: { error: 'Not signed in.' } } });

    await expect(api.me()).rejects.toMatchObject({ status: 401 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls the organization endpoints with their paths and bodies', async () => {
    const agent = { configured: true, provider: 'anthropic', baseUrl: null, model: null, effort: null, keyHint: '…a1' };
    const saved = { body: { agent, projects: { applied: 2, failed: 0 } } };
    const { calls } = fakeApi({
      'GET /api/orgs': { body: { orgs: [] } },
      'GET /api/orgs/install-url': { body: { url: 'https://github.com/apps/bohr/installations/new?state=s' } },
      'GET /api/orgs/acme': { body: { org: { slug: 'acme' }, billing: { enabled: true, subscribed: false } } },
      'GET /api/orgs/acme/members': { body: { members: [] } },
      'POST /api/orgs/acme/members/sync': {
        body: { members: [], added: 0, removed: 0, updated: 0, membersPermission: true },
      },
      'PUT /api/orgs/acme/members/42': { body: { members: [] } },
      'DELETE /api/orgs/acme/members/42': { body: { members: [] } },
      'GET /api/orgs/acme/agent': { body: { agent } },
      'PUT /api/orgs/acme/agent': saved,
      'DELETE /api/orgs/acme/agent': { body: { agent } },
      'POST /api/orgs/acme/agent/subscription/start': { body: { projectId: 'p1', loginId: 'l1', url: 'https://c' } },
      'POST /api/orgs/acme/agent/subscription/finish': saved,
      'POST /api/orgs/acme/agent/subscription/cancel': { body: { cancelled: true } },
      'GET /api/orgs/acme/cloudflare': { body: { connections: [], tokenTemplateUrl: 'https://t' } },
      'POST /api/orgs/acme/cloudflare': { body: { status: 'choose_account', accounts: [] } },
      'POST /api/orgs/acme/cloudflare/account': { body: { status: 'connected', connectionId: 'c', accountName: null } },
      'DELETE /api/orgs/acme/cloudflare/cf_1': {
        body: { connections: [], tokenTemplateUrl: 'https://t', hint: 'Delete the token in Cloudflare too.' },
      },
      'POST /api/orgs/acme/billing/checkout': { body: { url: 'https://checkout' } },
      'POST /api/orgs/acme/billing/portal': { body: { url: 'https://portal' } },
      'DELETE /api/orgs/acme': { body: { warnings: [] } },
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/repositories': { body: { repositories: [] } },
      'POST /api/projects': { body: { projectId: 'p2' } },
      'GET /api/manage/orgs': { body: { orgs: [], total: 0 } },
    });

    await api.orgs();
    await api.orgInstallUrl();
    await api.org('acme');
    await api.orgMembers('acme');
    await api.syncOrgMembers('acme');
    await api.setOrgMemberRole('acme', 42, 'admin');
    await api.removeOrgMember('acme', 42);
    await api.orgAgentSettings('acme');
    await api.saveOrgAgentSettings('acme', { provider: 'anthropic', apiKey: 'sk-ant-x' });
    await api.removeOrgAgentSettings('acme');
    await api.startOrgSubscription('acme');
    await api.finishOrgSubscription('acme', { projectId: 'p1', loginId: 'l1', code: 'c#d' });
    await api.cancelOrgSubscription('acme', { projectId: 'p1', loginId: 'l1' });
    await api.orgCloudflare('acme');
    await api.connectOrgCloudflare('acme', 'token');
    await api.chooseOrgCloudflareAccount('acme', 'acc_1');
    await api.disconnectOrgCloudflare('acme', 'cf_1');
    await api.orgBillingCheckout('acme');
    await api.orgBillingPortal('acme');
    await api.deleteOrg('acme', { deleteSites: true });
    await api.projects('acme');
    await api.repositories('acme');
    await api.createProject({ repository: 'acme/site', org: 'acme' });
    await api.manageOrgs({ query: 'ac', page: 2 });

    const list = calls.map(
      (call) => `${call.method} ${call.path}${call.query.toString() !== '' ? `?${call.query}` : ''}`,
    );
    expect(list).toEqual([
      'GET /api/orgs',
      'GET /api/orgs/install-url',
      'GET /api/orgs/acme',
      'GET /api/orgs/acme/members',
      'POST /api/orgs/acme/members/sync',
      'PUT /api/orgs/acme/members/42',
      'DELETE /api/orgs/acme/members/42',
      'GET /api/orgs/acme/agent',
      'PUT /api/orgs/acme/agent',
      'DELETE /api/orgs/acme/agent',
      'POST /api/orgs/acme/agent/subscription/start',
      'POST /api/orgs/acme/agent/subscription/finish',
      'POST /api/orgs/acme/agent/subscription/cancel',
      'GET /api/orgs/acme/cloudflare',
      'POST /api/orgs/acme/cloudflare',
      'POST /api/orgs/acme/cloudflare/account',
      'DELETE /api/orgs/acme/cloudflare/cf_1',
      'POST /api/orgs/acme/billing/checkout',
      'POST /api/orgs/acme/billing/portal',
      'DELETE /api/orgs/acme',
      'GET /api/projects?org=acme',
      'GET /api/repositories?org=acme',
      'POST /api/projects',
      'GET /api/manage/orgs?query=ac&page=2',
    ]);
    const body = (key: string) => calls.find((call) => `${call.method} ${call.path}` === key)?.body;
    expect(body('PUT /api/orgs/acme/members/42')).toEqual({ role: 'admin' });
    expect(body('DELETE /api/orgs/acme/members/42')).toBeUndefined();
    expect(body('PUT /api/orgs/acme/agent')).toEqual({ provider: 'anthropic', apiKey: 'sk-ant-x' });
    expect(body('POST /api/orgs/acme/agent/subscription/finish')).toEqual({
      projectId: 'p1',
      loginId: 'l1',
      code: 'c#d',
    });
    expect(body('POST /api/orgs/acme/cloudflare')).toEqual({ token: 'token' });
    expect(body('POST /api/orgs/acme/cloudflare/account')).toEqual({ accountId: 'acc_1' });
    expect(body('DELETE /api/orgs/acme')).toEqual({ confirm: 'acme', deleteSites: true });
    expect(body('POST /api/projects')).toEqual({ repository: 'acme/site', org: 'acme' });
  });

  it('lists the personal projects and repositories without an org parameter', async () => {
    const { calls } = fakeApi({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/repositories': { body: { repositories: [] } },
    });

    await api.projects();
    await api.repositories();

    expect(calls.map((call) => call.query.has('org'))).toEqual([false, false]);
  });

  it("reads a project's access and organization at the top level, or inside project on older instances", () => {
    const project = {
      id: 'p1',
      name: 'Loja',
      repository: 'acme/loja',
      productionBranch: 'main',
      status: 'active',
      mode: 'byo',
      role: 'owner',
    } as const;
    const acme = { slug: 'acme', name: 'Acme Inc' };
    // What the instance answers: both places
    const current = {
      project: { ...project, access: 'admin' as const, org: acme },
      access: 'admin' as const,
      org: acme,
    };
    expect(detailAccess(current)).toBe('admin');
    expect(detailOrg(current)).toEqual(acme);
    // Older instances: only inside project
    const older = { project: { ...project, access: 'member' as const, org: acme } };
    expect(detailAccess(older)).toBe('member');
    expect(detailOrg(older)).toEqual(acme);
    // A personal project
    expect(detailOrg({ project: { ...project, org: null }, org: null })).toBeNull();
    expect(detailAccess({ project })).toBeNull();
  });
});

describe('redirects after signing in', () => {
  it.each([
    ['/projects/p1?tab=members', '/projects/p1?tab=members'],
    ['//evil.example.com', '/projects'],
    ['https://evil.example.com', '/projects'],
    ['/\\evil', '/projects'],
    ['/login?redirect=/x', '/projects'],
    ['/projects/p1 evil', '/projects'],
    ['/projetos/ação', '/projects'],
    [undefined, '/projects'],
    [['/a', '/b'], '/projects'],
  ])('%s -> %s', (value, expected) => {
    expect(safeRedirect(value)).toBe(expected);
  });

  it('builds the sign-in path', () => {
    expect(loginPath('/projects/p1')).toBe('/login?redirect=%2Fprojects%2Fp1');
  });
});
