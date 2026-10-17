import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  auditLog,
  cfConnections,
  emailCodes,
  envVars,
  githubInstallations,
  identities,
  instanceSettings,
  onboarding,
  projectMembers,
  projects,
  runtimes,
  sessions,
  subscriptions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { saveAgentSettings } from '../src/services/agent-settings';
import { generateCode } from '../src/services/email-codes';
import { saveGithubApp } from '../src/services/github-app';
import { readOnboarding, writeOnboarding } from '../src/services/onboarding';
import { DEFAULT_RUNTIME_IMAGE, provisionRuntime } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const IMAGE = `registry.cloudflare.com/acc-user/bohr-agent@sha256:${'c'.repeat(64)}`;
const emailBinding = { send: async () => ({ messageId: 'm1' }) } as unknown as SendEmail;
// A self-hosted instance with email sign-in; the GitHub App comes from /setup (saved below)
const instance = {
  ...env,
  APP_URL: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  CF_API_TOKEN: undefined,
  CF_ACCOUNT_ID: undefined,
  EMAIL: emailBinding,
};
let target: typeof env = instance;
const call = (path: string, init: RequestInit = {}) => app.request(path, init, target);
const json = { 'Content-Type': 'application/json' };

let world: FakeWorld;
let sent: EmailMessageBuilder[];

async function pkcs8Pem() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
}
const appKey = await pkcs8Pem();

const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('__Host-bohr_session='))
    ?.split(';')[0] ?? '';

/**
 * The GitHub OAuth round trip; with a session cookie and link, it attaches GitHub to that user. denied: the
 * person cancels on GitHub, which comes back with ?error=access_denied and no code.
 */
async function github(
  profile: { id: number; login: string; name?: string | null },
  options: { cookie?: string; link?: boolean; denied?: boolean } = {},
) {
  world.githubProfile = { name: null, email: null, ...profile };
  const start = await call(`/auth/github?redirect=/settings${options.link ? '&link=1' : ''}`, {
    headers: options.cookie ? { Cookie: options.cookie } : {},
  });
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
  const stateCookie =
    start.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-bohr_oauth='))
      ?.split(';')[0] ?? '';
  const answer = options.denied ? 'error=access_denied' : 'code=abc';
  const callback = await call(`/auth/github/callback?${answer}&state=${state}`, {
    headers: { Cookie: [stateCookie, options.cookie].filter(Boolean).join('; ') },
  });
  return { callback, cookie: sessionCookie(callback) || (options.cookie ?? '') };
}

const startEmail = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  call('/auth/email/start', { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) });
const verifyEmail = (email: string, code: string) =>
  call('/auth/email/verify', { method: 'POST', headers: json, body: JSON.stringify({ email, code }) });
const lastCode = () => /\b(\d{6})\b/.exec(String(sent.at(-1)?.text))?.[1] ?? '';

async function emailSignIn(email: string) {
  expect((await startEmail({ email, redirect: '/projects' })).status).toBe(200);
  const verified = await verifyEmail(email, lastCode());
  expect(verified.status).toBe(200);
  return sessionCookie(verified);
}

const me = async (cookie: string) =>
  (await (await call('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { id: string; role: string; email: string | null };
    identities: { provider: string; username: string }[];
  };

/** GitHub's redirect after installing, then the authorization that proves the installation is the user's. */
async function installed(installationId: number, state: string) {
  const back = await call(
    `/setup/github/installed?installation_id=${installationId}&setup_action=install&state=${state}`,
  );
  const authorize = new URL(back.headers.get('Location') ?? '');
  return call(`/setup/github/verify?code=oauth-code&state=${authorize.searchParams.get('state')}`);
}

/** A signed-in user with Cloudflare and GitHub connected and a provisioned project (ana/loja). */
async function userWithProject(cookie: string) {
  const headers = { Cookie: cookie, ...json };
  await call('/api/onboarding/cloudflare', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
  });
  const onboardingView = (await (await call('/api/onboarding', { headers })).json()) as {
    github: { installUrl: string };
  };
  await installed(55, new URL(onboardingView.github.installUrl).searchParams.get('state') ?? '');
  const created = await call('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ repository: 'ana/loja' }),
  });
  expect(created.status).toBe(201);
  const { projectId } = (await created.json()) as { projectId: string };
  await provisionRuntime(db, target, projectId, { sleep: async () => {} });
  return { projectId, headers };
}

