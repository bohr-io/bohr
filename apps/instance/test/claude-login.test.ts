import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_IDLE_TIMEOUT_MS, type LoginContainer, LoginRelay } from '../src/containers/claude-login';
import { createDb } from '../src/db/client';
import { auditLog, orgMembers, orgs, sessions, users } from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

// Connecting a Claude subscription through the instance's dedicated sign-in container (CLAUDE_LOGIN). The tests
// cannot run containers: deps.claudeLoginServer is replaced by a fake of the server inside it, and the Durable
// Object's relay runs against a fake container.

const db = createDb(env.DB);
const TOKEN = `sk-ant-oat01-${'k'.repeat(40)}wxyz`;
const LOGIN_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=cli&state=s';
const LOGIN_ID = 'login_0123456789';

// Only whether the binding exists matters to the service; the fake replaces what it reaches
const withContainer = { ...env, CLAUDE_LOGIN: {} as DurableObjectNamespace };
const call = (path: string, init: RequestInit = {}, target: typeof env = withContainer) =>
  app.request(path, init, target);

type ServerCall = { owner: string; path: string; body: Record<string, unknown> };
let serverCalls: ServerCall[];
/** The next answer of the fake sign-in server, instead of its normal behaviour. */
let nextReply: Response | Error | null;
let world: FakeWorld;

/** The sign-in server in the container (runtime/claude-login), as the agent's ClaudeLogin answers. */
function fakeServer(owner: string, path: string, body: Record<string, unknown>): Response {
  serverCalls.push({ owner, path, body });
  if (path === '/claude-login/start') return Response.json({ loginId: LOGIN_ID, url: LOGIN_URL });
  if (path === '/claude-login/finish') {
    if (body.loginId !== LOGIN_ID) {
      return Response.json({ error: 'unknown_login', message: 'This sign-in expired.' }, { status: 404 });
    }
    return body.code === 'good-code#state'
      ? Response.json({ token: TOKEN })
      : Response.json({ error: 'code_rejected', message: 'OAuth error: Invalid authorization code' }, { status: 422 });
  }
  if (path === '/claude-login/cancel') return Response.json({ cancelled: body.loginId === LOGIN_ID });
  return Response.json({ error: 'not_found' }, { status: 404 });
}

beforeEach(async () => {
  await resetStorage();
  useFakes();
  world = new FakeWorld();
  deps.fetch = world.fetch;
  serverCalls = [];
  nextReply = null;
  deps.claudeLoginServer = (_env, owner) => async (path, body) => {
    const reply = nextReply;
    nextReply = null;
    if (reply instanceof Error) {
      serverCalls.push({ owner, path, body: body as Record<string, unknown> });
      throw reply;
    }
    if (reply !== null) {
      serverCalls.push({ owner, path, body: body as Record<string, unknown> });
      return reply;
    }
    return fakeServer(owner, path, body as Record<string, unknown>);
  };
});

async function person(id: string, githubId?: number) {
  await db.insert(users).values({ id, name: id }).run();
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { id, githubId, headers: { Cookie: `__Host-bohr_session=${token}`, 'Content-Type': 'application/json' } };
}

const post = (path: string, who: { headers: Record<string, string> }, body: unknown = {}, target?: typeof env) =>
  call(path, { method: 'POST', headers: who.headers, body: JSON.stringify(body) }, target);

