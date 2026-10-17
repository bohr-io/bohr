import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { RunnerError } from '../src/container';
import worker from '../src/index';
import { CLAUDE_TOKEN, setup } from './helpers';

let privateKey: CryptoKey;
let jwks: string;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'instance-1', alg: 'ES256', use: 'sig' }],
  });
});

type TokenOptions = {
  sub?: string;
  name?: string;
  audience?: string;
  issuer?: string;
  expires?: string;
  aliases?: string[];
  grant?: string;
};

function client(options: { imported?: boolean } = {}) {
  const context = setup(options);
  const env = { ...context.testEnv, INSTANCE_JWKS: jwks };
  const token = (options: TokenOptions = {}) =>
    new SignJWT({
      name: options.name ?? 'Ana',
      locale: 'pt-BR',
      ...(options.aliases ? { aliases: options.aliases } : {}),
      ...(options.grant ? { grant: options.grant } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'instance-1' })
      .setIssuer(options.issuer ?? env.INSTANCE_URL)
      .setAudience(options.audience ?? `project:${env.PROJECT_ID}`)
      .setSubject(options.sub ?? 'tg:1001')
      .setIssuedAt()
      .setExpirationTime(options.expires ?? '5m')
      .sign(privateKey);
  const call = async (method: string, path: string, body?: unknown, options: TokenOptions | null = {}) => {
    await context.ready;
    const headers: Record<string, string> = {};
    if (options !== null) headers.Authorization = `Bearer ${await token(options)}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await worker.fetch(
      new Request(`https://bohr-project.acme.workers.dev/__bohr/api/v1${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { ...context, call };
}

describe('runtime API', () => {
  it('accepts only tokens the instance signed for this project', async () => {
    const { call } = client();
    expect((await call('GET', '/state', undefined, null)).status).toBe(401);
    expect((await call('GET', '/state', undefined, { audience: 'project:other' })).status).toBe(401);
    expect((await call('GET', '/state', undefined, { issuer: 'https://evil.example' })).status).toBe(401);
    expect((await call('GET', '/state', undefined, { expires: '10m ago' })).status).toBe(401);
    expect((await call('GET', '/state', undefined, { sub: 'admin' })).status).toBe(401);
    expect((await call('GET', '/state')).status).toBe(200);
  });

  it('serves the project state to members only', async () => {
    const { call } = client();
    const state = await call('GET', '/state');
    expect(state.body).toMatchObject({
      project: { name: 'Loja Aurora', repository: 'acme/store', productionBranch: 'main', agentEnabled: true },
      you: { key: 'tg:1001', role: 'owner' },
      homolog: { status: 'clean', version: 0, changes: [] },
      current: null,
      queue: [],
      settings: { model: 'claude-opus-5-5', maxBudgetUsd: 5, locale: 'pt-BR' },
    });
    expect(await call('GET', '/state', undefined, { sub: 'u:stranger' })).toEqual({
      status: 403,
      body: { error: 'not_a_member' },
    });
  });

  it('invites and joins from the web, then takes requests and shows the conversation', async () => {
    const { call } = client();
    const invite = await call('POST', '/invites');
    expect(invite.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const guest = { sub: 'u:web-user', name: 'Diego' };
    expect((await call('POST', '/join', { code: 'AAAA-AAAA' }, guest)).status).toBe(400);
    expect((await call('POST', '/join', { code: invite.body.code }, guest)).body).toEqual({ joined: true });
    expect(((await call('GET', '/state', undefined, guest)).body.you as { role: string }).role).toBe('member');

    const posted = await call('POST', '/messages', { text: 'Coloca o telefone no rodapé' }, guest);
    expect(posted.body.requestId).toMatch(/^req_/);
    const timeline = await call('GET', '/messages?after=0', undefined, guest);
    expect(timeline.body.messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Coloca o telefone no rodapé',
        author: { key: 'u:web-user', name: 'Diego' },
      }),
    ]);
    const state = await call('GET', '/state', undefined, guest);
    expect(state.body.queue).toEqual([expect.objectContaining({ status: 'queued', source: 'web' })]);

    expect((await call('PATCH', '/settings', { maxBudgetUsd: 1 }, guest)).status).toBe(403);
    expect((await call('PATCH', '/settings', { maxBudgetUsd: 1 })).body).toMatchObject({ maxBudgetUsd: 1 });
    expect((await call('PATCH', '/settings', { maxBudgetUsd: -1 })).status).toBe(400);
  });

  it('recognizes a member under the alias the instance vouches for', async () => {
    const { call, inside } = client();
    await inside((project) => project.store.addMember({ key: 'u:web-x', name: 'Xavier', role: 'member' }, new Date()));
    expect((await call('GET', '/state', undefined, { sub: 'tg:7007' })).status).toBe(403);
    const state = await call('GET', '/state', undefined, { sub: 'tg:7007', name: 'Xavier', aliases: ['u:web-x'] });
    expect(state.body.you).toEqual({ key: 'tg:7007', role: 'member' });
    // Aliases that are not member keys are ignored
    expect((await call('GET', '/state', undefined, { sub: 'tg:7008', aliases: ['owner', 'admin'] })).status).toBe(403);
  });

  it('explains the preview: what the Worker recorded and what the runner reports, with its log', async () => {
    const { call, container, stub } = client();
    expect((await call('GET', '/preview')).body).toMatchObject({ containerRunning: false, runner: null, port: null });
    container.running = true;
    container.preview = { status: 'running', port: 8787, log: 'Ready on http://localhost:8787' };
    await stub.agentEvents([
      { type: 'preview.status', seq: 1, at: new Date().toISOString(), status: 'running', port: 8787 },
    ]);
    expect((await call('GET', '/preview')).body).toEqual({
      state: 'running',
      status: 'running',
      port: 8787,
      reason: null,
      containerRunning: true,
      runner: { status: 'running', port: 8787, reason: null, log: 'Ready on http://localhost:8787' },
    });
  });

  it('lets organization members in with the role the instance grants, never demoting the owner', async () => {
    const { call, testEnv } = client();
    const member = { sub: 'u:org-member', name: 'Bia', grant: 'member' };
    expect((await call('GET', '/state', undefined, { sub: 'u:org-member' })).status).toBe(403);
    expect((await call('GET', '/state', undefined, member)).body.you).toEqual({ key: 'u:org-member', role: 'member' });
    // Promoted to org admin: owner from the next call on, and demoted back the same way
    const promoted = await call('GET', '/state', undefined, { ...member, grant: 'owner' });
    expect(promoted.body.you).toEqual({ key: 'u:org-member', role: 'owner' });
    expect((await call('GET', '/state', undefined, member)).body.you).toEqual({ key: 'u:org-member', role: 'member' });
    // Unknown grants are ignored, and the project's own owner stays owner
    expect((await call('GET', '/state', undefined, { sub: 'u:stranger', grant: 'admin' })).status).toBe(403);
    const owner = await call('GET', '/state', undefined, { sub: testEnv.OWNER_KEY, grant: 'member' });
    expect(owner.body.you).toMatchObject({ role: 'owner' });
  });

  it("connects the owner's Claude subscription through the container, for the owner only", async () => {
    const { call, container } = client();
    const guest = { sub: 'u:web-user', name: 'Diego' };
    const invite = await call('POST', '/invites');
    await call('POST', '/join', { code: invite.body.code }, guest);
    expect(await call('POST', '/claude-login/start', undefined, guest)).toEqual({
      status: 403,
      body: { error: 'owner_only' },
    });
    expect(container.logins).toEqual([]);

    const started = await call('POST', '/claude-login/start');
    expect(started).toEqual({
      status: 200,
      body: { loginId: 'login_0123456789', url: 'https://claude.com/cai/oauth/authorize?code=true&state=s' },
    });
    // The container starts for the sign-in
    expect(container.starts).toBe(1);
    expect(await call('POST', '/claude-login/finish', { loginId: 'login_0123456789', code: 'bad#x' })).toEqual({
      status: 422,
      body: { error: 'code_rejected', message: 'OAuth error: Invalid code' },
    });
    expect(await call('POST', '/claude-login/finish', { loginId: 'login_expired_1', code: 'good-code#state' })).toEqual(
      { status: 404, body: { error: 'unknown_login', message: 'This sign-in expired.' } },
    );
    expect(await call('POST', '/claude-login/finish', { loginId: 'login_0123456789', code: 'a b' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_request' },
    });
    expect(
      await call('POST', '/claude-login/finish', { loginId: 'login_0123456789', code: 'good-code#state' }),
    ).toEqual({ status: 200, body: { token: CLAUDE_TOKEN } });
    expect(await call('POST', '/claude-login/cancel', { loginId: 'login_0123456789' })).toEqual({
      status: 200,
      body: { cancelled: true },
    });
    expect(container.logins).toEqual([
      'start',
      'finish login_0123456789',
      'finish login_expired_1',
      'finish login_0123456789',
      'cancel login_0123456789',
    ]);

    container.loginError = new RunnerError(409, 'login_running', 'Another sign-in to Claude is in progress.');
    expect(await call('POST', '/claude-login/start')).toEqual({
      status: 409,
      body: { error: 'login_running', message: 'Another sign-in to Claude is in progress.' },
    });
    container.loginError = new RunnerError(500, 'internal_error', 'boom');
    expect((await call('POST', '/claude-login/start')).body).toMatchObject({ error: 'agent_unavailable' });
    expect((await call('POST', '/claude-login/other')).status).toBe(404);
  });

  it('shows the import the instance starts by itself as made by bohr', async () => {
    const { call } = client({ imported: false });
    expect((await call('POST', '/import', { automatic: true })).body.requestId).toMatch(/^req_/);
    const { body } = await call('GET', '/messages');
    const entries = (body.entries ?? body.messages ?? body) as { kind?: string; author?: { name: string } | null }[];
    expect(entries.filter((entry) => entry.kind === 'user').map((entry) => entry.author?.name)).toEqual(['bohr']);
  });

  it('tells whether the repository was prepared, and runs one import at a time', async () => {
    const { call, alarm, container, stub } = client({ imported: false });
    const project = async () => (await call('GET', '/state')).body.project as Record<string, unknown>;
    expect(await project()).toMatchObject({ importStatus: 'never', previewState: 'unknown' });

    expect((await call('POST', '/import', undefined, { sub: 'u:someone-else' })).status).toBe(403);
    const first = await call('POST', '/import');
    expect(first.body.requestId).toMatch(/^req_/);
    // Asking again while it is under way answers with the same import
    expect((await call('POST', '/import')).body).toEqual({
      requestId: first.body.requestId,
      message: 'Já estou preparando o repositório.',
    });
    expect(await project()).toMatchObject({ importStatus: 'running' });

    await alarm();
    await stub.agentEvents([
      {
        type: 'preview.status',
        seq: 1,
        at: new Date().toISOString(),
        status: 'stopped',
        reason: 'not_configured',
      },
      {
        type: 'job.finished',
        jobId: String(first.body.requestId),
        seq: 2,
        at: new Date().toISOString(),
        outcome: 'failed',
        summary: 'Algo deu errado.',
        costUsd: 0,
        numTurns: 1,
        commits: [],
        error: 'npm run build failed',
      },
    ]);
    expect(container.running).toBe(true);
    expect(await project()).toMatchObject({ importStatus: 'failed', previewState: 'not_configured' });
  });

  it('answers decisions without a pending preview, and unknown routes', async () => {
    const { call } = client();
    expect((await call('POST', '/decisions', { action: 'approve', version: 0 })).body).toEqual({
      message: 'Não há mudanças na homologação.',
    });
    expect((await call('GET', '/nothing-here')).status).toBe(404);
    expect((await call('DELETE', '/members/tg:1001')).body).toEqual({ error: 'cannot_revoke_owner' });
  });
});