beforeEach(async () => {
  await resetStorage();
  useFakes();
  world = new FakeWorld();
  deps.fetch = world.fetch;
  deps.startProvisioning = async () => {};
  sent = [];
  deps.sendEmail = async (_env, message) => {
    sent.push(message);
  };
  target = instance;
  await saveGithubApp(db, instance, {
    appId: '321',
    slug: 'bohr-ana',
    clientId: 'Iv1.ana',
    clientSecret: 'secret',
    privateKey: appKey,
    webhookSecret: 'hook',
  });
  await writeSetting(db, 'app_url', 'https://bohr.ana.workers.dev');
  await writeSetting(db, 'runtime_image:acc-user', { source: DEFAULT_RUNTIME_IMAGE, reference: IMAGE });
});

describe('sign-in methods', () => {
  it('reports GitHub and email when they are configured', async () => {
    expect(await (await call('/auth/methods')).json()).toEqual({ github: true, email: true });
    target = { ...instance, EMAIL: undefined };
    expect(await (await call('/auth/methods')).json()).toEqual({ github: true, email: false });
    expect((await startEmail({ email: 'ana@example.com' })).status).toBe(404);
  });
});

describe('email sign-in', () => {
  it('sends a code in the user language and signs in with it once', async () => {
    const started = await startEmail(
      { email: '  Ana@Example.com ', redirect: '/projects/p1' },
      { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    );
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const message = sent[0];
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(message).toMatchObject({ to: 'ana@example.com', from: 'bohr <noreply@bohr.ana.workers.dev>' });
    expect(message?.subject).toContain(code);
    expect(message?.text).toContain('expira em 10 minutos');
    expect(message?.html).toContain(code);
    // The code itself is never stored
    const row = await db.select().from(emailCodes).get();
    expect(row?.codeHash).not.toContain(code);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);

    const verified = await verifyEmail('ana@example.com', code);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ redirect: '/projects/p1' });
    const cookie = sessionCookie(verified);
    expect(cookie).not.toBe('');
    const profile = await me(cookie);
    expect(profile.user).toMatchObject({ email: 'ana@example.com', role: 'admin' });
    // The panel reads the role at the top level (its admin area guard)
    expect((profile as unknown as { role: string }).role).toBe('admin');
    expect(profile.identities).toEqual([{ provider: 'email', username: 'ana@example.com' }]);
    const login = await db.select().from(auditLog).where(eq(auditLog.action, 'login')).get();
    expect(login?.metadata).toEqual({ provider: 'email' });

    // Single use
    expect((await verifyEmail('ana@example.com', code)).status).toBe(410);
    // The next sign-in finds the same user; the sender comes from EMAIL_FROM when set
    target = { ...instance, EMAIL_FROM: 'bohr <login@bohr.io>' };
    await startEmail({ email: 'ana@example.com', locale: 'es' });
    expect(sent.at(-1)).toMatchObject({ from: 'bohr <login@bohr.io>' });
    expect(sent.at(-1)?.text).toContain('Caduca en 10 minutos');
    const again = await verifyEmail('ana@example.com', lastCode());
    expect((await me(sessionCookie(again))).user.id).toBe(profile.user.id);
  });

  it('counts wrong attempts and gives up after five', async () => {
    await startEmail({ email: 'ana@example.com' });
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (const left of [4, 3, 2, 1, 0]) {
      const response = await verifyEmail('ana@example.com', wrong);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Wrong code.', attemptsLeft: left });
    }
    expect((await verifyEmail('ana@example.com', code)).status).toBe(410);
    expect((await verifyEmail('ana@example.com', 'abc')).status).toBe(400);
  });

  it('expires codes after 10 minutes, and a new code replaces the previous one', async () => {
    await startEmail({ email: 'ana@example.com' });
    const first = lastCode();
    await db
      .update(emailCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();
    expect((await verifyEmail('ana@example.com', first)).status).toBe(410);

    await startEmail({ email: 'ana@example.com' });
    const second = lastCode();
    await startEmail({ email: 'ana@example.com' });
    const third = lastCode();
    if (second !== third) expect((await verifyEmail('ana@example.com', second)).status).toBe(400);
    expect((await verifyEmail('ana@example.com', third)).status).toBe(200);
  });

  it('limits codes per address and per IP', async () => {
    for (let i = 0; i < 3; i++) expect((await startEmail({ email: 'ana@example.com' })).status).toBe(200);
    expect((await startEmail({ email: 'ana@example.com' })).status).toBe(429);

    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < 10; i++) {
      expect((await startEmail({ email: `person${i}@example.com` }, ip)).status).toBe(200);
    }
    expect((await startEmail({ email: 'other@example.com' }, ip)).status).toBe(429);
    expect((await startEmail({ email: 'other@example.com' }, { 'CF-Connecting-IP': '203.0.113.10' })).status).toBe(200);
  });

  it('answers the same for known and unknown addresses, and refuses invalid ones', async () => {
    await emailSignIn('known@example.com');
    const known = await startEmail({ email: 'known@example.com' });
    const unknown = await startEmail({ email: 'nobody@example.com' });
    expect([known.status, await known.json()]).toEqual([200, { sent: true }]);
    expect([unknown.status, await unknown.json()]).toEqual([200, { sent: true }]);
    expect((await startEmail({ email: 'not-an-email' })).status).toBe(400);
    const form = await call('/auth/email/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=a@example.com',
    });
    expect(form.status).toBe(415);
  });

  it('never merges an email sign-in into a GitHub user with the same address', async () => {
    world.githubProfile.email = 'ana@example.com';
    const { cookie: githubCookie } = await github({ id: 5001, login: 'ana' });
    await db.update(users).set({ email: 'ana@example.com' }).run();
    const emailCookie = await emailSignIn('ana@example.com');
    expect((await me(emailCookie)).user.id).not.toBe((await me(githubCookie)).user.id);
  });

  it('generates uniform six-digit codes', () => {
    const codes = new Set(Array.from({ length: 200 }, generateCode));
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('roles', () => {
  it('makes the first person who signs in an admin, not users the platform bot created', async () => {
    await db.insert(users).values({ id: 'u_tg', name: 'Telegram only' }).run();
    await db
      .insert(identities)
      .values({ id: 'i_tg', userId: 'u_tg', provider: 'telegram', providerUserId: '777', username: 'tg' })
      .run();
    const { cookie: first } = await github({ id: 5001, login: 'ana' });
    expect((await me(first)).user.role).toBe('admin');
    const second = await emailSignIn('bob@example.com');
    expect((await me(second)).user.role).toBe('user');
  });

  it('lets the operator change roles with the admin token', async () => {
    await github({ id: 5001, login: 'ana' });
    const bob = await emailSignIn('bob@example.com');
    const bobId = (await me(bob)).user.id;
    const admin = { Authorization: `Bearer ${env.ADMIN_TOKEN}`, ...json };
    const byEmail = await call('/api/admin/users/role', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ email: 'BOB@example.com', role: 'admin' }),
    });
    expect(await byEmail.json()).toEqual({ user: { id: bobId, name: null, email: 'bob@example.com', role: 'admin' } });
    const byLogin = await call('/api/admin/users/role', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ githubLogin: 'ANA', role: 'user' }),
    });
    expect(((await byLogin.json()) as { user: { role: string } }).user.role).toBe('user');
    const missing = await call('/api/admin/users/role', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ userId: 'u_nobody', role: 'admin' }),
    });
    expect(missing.status).toBe(404);
    const unauthorized = await call('/api/admin/users/role', {
      method: 'POST',
      headers: { Cookie: bob, ...json },
      body: JSON.stringify({ userId: bobId, role: 'admin' }),
    });
    expect(unauthorized.status).toBe(401);
  });
});