describe('the dedicated sign-in container', () => {
  it('connects a personal subscription without any project, and never hands the token to the browser', async () => {
    const ana = await person('u_ana');
    const started = await post('/api/me/agent/subscription/start', ana);
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ projectId: null, loginId: LOGIN_ID, url: LOGIN_URL });

    // A refused code, then the right one; the panel still sends a projectId (null), which is accepted
    const refused = await post('/api/me/agent/subscription/finish', ana, {
      projectId: null,
      loginId: LOGIN_ID,
      code: 'wrong-code#state',
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: 'OAuth error: Invalid authorization code', code: 'code_rejected' });
    expect(
      (await post('/api/me/agent/subscription/finish', ana, { loginId: LOGIN_ID, code: 'has spaces' })).status,
    ).toBe(400);
    const connected = await post('/api/me/agent/subscription/finish', ana, {
      projectId: null,
      loginId: LOGIN_ID,
      code: 'good-code#state',
      effort: 'high',
    });
    expect(connected.status).toBe(200);
    const text = await connected.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({
      agent: {
        configured: true,
        provider: 'subscription',
        baseUrl: null,
        model: null,
        effort: 'high',
        keyHint: '…wxyz',
      },
      projects: { applied: 0, failed: 0 },
    });
    const view = await call('/api/me/agent', { headers: ana.headers });
    expect(((await view.json()) as { agent: unknown }).agent).toMatchObject({
      configured: true,
      provider: 'subscription',
    });
    expect((await post('/api/me/agent/subscription/cancel', ana, { loginId: LOGIN_ID })).status).toBe(200);

    // Every step went to Ana's own container; no project Worker was involved
    expect(serverCalls.map(({ owner, path }) => `${owner} ${path}`)).toEqual([
      'user:u_ana /claude-login/start',
      'user:u_ana /claude-login/finish',
      'user:u_ana /claude-login/finish',
      'user:u_ana /claude-login/cancel',
    ]);
    expect(serverCalls[2]?.body).toEqual({ loginId: LOGIN_ID, code: 'good-code#state' });
    expect(world.projectWorkerCalls).toEqual([]);
    const connectAudit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'agent.subscription.connect'))
      .get();
    expect(connectAudit).toMatchObject({ actorUserId: 'u_ana', target: 'u_ana', metadata: { via: 'claude-login' } });
    expect(JSON.stringify(connectAudit)).not.toContain(TOKEN);
  });

  it("connects an organization's subscription in the organization's own container, for admins only", async () => {
    const ana = await person('u_ana');
    const bob = await person('u_bob');
    await db
      .insert(orgs)
      .values({ id: 'o_acme', slug: 'acme', name: 'Acme', githubAccountId: 7001, githubLogin: 'acme' })
      .run();
    await db
      .insert(orgMembers)
      .values([
        {
          orgId: 'o_acme',
          githubUserId: 5001,
          githubLogin: 'ana',
          userId: 'u_ana',
          role: 'admin',
          status: 'active',
          source: 'github',
        },
        {
          orgId: 'o_acme',
          githubUserId: 5002,
          githubLogin: 'bob',
          userId: 'u_bob',
          role: 'member',
          status: 'active',
          source: 'github',
        },
      ])
      .run();

    expect((await post('/api/orgs/acme/agent/subscription/start', bob)).status).toBe(403);
    const started = await post('/api/orgs/acme/agent/subscription/start', ana);
    expect(await started.json()).toEqual({ projectId: null, loginId: LOGIN_ID, url: LOGIN_URL });
    const finished = await post('/api/orgs/acme/agent/subscription/finish', ana, {
      loginId: LOGIN_ID,
      code: 'good-code#state',
    });
    expect(finished.status).toBe(200);
    const text = await finished.text();
    expect(text).not.toContain(TOKEN);
    expect((JSON.parse(text) as { agent: { provider: string } }).agent.provider).toBe('subscription');
    expect(
      (await post('/api/orgs/acme/agent/subscription/cancel', ana, { projectId: null, loginId: LOGIN_ID })).status,
    ).toBe(200);
    expect(serverCalls.map(({ owner }) => owner)).toEqual(['org:o_acme', 'org:o_acme', 'org:o_acme']);
    // The org's settings, not Ana's personal ones
    const personal = await call('/api/me/agent', { headers: ana.headers });
    expect(((await personal.json()) as { agent: unknown }).agent).toMatchObject({ configured: false });
    const org = await call('/api/orgs/acme/agent', { headers: bob.headers });
    expect(((await org.json()) as { agent: unknown }).agent).toMatchObject({ provider: 'subscription' });
  });

  it("passes the sign-in server's refusals on as the panel knows them", async () => {
    const ana = await person('u_ana');
    const start = () => post('/api/me/agent/subscription/start', ana);
    const finish = () => post('/api/me/agent/subscription/finish', ana, { loginId: LOGIN_ID, code: 'good-code#state' });

    nextReply = Response.json({ error: 'login_running', message: 'Another sign-in is in progress.' }, { status: 409 });
    let response = await start();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Another sign-in is in progress.', code: 'login_running' });

    nextReply = Response.json({ error: 'timeout', message: 'The CLI did not show the link in time.' }, { status: 504 });
    response = await start();
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'The CLI did not show the link in time.', code: 'timeout' });

    // Expired or unknown
    response = await post('/api/me/agent/subscription/finish', ana, { loginId: 'login_other_123', code: 'x#y' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'login_expired' });

    nextReply = Response.json({ error: 'timeout', message: 'No token in time.' }, { status: 504 });
    response = await finish();
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: 'timeout' });

    // A link outside Anthropic's sign-in pages never reaches the browser
    nextReply = Response.json({ loginId: LOGIN_ID, url: 'https://evil.example.com/oauth/authorize?x=1' });
    response = await start();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('evil.example.com');

    // A token that is not one is refused, and nothing is saved
    nextReply = Response.json({ token: 'sk-ant-api03-not-a-subscription-token' });
    response = await finish();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('sk-ant-api03');

    // The container could not start, or could not be reached
    nextReply = Response.json({ error: 'container_unavailable', message: 'did not start' }, { status: 503 });
    response = await start();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'login_unavailable' });
    nextReply = new Error('network');
    response = await start();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'runtime_error' });
    nextReply = Response.json({ error: 'internal_error', message: 'secret details' }, { status: 500 });
    response = await finish();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret details');

    const view = await call('/api/me/agent', { headers: ana.headers });
    expect(((await view.json()) as { agent: unknown }).agent).toMatchObject({ configured: false });
  });
});