describe('linking', () => {
  it('attaches GitHub to the signed-in user, and refuses an account that belongs to someone else', async () => {
    const cookie = await emailSignIn('ana@example.com');
    const userId = (await me(cookie)).user.id;
    const linked = await github({ id: 5001, login: 'ana-gh', name: 'Ana' }, { cookie, link: true });
    expect(linked.callback.headers.get('Location')).toBe('/settings');
    expect(sessionCookie(linked.callback)).toBe('');
    const profile = await me(cookie);
    expect(profile.user.id).toBe(userId);
    expect(profile.identities).toEqual(
      expect.arrayContaining([
        { provider: 'email', username: 'ana@example.com' },
        { provider: 'github', username: 'ana-gh' },
      ]),
    );
    // Signing in with that GitHub account now opens the same user
    const { cookie: viaGithub } = await github({ id: 5001, login: 'ana-gh' });
    expect((await me(viaGithub)).user.id).toBe(userId);

    const { cookie: bob } = await github({ id: 6001, login: 'bob' });
    const taken = await github({ id: 5001, login: 'ana-gh' }, { cookie: bob, link: true });
    const location = taken.callback.headers.get('Location') ?? '';
    expect(location).toMatch(/^\/settings\?error=/);
    expect(decodeURIComponent(location)).toContain('another bohr account');
    expect((await me(bob)).identities).toEqual([{ provider: 'github', username: 'bob' }]);
  });

  it('goes back to the page with ?error= when the person cancels linking on GitHub', async () => {
    const cookie = await emailSignIn('ana@example.com');
    const denied = await github({ id: 5001, login: 'ana-gh' }, { cookie, link: true, denied: true });
    expect(denied.callback.status).toBe(302);
    const location = denied.callback.headers.get('Location') ?? '';
    expect(location).toMatch(/^\/settings\?error=/);
    expect(decodeURIComponent(location)).toContain('GitHub did not authorize');
    expect((await me(cookie)).identities).toEqual([{ provider: 'email', username: 'ana@example.com' }]);
    // Signing in (not linking) still answers 401
    expect((await github({ id: 5001, login: 'ana-gh' }, { denied: true })).callback.status).toBe(401);
  });

  it('attaches an email address with a code, and refuses one that belongs to someone else', async () => {
    await emailSignIn('taken@example.com');
    const { cookie } = await github({ id: 5001, login: 'ana' });
    const headers = { Cookie: cookie, ...json };
    const start = (email: string) =>
      call('/api/me/email/start', { method: 'POST', headers, body: JSON.stringify({ email }) });
    const verify = (email: string, code: string) =>
      call('/api/me/email/verify', { method: 'POST', headers, body: JSON.stringify({ email, code }) });

    expect(await (await start('Ana@Example.com')).json()).toEqual({ sent: true });
    // A sign-in code for the same address does not link it, and a link code does not sign in
    expect((await verifyEmail('ana@example.com', lastCode())).status).toBe(410);
    const linked = await verify('ana@example.com', lastCode());
    expect(await linked.json()).toEqual({ identity: { provider: 'email', username: 'ana@example.com' } });
    const profile = await me(cookie);
    expect(profile.user.email).toBe('ana@example.com');
    expect(profile.identities).toContainEqual({ provider: 'email', username: 'ana@example.com' });

    await start('taken@example.com');
    expect((await verify('taken@example.com', lastCode())).status).toBe(409);
  });
});

describe('admin panel API', () => {
  it('is only for admins', async () => {
    await github({ id: 5001, login: 'ana' });
    const bob = await emailSignIn('bob@example.com');
    for (const path of ['/api/manage/overview', '/api/manage/users', '/api/manage/projects', '/api/manage/telemetry']) {
      expect((await call(path, { headers: { Cookie: bob } })).status).toBe(403);
      expect((await call(path)).status).toBe(401);
    }
    const update = await call('/api/manage/runtimes/update', { method: 'POST', headers: { Cookie: bob, ...json } });
    expect(update.status).toBe(403);
  });

  it('shows admins the telemetry setting and exactly what it would send', async () => {
    const { cookie: admin } = await github({ id: 5001, login: 'ana' });
    const view = await (await call('/api/manage/telemetry', { headers: { Cookie: admin } })).json();
    expect(view).toMatchObject({ enabled: false, lastSentAt: null, payload: { projects: 0 } });
    const turnOff = await call('/api/manage/telemetry', {
      method: 'PUT',
      headers: { Cookie: admin, ...json },
      body: JSON.stringify({ enabled: false }),
    });
    expect(await turnOff.json()).toMatchObject({ enabled: false });
  });

  it('lists users and projects, changes roles and opens any project', async () => {
    const { cookie: admin } = await github({ id: 5001, login: 'ana' });
    const adminId = (await me(admin)).user.id;
    const bobCookie = await emailSignIn('bob@example.com');
    const bobId = (await me(bobCookie)).user.id;
    const { projectId } = await userWithProject(bobCookie);
    const headers = { Cookie: admin, ...json };

    const overview = await (await call('/api/manage/overview', { headers })).json();
    expect(overview).toEqual({
      users: 2,
      projects: 1,
      subscriptions: { active: 0 },
      runtimes: { ready: 1, provisioning: 0, pending: 0, error: 0 },
    });

    const list = (await (await call('/api/manage/users?query=bob', { headers })).json()) as {
      users: Record<string, unknown>[];
      total: number;
    };
    expect(list.total).toBe(1);
    expect(list.users[0]).toMatchObject({
      id: bobId,
      email: 'bob@example.com',
      role: 'user',
      identities: [{ provider: 'email', username: 'bob@example.com' }],
      projects: 1,
      subscription: null,
    });
    expect(((await (await call('/api/manage/users?query=%25', { headers })).json()) as { total: number }).total).toBe(
      0,
    );
    expect(
      ((await (await call('/api/manage/users?page=2', { headers })).json()) as { users: unknown[] }).users,
    ).toEqual([]);

    const detail = (await (await call(`/api/manage/users/${bobId}`, { headers })).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      user: { id: bobId },
      projects: [{ id: projectId, name: 'loja', repository: 'ana/loja', owner: { id: bobId }, mode: 'byo' }],
      connections: {
        githubInstallations: [{ id: 55, account: 'ana' }],
        cloudflare: [{ accountId: 'acc-user', accountName: "Ana's account" }],
        telegram: null,
        agent: { configured: false },
      },
    });
    expect((await call('/api/manage/users/u_nobody', { headers })).status).toBe(404);

    const projectList = (await (await call('/api/manage/projects?query=loja', { headers })).json()) as {
      projects: Record<string, unknown>[];
      total: number;
    };
    expect(projectList.total).toBe(1);
    expect(projectList.projects[0]).toMatchObject({
      id: projectId,
      owner: { id: bobId, email: 'bob@example.com' },
      status: 'active',
      productionUrl: null,
      runtime: { status: 'ready', error: null },
    });

    // The admin opens bob's project with owner-level access; it is not among the admin's own projects
    const project = (await (await call(`/api/projects/${projectId}`, { headers })).json()) as {
      project: { role: string; access: string };
    };
    expect(project.project).toMatchObject({ role: 'owner', access: 'admin' });
    const own = (await (await call(`/api/projects/${projectId}`, { headers: { Cookie: bobCookie } })).json()) as {
      project: { access: string };
    };
    expect(own.project.access).toBe('member');
    expect(((await (await call('/api/projects', { headers })).json()) as { projects: unknown[] }).projects).toEqual([]);
    const runtime = await call(`/api/projects/${projectId}/runtime`, { headers });
    expect(runtime.status).toBe(200);
    const variable = await call(`/api/projects/${projectId}/variables`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ target: 'build', key: 'GREETING', value: 'hi', secret: true }),
    });
    expect(variable.status).toBe(200);
    // A project in its owner's account: sealed in bohr, not an Actions secret
    expect(world.actionsSecrets.has('BOHR_BUILD_GREETING')).toBe(false);
    const greeting = await db.select().from(envVars).where(eq(envVars.key, 'GREETING')).get();
    expect(greeting?.valueSealed).toEqual(expect.any(String));
    const audited = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'variable.set'), eq(auditLog.target, projectId)))
      .get();
    expect(audited).toMatchObject({ actor: `admin:${adminId}`, actorUserId: adminId });
    // Someone who is neither a member nor an admin does not see it
    const { cookie: stranger } = await github({ id: 7001, login: 'mallory' });
    expect((await call(`/api/projects/${projectId}`, { headers: { Cookie: stranger } })).status).toBe(404);

    // Roles: the last admin stays
    const demoteSelf = await call(`/api/manage/users/${adminId}/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role: 'user' }),
    });
    expect(demoteSelf.status).toBe(409);
    const promote = await call(`/api/manage/users/${bobId}/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(((await promote.json()) as { user: { role: string } }).user.role).toBe('admin');
    expect((await me(bobCookie)).user.role).toBe('admin');

    const updated = await call('/api/manage/runtimes/update', { method: 'POST', headers });
    expect(await updated.json()).toMatchObject({ updating: [] });
  });

  it('deletes another account, but not the admin own', async () => {
    const { cookie: admin } = await github({ id: 5001, login: 'ana' });
    const adminId = (await me(admin)).user.id;
    const bob = await emailSignIn('bob@example.com');
    const bobId = (await me(bob)).user.id;
    const headers = { Cookie: admin, ...json };
    const self = await call(`/api/manage/users/${adminId}`, { method: 'DELETE', headers, body: '{}' });
    expect(self.status).toBe(400);
    const removed = await call(`/api/manage/users/${bobId}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ deleteSites: false }),
    });
    expect(await removed.json()).toEqual({ warnings: [] });
    expect(await db.select().from(users).where(eq(users.id, bobId)).get()).toBeUndefined();
    expect((await call('/api/me', { headers: { Cookie: bob } })).status).toBe(401);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'account.delete')).get();
    expect(audit).toMatchObject({ actor: `admin:${adminId}`, target: bobId });
  });
});

describe('connected accounts', () => {
  it('keeps the last way to sign in and disconnects Telegram from the platform bot', async () => {
    const { cookie } = await github({ id: 5001, login: 'ana' });
    const userId = (await me(cookie)).user.id;
    const headers = { Cookie: cookie, ...json };
    const connections = async () =>
      (await (await call('/api/me/connections', { headers })).json()) as {
        identities: { provider: string; canRemove: boolean }[];
        telegram: { username: string } | null;
        agent: { configured: boolean };
        subscription: unknown;
      };

    const first = await connections();
    expect(first).toEqual({
      identities: [{ provider: 'github', username: 'ana', canRemove: false }],
      githubInstallations: [],
      cloudflare: [],
      telegram: null,
      agent: expect.objectContaining({ configured: false }),
      subscription: null,
    });
    expect((await call('/api/me/identities/github', { method: 'DELETE', headers })).status).toBe(409);
    expect((await call('/api/me/identities/email', { method: 'DELETE', headers })).status).toBe(404);
    expect((await call('/api/me/identities/other', { method: 'DELETE', headers })).status).toBe(400);

    await call('/api/me/email/start', { method: 'POST', headers, body: JSON.stringify({ email: 'ana@example.com' }) });
    await call('/api/me/email/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ana@example.com', code: lastCode() }),
    });
    await db
      .insert(identities)
      .values({ id: 'i_tg', userId, provider: 'telegram', providerUserId: '777001', username: 'ana_tg' })
      .run();
    await writeOnboarding(db, userId, { step: 'done', chatId: 777001, locale: 'pt-BR' });
    const second = await connections();
    expect(second.identities).toEqual(
      expect.arrayContaining([
        { provider: 'github', username: 'ana', canRemove: true },
        { provider: 'email', username: 'ana@example.com', canRemove: true },
        { provider: 'telegram', username: 'ana_tg', canRemove: true },
      ]),
    );
    expect(second.telegram).toEqual({ username: 'ana_tg' });

    const withoutGithub = await call('/api/me/identities/github', { method: 'DELETE', headers });
    expect(withoutGithub.status).toBe(200);
    expect(
      ((await withoutGithub.json()) as { identities: { provider: string; canRemove: boolean }[] }).identities,
    ).toEqual(expect.arrayContaining([{ provider: 'email', username: 'ana@example.com', canRemove: false }]));
    expect((await call('/api/me/identities/telegram', { method: 'DELETE', headers })).status).toBe(200);
    expect((await readOnboarding(db, userId)).chatId).toBeUndefined();
    expect((await connections()).telegram).toBeNull();
  });

  it('refuses to disconnect what projects use, and uninstalls the GitHub App otherwise', async () => {
    const { cookie } = await github({ id: 5001, login: 'ana' });
    const { projectId, headers } = await userWithProject(cookie);
    const view = (await (await call('/api/me/connections', { headers })).json()) as {
      githubInstallations: { id: number; account: string; projects: number }[];
      cloudflare: { id: string; projects: number }[];
    };
    expect(view.githubInstallations).toEqual([{ id: 55, account: 'ana', projects: 1 }]);
    expect(view.cloudflare).toEqual([expect.objectContaining({ accountId: 'acc-user', projects: 1 })]);
    const connectionId = view.cloudflare[0]?.id ?? '';

    const busyInstallation = await call('/api/me/github-installations/55', { method: 'DELETE', headers });
    expect(busyInstallation.status).toBe(409);
    expect(await busyInstallation.json()).toMatchObject({ projects: ['loja'] });
    const busyCloudflare = await call(`/api/me/cloudflare/${connectionId}`, { method: 'DELETE', headers });
    expect(busyCloudflare.status).toBe(409);
    expect(await busyCloudflare.json()).toMatchObject({ projects: ['loja'] });
    expect((await call('/api/me/github-installations/99', { method: 'DELETE', headers })).status).toBe(404);

    // Another user's installation is not theirs to remove
    await db.insert(users).values({ id: 'u_other', name: 'Other' }).run();
    await db.insert(githubInstallations).values({ id: 77, accountLogin: 'other', userId: 'u_other' }).run();
    expect((await call('/api/me/github-installations/77', { method: 'DELETE', headers })).status).toBe(404);

    await call(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirm: 'loja' }),
    });
    const freeInstallation = await call('/api/me/github-installations/55', { method: 'DELETE', headers });
    expect(freeInstallation.status).toBe(200);
    expect(world.uninstalled).toEqual([55]);
    expect(await db.select().from(githubInstallations).where(eq(githubInstallations.id, 55)).get()).toBeUndefined();

    const freeCloudflare = await call(`/api/me/cloudflare/${connectionId}`, { method: 'DELETE', headers });
    expect(freeCloudflare.status).toBe(200);
    const body = (await freeCloudflare.json()) as { cloudflare: unknown[]; hint: string };
    expect(body.cloudflare).toEqual([]);
    expect(body.hint).toContain('Cloudflare dashboard');
    expect(await db.select().from(cfConnections).all()).toEqual([]);
  });
});

describe('account deletion', () => {
  it('deletes the projects, uninstalls the App, cancels billing, and a new sign-in starts from zero', async () => {
    target = {
      ...instance,
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_ID: 'price_20usd',
    };
    const { cookie } = await github({ id: 5001, login: 'ana' });
    const userId = (await me(cookie)).user.id;
    await db
      .insert(subscriptions)
      .values({
        id: 'sub_row',
        userId,
        stripeCustomerId: 'cus_ana',
        stripeSubscriptionId: 'sub_stripe',
        status: 'active',
      })
      .run();
    const { projectId, headers } = await userWithProject(cookie);
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    await saveAgentSettings(db, target, userId, {
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-validkey-0123456789abcdef',
    });
    // A member of someone else's project
    await db.insert(users).values({ id: 'u_carol', name: 'Carol', role: 'admin' }).run();
    await db
      .insert(projects)
      .values({
        id: 'p_carol',
        ownerUserId: 'u_carol',
        name: 'carol',
        repoOwner: 'carol',
        repoName: 'site',
        repoKey: 'carol/site',
        mode: 'byo',
      })
      .run();
    await db.insert(projectMembers).values({ projectId: 'p_carol', userId, role: 'member' }).run();

    expect((await call('/api/me', { method: 'DELETE', headers, body: JSON.stringify({}) })).status).toBe(400);
    const removed = await call('/api/me', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirm: true, deleteSites: false }),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ warnings: [] });
    expect(removed.headers.getSetCookie().some((value) => /^__Host-bohr_session=;/.test(value))).toBe(true);

    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toBeUndefined();
    expect(world.scripts.has(runtime?.script ?? '')).toBe(false);
    expect(await db.select().from(projects).where(eq(projects.id, 'p_carol')).get()).toBeDefined();
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, userId)).all()).toEqual([]);
    expect(world.uninstalled).toEqual([55]);
    expect(world.stripeCancelled).toEqual(['sub_stripe']);
    for (const table of [githubInstallations, cfConnections, subscriptions, onboarding, identities, sessions]) {
      expect(await db.select().from(table).where(eq(table.userId, userId)).all()).toEqual([]);
    }
    expect(await db.select().from(users).where(eq(users.id, userId)).get()).toBeUndefined();
    expect(
      await db
        .select()
        .from(instanceSettings)
        .where(eq(instanceSettings.key, `agent:${userId}`))
        .get(),
    ).toBeUndefined();
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'account.delete')).get();
    expect(audit).toMatchObject({ actor: `user:${userId}`, target: userId });
    expect((await call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401);

    // The same GitHub account signs in to a brand new account
    const { cookie: fresh } = await github({ id: 5001, login: 'ana' });
    const profile = await me(fresh);
    expect(profile.user.id).not.toBe(userId);
    const connections = (await (await call('/api/me/connections', { headers: { Cookie: fresh } })).json()) as Record<
      string,
      unknown
    >;
    expect(connections).toMatchObject({ githubInstallations: [], cloudflare: [], subscription: null });
    expect(
      ((await (await call('/api/projects', { headers: { Cookie: fresh } })).json()) as { projects: [] }).projects,
    ).toEqual([]);
  });

  it('keeps the only admin from leaving other users without one', async () => {
    const { cookie } = await github({ id: 5001, login: 'ana' });
    await emailSignIn('bob@example.com');
    const response = await call('/api/me', {
      method: 'DELETE',
      headers: { Cookie: cookie, ...json },
      body: JSON.stringify({ confirm: true, deleteSites: false }),
    });
    expect(response.status).toBe(409);
  });
});