describe('without the sign-in container (fallback)', () => {
  it('still needs a project, and finish names the project the sign-in runs in', async () => {
    const ana = await person('u_ana');
    const started = await post('/api/me/agent/subscription/start', ana, {}, env);
    expect(started.status).toBe(409);
    expect(await started.json()).toMatchObject({ code: 'no_runtime' });
    const finish = await post('/api/me/agent/subscription/finish', ana, { loginId: LOGIN_ID, code: 'x#y' }, env);
    expect(finish.status).toBe(400);
    const cancel = await post(
      '/api/me/agent/subscription/cancel',
      ana,
      { projectId: 'p_none', loginId: LOGIN_ID },
      env,
    );
    expect(cancel.status).toBe(404);
    expect(serverCalls).toEqual([]);
  });
});

/** A container that starts after a few health checks; requests to its port go to `serve`. */
class FakeContainer implements LoginContainer {
  running = false;
  starts = 0;
  timeouts: number[] = [];
  healthChecks = 0;
  requests: { path: string; body: string }[] = [];
  /** Health checks that fail before the server answers. */
  bootChecks = 2;
  serve = (_path: string, _body: string) => Response.json({ loginId: LOGIN_ID, url: LOGIN_URL });
  failRequests = false;

  start(options: { enableInternet: boolean }) {
    expect(options.enableInternet).toBe(true);
    this.running = true;
    this.starts++;
  }

  async setInactivityTimeout(durationMs: number) {
    this.timeouts.push(durationMs);
  }

  getTcpPort(port: number) {
    expect(port).toBe(4840);
    return {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === '/health') {
          this.healthChecks++;
          if (!this.running || this.healthChecks <= this.bootChecks) throw new Error('connection refused');
          return Response.json({ ok: true, version: '0.3.3', busy: false });
        }
        if (this.failRequests) throw new Error('container stopped');
        const body = await request.text();
        this.requests.push({ path, body });
        return this.serve(path, body);
      },
    };
  }
}

describe('the sign-in Durable Object', () => {
  const sleep = async () => {};
  const request = (path: string, body: unknown = {}, method = 'POST') =>
    new Request(`https://claude-login${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });

  it('starts the container once, waits for its server, relays the steps and keeps it warm', async () => {
    const container = new FakeContainer();
    const relay = new LoginRelay(container, { sleep });
    const [first, second] = await Promise.all([
      relay.relay(request('/claude-login/start')),
      relay.relay(request('/claude-login/cancel', { loginId: LOGIN_ID })),
    ]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ loginId: LOGIN_ID, url: LOGIN_URL });
    expect(second.status).toBe(200);
    expect(container.starts).toBe(1);
    expect(container.healthChecks).toBe(3);

    container.serve = (_path, body) =>
      JSON.parse(body).code === 'good-code#state'
        ? Response.json({ token: TOKEN })
        : Response.json({ error: 'code_rejected', message: 'Invalid code' }, { status: 422 });
    const refused = await relay.relay(request('/claude-login/finish', { loginId: LOGIN_ID, code: 'bad#code' }));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: 'code_rejected', message: 'Invalid code' });
    const finished = await relay.relay(request('/claude-login/finish', { loginId: LOGIN_ID, code: 'good-code#state' }));
    expect(await finished.json()).toEqual({ token: TOKEN });
    // Warm containers are not checked again
    expect(container.starts).toBe(1);
    expect(container.healthChecks).toBe(3);
    expect(container.requests.map((entry) => entry.path)).toEqual([
      '/claude-login/start',
      '/claude-login/cancel',
      '/claude-login/finish',
      '/claude-login/finish',
    ]);
    expect(container.timeouts.length).toBeGreaterThan(0);
    expect(new Set(container.timeouts)).toEqual(new Set([LOGIN_IDLE_TIMEOUT_MS]));

    // It stopped after being idle: the next request starts it again
    container.running = false;
    container.healthChecks = 0;
    container.serve = () => Response.json({ loginId: LOGIN_ID, url: LOGIN_URL });
    expect((await relay.relay(request('/claude-login/start'))).status).toBe(200);
    expect(container.starts).toBe(2);
  });

  it('relays only the sign-in steps', async () => {
    const container = new FakeContainer();
    const relay = new LoginRelay(container, { sleep });
    expect((await relay.relay(request('/health', {}, 'GET'))).status).toBe(404);
    expect((await relay.relay(request('/jobs'))).status).toBe(404);
    expect((await relay.relay(request('/claude-login/start', {}, 'GET'))).status).toBe(404);
    expect(container.starts).toBe(0);
  });

  it('answers 503 when the container is missing or does not start, 502 when it stops mid-request', async () => {
    const missing = await new LoginRelay(undefined).relay(request('/claude-login/start'));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: 'container_unavailable' });

    const stuck = new FakeContainer();
    stuck.bootChecks = Number.POSITIVE_INFINITY;
    const slow = await new LoginRelay(stuck, { sleep, startTimeoutMs: 0 }).relay(request('/claude-login/start'));
    expect(slow.status).toBe(503);
    expect(await slow.json()).toMatchObject({ error: 'container_unavailable' });

    const stopping = new FakeContainer();
    stopping.failRequests = true;
    const relay = new LoginRelay(stopping, { sleep });
    const failed = await relay.relay(request('/claude-login/start'));
    expect(failed.status).toBe(502);
    // The next request checks the container again
    stopping.failRequests = false;
    expect((await relay.relay(request('/claude-login/start'))).status).toBe(200);
    expect(stopping.healthChecks).toBe(4);
  });
});
