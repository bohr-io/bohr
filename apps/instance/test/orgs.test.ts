import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  auditLog,
  cfConnections,
  deployments,
  githubInstallations,
  identities,
  instanceSettings,
  orgMembers,
  orgs,
  projectMembers,
  projects,
  runtimes,
  sessions,
  subscriptions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { applyOwnerAgent, saveAgentSettings } from '../src/services/agent-settings';
import { saveGithubApp } from '../src/services/github-app';
import { installUrl } from '../src/services/onboarding';
import { DEFAULT_RUNTIME_IMAGE, provisionRuntime } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import type { ProvisionParams } from '../src/workflows/provision';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const IMAGE = `registry.cloudflare.com/acc-user/bohr-agent@sha256:${'c'.repeat(64)}`;
const ANA_KEY = 'sk-ant-api03-validkey-0123456789abcdef';
const BOB_KEY = 'sk-ant-api03-bobs-own-key-0123456789ab';
const CF_TOKEN = 'cf-user-token-0123456789abcdefghijklmnop';
// A self-hosted instance (no billing); billing tests use `cloud`
const selfHosted = {
  ...env,
  APP_URL: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  CF_API_TOKEN: undefined,
  CF_ACCOUNT_ID: undefined,
};
const cloud = {
  ...selfHosted,
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_ID: 'price_20',
};
let target: typeof env = selfHosted;
const call = async (path: string, init: RequestInit = {}) => app.request(path, init, target);
const json = { 'Content-Type': 'application/json' };

let world: FakeWorld;
let provisioning: ProvisionParams[];

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

type Person = { id: string; login: string; githubId: number; headers: Record<string, string> };

/** A bohr user signed in with GitHub (identity) and a session. */
async function person(
  id: string,
  login: string,
  githubId: number,
  options: { role?: 'user' | 'admin'; github?: boolean } = {},
): Promise<Person> {
  await db
    .insert(users)
    .values({ id, name: login, role: options.role ?? 'user' })
    .run();
  if (options.github !== false) {
    await db
      .insert(identities)
      .values({ id: `i_${id}`, userId: id, provider: 'github', providerUserId: String(githubId), username: login })
      .run();
  }
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { id, login, githubId, headers: { Cookie: `__Host-bohr_session=${token}`, ...json } };
}

const get = async <T = Record<string, unknown>>(path: string, who: Person) =>
  (await (await call(path, { headers: who.headers })).json()) as T;
const send = (method: string, path: string, who: Person, body: unknown = {}) =>
  call(path, { method, headers: who.headers, body: JSON.stringify(body) });

/** GitHub's redirect after installing, then the authorization that proves the installation is the person's. */
async function installed(installationId: number, state: string, installer: Person) {
  world.githubProfile = { id: installer.githubId, login: installer.login, name: installer.login, email: null };
  const back = await call(
    `/setup/github/installed?installation_id=${installationId}&setup_action=install&state=${state}`,
  );
  const authorize = new URL(back.headers.get('Location') ?? '');
  return call(`/setup/github/verify?code=oauth-code&state=${authorize.searchParams.get('state')}`);
}

/** The acme GitHub organization with the App installed (66): ana owns it, bob and carol are members. */
function acmeOnGithub() {
  world.installations.set(66, {
    login: 'acme',
    type: 'Organization',
    accountId: 7001,
    repos: [{ id: 950, name: 'site', owner: 'acme', default_branch: 'main' }],
  });
  world.githubOrgs.set('acme', {
    id: 7001,
    name: 'Acme Inc',
    members: [
      { id: 5001, login: 'ana', role: 'admin' },
      { id: 5002, login: 'bob', role: 'member' },
      { id: 5003, login: 'carol', role: 'member' },
    ],
  });
  world.userInstallations = [55, 66];
}

/** ana installs the App on acme from "+ org" and lands on the org's page. */
async function createAcme(ana: Person) {
  acmeOnGithub();
  const { url } = await get<{ url: string }>('/api/orgs/install-url', ana);
  const back = await installed(66, new URL(url).searchParams.get('state') ?? '', ana);
  expect(back.headers.get('Location')).toBe('/orgs/acme');
  const org = await db.select().from(orgs).where(eq(orgs.slug, 'acme')).get();
  if (org === undefined) throw new Error('no org');
  return org;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function webhook(event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('hook'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const response = await call('/api/github/webhook', {
    method: 'POST',
    headers: { 'X-GitHub-Event': event, 'X-Hub-Signature-256': `sha256=${signature}`, ...json },
    body,
  });
  expect(response.status).toBe(204);
}

const installationEvent = (action: string, senderId: number) => ({
  action,
  installation: { id: 66, account: { id: 7001, login: 'acme', type: 'Organization', avatar_url: null } },
  sender: { id: senderId, login: `user${senderId}` },
});

const memberEvent = (action: string, user: { id: number; login: string }, role = 'member') => ({
  action,
  membership: { role, state: 'active', user },
  organization: { id: 7001, login: 'acme' },
});

type MemberView = {
  githubUserId: number;
  githubLogin: string;
  userId: string | null;
  role: string;
  status: string;
  source: string;
};
const members = async (who: Person) => (await get<{ members: MemberView[] }>('/api/orgs/acme/members', who)).members;

/** An org project (acme/site) created by `creator`, provisioned in the org's Cloudflare account. */
async function orgProject(admin: Person, creator: Person) {
  expect((await send('POST', '/api/orgs/acme/cloudflare', admin, { token: CF_TOKEN })).status).toBe(200);
  const created = await send('POST', '/api/projects', creator, { repository: 'acme/site', org: 'acme' });
  expect(created.status).toBe(201);
  const { projectId } = (await created.json()) as { projectId: string };
  await provisionRuntime(db, target, projectId, { sleep: async () => {} });
  const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
  return { projectId, runtime };
}

beforeEach(async () => {
  await resetStorage();
  useFakes();
  world = new FakeWorld();
  deps.fetch = world.fetch;
  provisioning = [];
  deps.startProvisioning = async (_env, params) => {
    provisioning.push(params);
  };
  target = selfHosted;
  await saveGithubApp(db, selfHosted, {
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

describe('creating an organization', () => {
  it('creates the org from the install redirect and imports its members, pending until they sign in', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const eve = await person('u_eve', 'eve', 5009);
    const org = await createAcme(ana);
    expect(org).toMatchObject({ name: 'Acme Inc', githubLogin: 'acme', githubAccountId: 7001, installationId: 66 });
    // The org's installation is not ana's personal one
    expect(
      (await db.select().from(githubInstallations).where(eq(githubInstallations.id, 66)).get())?.userId,
    ).toBeNull();

    expect(await get('/api/orgs', ana)).toEqual({
      orgs: [
        {
          id: org.id,
          slug: 'acme',
          name: 'Acme Inc',
          avatarUrl: 'https://avatars.example/acme',
          role: 'admin',
          status: { subscription: true, cloudflare: false, agent: false, installation: true },
        },
      ],
    });
    expect(await members(ana)).toEqual([
      {
        githubUserId: 5001,
        githubLogin: 'ana',
        name: 'ana',
        email: null,
        userId: 'u_ana',
        role: 'admin',
        status: 'active',
        source: 'github',
      },
      {
        githubUserId: 5002,
        githubLogin: 'bob',
        name: 'bob',
        email: null,
        userId: 'u_bob',
        role: 'member',
        status: 'active',
        source: 'github',
      },
      {
        githubUserId: 5003,
        githubLogin: 'carol',
        name: null,
        email: null,
        userId: null,
        role: 'member',
        status: 'pending',
        source: 'github',
      },
    ]);
    expect(await get('/api/orgs/acme', bob)).toEqual({
      org: {
        id: org.id,
        slug: 'acme',
        name: 'Acme Inc',
        avatarUrl: 'https://avatars.example/acme',
        githubLogin: 'acme',
        role: 'member',
        status: { subscription: true, cloudflare: false, agent: false, installation: true },
        membersPermission: true,
      },
      billing: { enabled: false, subscribed: false },
    });
    expect((await call('/api/orgs/acme', { headers: eve.headers })).status).toBe(404);
    expect((await get<{ orgs: unknown[] }>('/api/orgs', eve)).orgs).toEqual([]);

    // carol signs in with GitHub for the first time: her membership becomes active
    world.githubProfile = { id: 5003, login: 'carol', name: 'Carol', email: null };
    const start = await call('/auth/github?redirect=/');
    const stateCookie = start.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-bohr_oauth='))
      ?.split(';')[0];
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
    await call(`/auth/github/callback?code=abc&state=${state}`, { headers: { Cookie: stateCookie ?? '' } });
    const carol = await db.select().from(identities).where(eq(identities.providerUserId, '5003')).get();
    expect((await members(ana)).find((member) => member.githubLogin === 'carol')).toMatchObject({
      userId: carol?.userId,
      status: 'active',
    });

    // dave joins the GitHub org later, then links GitHub to the account he made with his email
    await webhook('organization', memberEvent('member_added', { id: 5004, login: 'dave' }));
    expect((await members(ana)).find((member) => member.githubLogin === 'dave')).toMatchObject({ status: 'pending' });
    const dave = await person('u_dave', 'dave', 5004, { github: false });
    world.githubProfile = { id: 5004, login: 'dave', name: 'Dave', email: null };
    const linkStart = await call('/auth/github?redirect=/settings&link=1', { headers: dave.headers });
    const linkCookie = linkStart.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-bohr_oauth='))
      ?.split(';')[0];
    const linkState = new URL(linkStart.headers.get('Location') ?? '').searchParams.get('state');
    await call(`/auth/github/callback?code=abc&state=${linkState}`, {
      headers: { Cookie: [linkCookie, dave.headers.Cookie].join('; ') },
    });
    expect((await members(ana)).find((member) => member.githubLogin === 'dave')).toMatchObject({
      userId: 'u_dave',
      status: 'active',
    });
    expect((await get<{ orgs: { slug: string; role: string }[] }>('/api/orgs', dave)).orgs).toEqual([
      expect.objectContaining({ slug: 'acme', role: 'member' }),
    ]);
  });

  it('creates the org from the installation webhook only when a bohr user installed it', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    acmeOnGithub();
    // Someone bohr does not know: wait for the setup redirect
    await webhook('installation', installationEvent('created', 5999));
    expect(await db.select().from(orgs).all()).toEqual([]);
    expect(await db.select().from(githubInstallations).where(eq(githubInstallations.id, 66)).get()).toBeDefined();

    await webhook('installation', installationEvent('created', 5001));
    const org = await db.select().from(orgs).get();
    expect(org).toMatchObject({ slug: 'acme', name: 'Acme Inc', installationId: 66 });
    expect((await members(ana)).map((member) => [member.githubLogin, member.role, member.status])).toEqual([
      ['ana', 'admin', 'active'],
      ['bob', 'member', 'pending'],
      ['carol', 'member', 'pending'],
    ]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'org.create')).get()).toMatchObject({
      actorUserId: 'u_ana',
    });

    // Uninstalled on GitHub: the org stays, without installation; installing again links it back
    await webhook('installation', { ...installationEvent('deleted', 5001) });
    expect((await db.select().from(orgs).get())?.installationId).toBeNull();
    expect(
      (await get<{ org: { status: { installation: boolean } } }>('/api/orgs/acme', ana)).org.status.installation,
    ).toBe(false);
    world.githubOrgs.get('acme')?.members.push({ id: 5004, login: 'dave', role: 'member' });
    await webhook('installation', installationEvent('new_permissions_accepted', 5999));
    expect((await db.select().from(orgs).get())?.installationId).toBe(66);
    expect((await members(ana)).map((member) => member.githubLogin)).toEqual(['ana', 'bob', 'carol', 'dave']);
  });

  it('also creates the org when the App is installed on an organization from the personal onboarding', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    acmeOnGithub();
    const state = new URL(await installUrl(db, target, 'u_ana', 'web')).searchParams.get('state') ?? '';
    const back = await installed(66, state, ana);
    expect(back.headers.get('Location')).toBe('/start');
    // Personal as before (its repositories are listed for ana), and the org exists with ana as admin
    expect((await db.select().from(githubInstallations).where(eq(githubInstallations.id, 66)).get())?.userId).toBe(
      'u_ana',
    );
    expect((await get<{ orgs: { slug: string; role: string }[] }>('/api/orgs', ana)).orgs).toEqual([
      expect.objectContaining({ slug: 'acme', role: 'admin' }),
    ]);
  });
});

describe('members', () => {
  it('follows the organization webhook, honours removals and role overrides, and keeps an admin', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);

    await webhook('organization', memberEvent('member_added', { id: 5004, login: 'dave' }, 'admin'));
    await webhook('organization', memberEvent('member_invited', { id: 5005, login: 'erin' }));
    await webhook('organization', memberEvent('member_removed', { id: 5003, login: 'carol' }));
    expect((await members(ana)).map((member) => [member.githubLogin, member.role, member.status])).toEqual([
      ['ana', 'admin', 'active'],
      ['dave', 'admin', 'pending'],
      ['bob', 'member', 'active'],
    ]);

    // Only admins manage members
    expect((await send('PUT', '/api/orgs/acme/members/5004', bob, { role: 'member' })).status).toBe(403);
    expect((await send('POST', '/api/orgs/acme/members/sync', bob)).status).toBe(403);

    // The last active admin stays (dave is still pending)
    const demote = await send('PUT', '/api/orgs/acme/members/5001', ana, { role: 'member' });
    expect(demote.status).toBe(409);
    expect((await send('DELETE', '/api/orgs/acme/members/5001', ana)).status).toBe(409);
    expect((await send('PUT', '/api/orgs/acme/members/9999', ana, { role: 'admin' })).status).toBe(404);

    // A role set in bohr stays until GitHub changes that member's role
    const promoted = await send('PUT', '/api/orgs/acme/members/5002', ana, { role: 'admin' });
    expect(
      ((await promoted.json()) as { members: MemberView[] }).members.find((m) => m.githubLogin === 'bob'),
    ).toMatchObject({
      role: 'admin',
      source: 'bohr',
    });
    world.githubOrgs.get('acme')?.members.push({ id: 5004, login: 'dave', role: 'admin' });
    const synced = await send('POST', '/api/orgs/acme/members/sync', ana);
    const syncBody = (await synced.json()) as {
      members: MemberView[];
      added: number;
      removed: number;
      updated: number;
    };
    // carol is back on GitHub's list (the fake still has her): re-added as pending; the override stays
    expect(syncBody).toMatchObject({ added: 1, removed: 0, updated: 0, membersPermission: true });
    expect(syncBody.members.find((m) => m.githubLogin === 'bob')).toMatchObject({ role: 'admin', source: 'bohr' });
    const acme = world.githubOrgs.get('acme');
    const githubBob = acme?.members.find((member) => member.id === 5002);
    if (githubBob) githubBob.role = 'admin';
    await send('POST', '/api/orgs/acme/members/sync', ana);
    if (githubBob) githubBob.role = 'member';
    await send('POST', '/api/orgs/acme/members/sync', ana);
    expect((await members(ana)).find((m) => m.githubLogin === 'bob')).toMatchObject({
      role: 'member',
      source: 'github',
    });

    // Removed in bohr: no access, not listed, and syncs do not bring them back while they stay on GitHub
    const removed = await send('DELETE', '/api/orgs/acme/members/5002', ana);
    expect(((await removed.json()) as { members: MemberView[] }).members.map((m) => m.githubLogin)).not.toContain(
      'bob',
    );
    expect((await call('/api/orgs/acme', { headers: bob.headers })).status).toBe(404);
    expect(await send('POST', '/api/orgs/acme/members/sync', ana).then((r) => r.json())).toMatchObject({ added: 0 });
    expect((await members(ana)).map((m) => m.githubLogin)).not.toContain('bob');
    const row = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, 5002)))
      .get();
    expect(row?.status).toBe('removed');
    // Leaving the GitHub org clears the row
    if (acme) acme.members = acme.members.filter((member) => member.id !== 5002);
    expect(await send('POST', '/api/orgs/acme/members/sync', ana).then((r) => r.json())).toMatchObject({ removed: 0 });
    expect(
      await db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, 5002)))
        .get(),
    ).toBeUndefined();
  });

  it('pages through big organizations', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    world.memberPageSize = 2;
    acmeOnGithub();
    world.githubOrgs
      .get('acme')
      ?.members.push(
        { id: 5004, login: 'dave', role: 'member' },
        { id: 5005, login: 'erin', role: 'member' },
        { id: 5006, login: 'finn', role: 'admin' },
      );
    const { url } = await get<{ url: string }>('/api/orgs/install-url', ana);
    await installed(66, new URL(url).searchParams.get('state') ?? '', ana);
    expect((await members(ana)).map((member) => member.githubLogin)).toEqual([
      'ana',
      'finn',
      'bob',
      'carol',
      'dave',
      'erin',
    ]);
  });

  it('keeps only the installer when the App lacks Members: read, and imports once it is granted', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    world.membersDenied = 'token';
    await createAcme(ana);
    expect(await members(ana)).toEqual([
      expect.objectContaining({ githubLogin: 'ana', role: 'admin', status: 'active' }),
    ]);
    expect((await get<{ org: { membersPermission: boolean } }>('/api/orgs/acme', ana)).org.membersPermission).toBe(
      false,
    );
    // Another member who can see the installation replays the redirect: GitHub cannot tell, so a member
    const bob = await person('u_bob', 'bob', 5002);
    const { url } = await get<{ url: string }>('/api/orgs/install-url', bob);
    const replay = await installed(66, new URL(url).searchParams.get('state') ?? '', bob);
    expect(replay.headers.get('Location')).toBe('/orgs/acme');
    expect((await members(ana)).map((member) => [member.githubLogin, member.role])).toEqual([
      ['ana', 'admin'],
      ['bob', 'member'],
    ]);

    world.membersDenied = 'listing';
    const denied = await send('POST', '/api/orgs/acme/members/sync', ana);
    expect(await denied.json()).toMatchObject({ added: 0, removed: 0, updated: 0, membersPermission: false });

    world.membersDenied = null;
    const granted = await send('POST', '/api/orgs/acme/members/sync', ana);
    expect(await granted.json()).toMatchObject({ added: 1, membersPermission: true });
    expect((await get<{ org: { membersPermission: boolean } }>('/api/orgs/acme', ana)).org.membersPermission).toBe(
      true,
    );
  });
});

describe('organization resources', () => {
  it('connects the org Cloudflare account, creates org projects there and gives them the org agent', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);

    // Only admins connect Cloudflare; projects need it first
    expect((await send('POST', '/api/orgs/acme/cloudflare', bob, { token: CF_TOKEN })).status).toBe(403);
    expect((await send('POST', '/api/projects', bob, { repository: 'acme/site', org: 'acme' })).status).toBe(400);
    // Several accounts: an admin picks one
    world.accounts.push({ id: 'acc-work', name: 'Work' });
    const choose = await send('POST', '/api/orgs/acme/cloudflare', ana, { token: CF_TOKEN });
    expect(await choose.json()).toMatchObject({ status: 'choose_account' });
    const chosen = await send('POST', '/api/orgs/acme/cloudflare/account', ana, { accountId: 'acc-user' });
    expect(await chosen.json()).toMatchObject({ status: 'connected', accountName: "Ana's account" });
    // The same account can also be ana's personal connection
    world.accounts.pop();
    expect(
      await send('POST', '/api/onboarding/cloudflare', ana, { token: CF_TOKEN }).then((r) => r.json()),
    ).toMatchObject({
      status: 'connected',
    });
    const orgView = await get<{ connections: { id: string }[]; tokenTemplateUrl: string }>(
      '/api/orgs/acme/cloudflare',
      ana,
    );
    expect(orgView.connections).toHaveLength(1);
    const personal = await get<{ cloudflare: { connections: { id: string }[] } }>('/api/onboarding', ana);
    expect(personal.cloudflare.connections).toHaveLength(1);
    expect(personal.cloudflare.connections[0]?.id).not.toBe(orgView.connections[0]?.id);

    // The org's repositories, for any member; the personal list does not have them
    const repos = await get<{ repositories: { fullName: string }[] }>('/api/repositories?org=acme', bob);
    expect(repos.repositories.map((repo) => repo.fullName)).toEqual(['acme/site']);
    expect((await get<{ repositories: unknown[] }>('/api/repositories', bob)).repositories).toEqual([]);

    // A member creates a project: it belongs to the org and runs in the org's account
    const created = await send('POST', '/api/projects', bob, { repository: 'acme/site', org: 'acme', locale: 'en' });
    expect(created.status).toBe(201);
    const { projectId } = (await created.json()) as { projectId: string };
    expect(provisioning).toEqual([{ projectId, userId: 'u_bob', locale: 'en' }]);
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toMatchObject({
      orgId: org.id,
      ownerUserId: 'u_bob',
    });
    expect(await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).all()).toEqual([]);
    await provisionRuntime(db, target, projectId, { sleep: async () => {} });
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    expect(runtime).toMatchObject({
      status: 'ready',
      cfConnectionId: orgView.connections[0]?.id,
      accountId: 'acc-user',
    });
    // Each account says how many projects run there, as the personal connections do
    expect((await get<{ connections: { projects: number }[] }>('/api/orgs/acme/cloudflare', ana)).connections).toEqual([
      expect.objectContaining({ id: orgView.connections[0]?.id, projects: 1 }),
    ]);
    // The member who created it follows its setup (the new project page polls the runtime)
    const setup = await call(`/api/projects/${projectId}/runtime`, { headers: bob.headers });
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ status: 'ready' });
    const secrets = () => world.secrets.get(runtime?.script ?? '');

    // The org's agent: admins set it, members see it; it reaches the org's projects, not personal settings
    const bobKey = await saveAgentSettings(db, target, 'u_bob', { provider: 'anthropic', apiKey: ANA_KEY });
    expect(bobKey.applied).toBe(0);
    world.validAnthropicKeys.add(BOB_KEY);
    expect((await send('PUT', '/api/orgs/acme/agent', bob, { provider: 'anthropic', apiKey: BOB_KEY })).status).toBe(
      403,
    );
    const saved = await send('PUT', '/api/orgs/acme/agent', ana, {
      provider: 'anthropic',
      apiKey: BOB_KEY,
      effort: 'high',
    });
    expect(await saved.json()).toEqual({
      agent: { configured: true, provider: 'anthropic', baseUrl: null, model: null, effort: 'high', keyHint: '…89ab' },
      projects: { applied: 1, failed: 0 },
    });
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe(BOB_KEY);
    expect((await get<{ agent: { configured: boolean } }>('/api/orgs/acme/agent', bob)).agent.configured).toBe(true);
    expect((await get<{ org: { status: Record<string, boolean> } }>('/api/orgs/acme', bob)).org.status).toEqual({
      subscription: true,
      cloudflare: true,
      agent: true,
      installation: true,
    });
    // The Workflow gives a project its org's settings, not its creator's
    secrets()?.delete('ANTHROPIC_API_KEY');
    expect(await applyOwnerAgent(db, target, projectId)).toBe(true);
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe(BOB_KEY);

    // The Claude subscription for the org, through a ready project of the org (as its creator, its owner)
    expect((await send('POST', '/api/orgs/acme/agent/subscription/start', bob)).status).toBe(403);
    const started = await send('POST', '/api/orgs/acme/agent/subscription/start', ana);
    expect(await started.json()).toEqual({ projectId, loginId: 'login_0123456789', url: world.claudeLoginUrl });
    const authorization = world.projectWorkerCalls.at(-1)?.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    expect(decodeJwt(authorization).sub).toBe('u:u_bob');
    const finished = await send('POST', '/api/orgs/acme/agent/subscription/finish', ana, {
      projectId,
      loginId: 'login_0123456789',
      code: 'good-code#state',
    });
    expect(((await finished.json()) as { agent: { provider: string } }).agent.provider).toBe('subscription');
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe(world.claudeToken);
    expect((await get<{ agent: { provider: string } }>('/api/me/agent', ana)).agent).toMatchObject({
      configured: false,
    });
    expect(
      (await send('POST', '/api/orgs/acme/agent/subscription/cancel', ana, { projectId, loginId: 'login_0123456789' }))
        .status,
    ).toBe(200);
    expect((await send('DELETE', '/api/orgs/acme/agent', ana)).status).toBe(200);
    expect(secrets()?.has('ANTHROPIC_API_KEY')).toBe(false);

    // A connection projects run with stays
    const busy = await send('DELETE', `/api/orgs/acme/cloudflare/${orgView.connections[0]?.id}`, ana);
    expect(busy.status).toBe(409);
    expect((await send('DELETE', '/api/orgs/acme/cloudflare/cf_unknown', ana)).status).toBe(404);
  });

  it('charges the org its own subscription through Stripe Checkout and the webhook', async () => {
    target = cloud;
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);
    let checkout = new URLSearchParams();
    const previous = world.fetch;
    deps.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.href === 'https://api.stripe.com/v1/checkout/sessions') {
        checkout = new URLSearchParams(String(init?.body ?? ''));
        return Response.json({ url: 'https://checkout.stripe.com/c/org' });
      }
      if (url.href === 'https://api.stripe.com/v1/subscriptions/sub_org') {
        return Response.json({
          id: 'sub_org',
          customer: 'cus_org',
          status: 'active',
          items: { data: [{ price: { id: 'price_20' } }] },
        });
      }
      if (url.href === 'https://api.stripe.com/v1/billing_portal/sessions') {
        return Response.json({
          url: `https://billing.stripe.com/p/${new URLSearchParams(String(init?.body)).get('customer')}`,
        });
      }
      return previous(input, init);
    };
    // ana pays for herself too: the org's checkout never reuses her customer
    await db
      .insert(subscriptions)
      .values({ id: 'sub_ana', userId: 'u_ana', stripeCustomerId: 'cus_ana', status: 'canceled' })
      .run();

    expect((await send('POST', '/api/orgs/acme/billing/checkout', bob)).status).toBe(403);
    const response = await send('POST', '/api/orgs/acme/billing/checkout', ana);
    expect(await response.json()).toEqual({ url: 'https://checkout.stripe.com/c/org' });
    expect(Object.fromEntries(checkout)).toMatchObject({
      client_reference_id: 'u_ana',
      'metadata[orgId]': org.id,
      'subscription_data[metadata][orgId]': org.id,
      allow_promotion_codes: 'true',
      success_url: 'https://bohr.ana.workers.dev/orgs/acme?billing=success',
    });
    expect(checkout.has('customer')).toBe(false);

    // No project without the org's subscription
    expect((await send('POST', '/api/orgs/acme/cloudflare', ana, { token: CF_TOKEN })).status).toBe(200);
    expect((await send('POST', '/api/projects', bob, { repository: 'acme/site', org: 'acme' })).status).toBe(402);

    const stripeEvent = async (payload: unknown) => {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('whsec_test'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
      const answer = await call('/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': `t=${timestamp},v1=${mac}` },
        body,
      });
      expect(answer.status).toBe(200);
    };
    await stripeEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: 'u_ana',
          subscription: 'sub_org',
          metadata: { orgId: org.id },
        },
      },
    });
    expect(await db.select().from(subscriptions).where(eq(subscriptions.orgId, org.id)).get()).toMatchObject({
      userId: 'u_ana',
      stripeCustomerId: 'cus_org',
      status: 'active',
    });
    expect((await get<{ billing: unknown }>('/api/orgs/acme', bob)).billing).toEqual({
      enabled: true,
      subscribed: true,
    });
    // The org's subscription is not ana's own
    expect((await get<{ subscription: { status: string } }>('/api/billing', ana)).subscription.status).toBe('canceled');
    expect((await get<{ billing: { subscribed: boolean } }>('/api/onboarding', ana)).billing.subscribed).toBe(false);
    expect((await send('POST', '/api/orgs/acme/billing/checkout', ana)).status).toBe(400);
    const portal = await send('POST', '/api/orgs/acme/billing/portal', ana);
    expect(await portal.json()).toEqual({ url: 'https://billing.stripe.com/p/cus_org' });

    expect((await send('POST', '/api/projects', bob, { repository: 'acme/site', org: 'acme' })).status).toBe(201);

    await stripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_gone', customer: 'cus_org', status: 'canceled', items: { data: [] } } },
    });
    expect((await get<{ billing: unknown }>('/api/orgs/acme', ana)).billing).toEqual({
      enabled: true,
      subscribed: false,
    });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'billing.deleted')).get()).toMatchObject({
      target: `org:${org.id}`,
    });
  });
});

describe('access to organization projects', () => {
  it('gives org admins owner access, members member access, and nothing to others', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const eve = await person('u_eve', 'eve', 5009);
    const root = await person('u_root', 'root', 5010, { role: 'admin' });
    // carol signs up without GitHub: her membership stays pending (no access)
    const carol = await person('u_carol', 'carol', 5003, { github: false });
    await createAcme(ana);
    const { projectId } = await orgProject(ana, bob);

    const detail = async (who: Person) => {
      const response = await call(`/api/projects/${projectId}`, { headers: who.headers });
      if (response.status !== 200) return response.status;
      const body = (await response.json()) as { project: Record<string, unknown>; access: unknown; org: unknown };
      // The panel reads access and org at the top level; they stay inside project too
      expect(body.access).toBe(body.project.access);
      expect(body.org).toEqual(body.project.org);
      return body.project;
    };
    expect(await detail(ana)).toMatchObject({
      role: 'owner',
      access: 'member',
      org: { slug: 'acme', name: 'Acme Inc' },
    });
    expect(await detail(bob)).toMatchObject({ role: 'member', access: 'member' });
    expect(await detail(root)).toMatchObject({ role: 'owner', access: 'admin' });
    expect(await detail(eve)).toBe(404);
    expect(await detail(carol)).toBe(404);

    const setVariable = (who: Person) =>
      send('PUT', `/api/projects/${projectId}/variables`, who, {
        target: 'build',
        key: 'GREETING',
        value: 'hi',
        secret: false,
      });
    expect((await setVariable(ana)).status).toBe(200);
    expect((await setVariable(bob)).status).toBe(403);
    expect((await setVariable(eve)).status).toBe(404);
    expect((await setVariable(root)).status).toBe(200);
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'variable.set'), eq(auditLog.actorUserId, 'u_root')))
        .get(),
    ).toMatchObject({ actor: 'admin:u_root' });

    // The chat reaches the project Worker for members only
    const chat = (who: Person) => call(`/api/projects/${projectId}/agent/state`, { headers: who.headers });
    const grant = () =>
      decodeJwt(world.projectWorkerCalls.at(-1)?.headers.get('authorization')?.replace('Bearer ', '') ?? '').grant;
    expect((await chat(bob)).status).toBe(200);
    // The project Worker learns the role from the instance: org members need no invite code
    expect(grant()).toBe('member');
    expect((await chat(ana)).status).toBe(200);
    expect(grant()).toBe('owner');
    expect((await chat(eve)).status).toBe(404);
    // Members read the runtime's status; changing it is for owners: org admins
    expect((await call(`/api/projects/${projectId}/runtime`, { headers: ana.headers })).status).toBe(200);
    expect((await call(`/api/projects/${projectId}/runtime`, { headers: bob.headers })).status).toBe(200);
    expect((await call(`/api/projects/${projectId}/runtime`, { headers: eve.headers })).status).toBe(404);
    expect((await send('POST', `/api/projects/${projectId}/runtime/retry`, bob)).status).toBe(403);

    // The org's projects list, by context
    type ListItem = { id: string; role: string; org: { slug: string } | null };
    const list = async (who: Person, query = '') =>
      call(`/api/projects${query}`, { headers: who.headers }).then(async (r) =>
        r.status === 200 ? ((await r.json()) as { projects: ListItem[] }).projects : r.status,
      );
    expect(await list(ana, '?org=acme')).toEqual([
      expect.objectContaining({ id: projectId, role: 'owner', org: { slug: 'acme', name: 'Acme Inc' } }),
    ]);
    expect(await list(bob, '?org=acme')).toEqual([expect.objectContaining({ id: projectId, role: 'member' })]);
    expect(await list(root, '?org=acme')).toEqual([expect.objectContaining({ id: projectId, role: 'owner' })]);
    expect(await list(eve, '?org=acme')).toBe(404);
    expect(await list(bob, '?org=nope')).toBe(404);
    // Without ?org: personal projects as before
    expect(await list(bob)).toEqual([]);
    // A member row on an org project (as v1 imports leave them) lists it without ?org, but not in the personal scope
    await db.insert(projectMembers).values({ projectId, userId: 'u_bob', role: 'member' }).run();
    expect(await list(bob)).toEqual([expect.objectContaining({ id: projectId, role: 'member' })]);
    expect(await list(bob, '?scope=personal')).toEqual([]);
    // An org admin with such a member row still owns the project there (the panel turns the agent on for owners)
    await db
      .insert(projectMembers)
      .values({ projectId, userId: 'u_ana', role: 'member' })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: 'member' } })
      .run();
    expect(await list(ana)).toEqual([expect.objectContaining({ id: projectId, role: 'owner' })]);
    await db.delete(projectMembers).where(eq(projectMembers.userId, 'u_bob')).run();
    // Each project says when it changed and its latest deploy, of any branch
    await db
      .insert(deployments)
      .values([
        { id: 'd_old', projectId, branch: 'main', script: 's', status: 'success', createdAt: new Date(1_000) },
        { id: 'd_new', projectId, branch: 'feature', script: 's', status: 'error', createdAt: new Date(2_000) },
      ])
      .run();
    expect(await list(ana, '?org=acme')).toEqual([
      expect.objectContaining({
        updatedAt: expect.any(String),
        lastDeploy: { status: 'error', branch: 'feature', createdAt: new Date(2_000).toISOString() },
      }),
    ]);

    // A removed member loses access at once
    await send('DELETE', '/api/orgs/acme/members/5002', ana);
    expect(await detail(bob)).toBe(404);
    // Deleting an org project is for owners
    expect((await send('DELETE', `/api/projects/${projectId}`, bob, { confirm: 'site' })).status).toBe(404);
    expect((await send('DELETE', `/api/projects/${projectId}`, ana, { confirm: 'site' })).status).toBe(200);
  });
});

describe('deleting', () => {
  it('deletes an org with its projects, subscription, connections, agent and installation', async () => {
    target = cloud;
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);
    await db
      .insert(subscriptions)
      .values({
        id: 'sub_org',
        userId: 'u_ana',
        orgId: org.id,
        stripeCustomerId: 'cus_org',
        stripeSubscriptionId: 'sub_stripe_org',
        status: 'active',
      })
      .run();
    const { projectId, runtime } = await orgProject(ana, bob);
    await saveAgentSettings(
      db,
      target,
      { kind: 'org', id: org.id },
      { provider: 'anthropic', apiKey: ANA_KEY },
      'u_ana',
    );

    expect((await send('DELETE', '/api/orgs/acme', bob, { confirm: 'acme' })).status).toBe(403);
    expect((await send('DELETE', '/api/orgs/acme', ana, { confirm: 'wrong' })).status).toBe(400);
    const removed = await send('DELETE', '/api/orgs/acme', ana, { confirm: 'acme', deleteSites: false });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ warnings: [] });

    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toBeUndefined();
    expect(world.scripts.has(runtime?.script ?? '')).toBe(false);
    expect(world.stripeCancelled).toEqual(['sub_stripe_org']);
    expect(world.uninstalled).toEqual([66]);
    expect(await db.select().from(orgs).all()).toEqual([]);
    expect(await db.select().from(orgMembers).all()).toEqual([]);
    expect(await db.select().from(cfConnections).all()).toEqual([]);
    expect(await db.select().from(subscriptions).where(eq(subscriptions.orgId, org.id)).all()).toEqual([]);
    expect(await db.select().from(githubInstallations).where(eq(githubInstallations.id, 66)).get()).toBeUndefined();
    expect(
      await db
        .select()
        .from(instanceSettings)
        .where(eq(instanceSettings.key, `agent:org:${org.id}`))
        .get(),
    ).toBeUndefined();
    expect((await get<{ orgs: unknown[] }>('/api/orgs', ana)).orgs).toEqual([]);
  });

  it('deleting an account leaves its orgs, refuses to leave one without an admin, and takes solo orgs along', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);
    const { projectId } = await orgProject(ana, ana);
    const connection = await db.select().from(cfConnections).where(eq(cfConnections.orgId, org.id)).get();
    expect(connection?.userId).toBe('u_ana');

    const blocked = await send('DELETE', '/api/me', ana, { confirm: true });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ orgs: ['acme'] });
    expect(await db.select().from(users).where(eq(users.id, 'u_ana')).get()).toBeDefined();

    await send('PUT', '/api/orgs/acme/members/5002', ana, { role: 'admin' });
    const deleted = await send('DELETE', '/api/me', ana, { confirm: true });
    expect(deleted.status).toBe(200);
    // The org stays with bob: ana's project, connection and the installation pass on
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toMatchObject({
      ownerUserId: 'u_bob',
    });
    expect((await db.select().from(cfConnections).where(eq(cfConnections.orgId, org.id)).get())?.userId).toBe('u_bob');
    expect(world.uninstalled).toEqual([]);
    expect((await members(bob)).find((member) => member.githubLogin === 'ana')).toBeUndefined();
    expect(await db.select().from(orgMembers).where(eq(orgMembers.userId, 'u_ana')).all()).toEqual([]);
    expect((await call(`/api/projects/${projectId}`, { headers: bob.headers })).status).toBe(200);

    // bob is acme's only member now: deleting his account deletes the org
    world.githubOrgs.set('acme', { id: 7001, name: 'Acme Inc', members: [{ id: 5002, login: 'bob', role: 'admin' }] });
    await send('POST', '/api/orgs/acme/members/sync', bob);
    const solo = await send('DELETE', '/api/me', bob, { confirm: true });
    expect(solo.status).toBe(200);
    expect(await db.select().from(orgs).all()).toEqual([]);
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toBeUndefined();
    expect(world.uninstalled).toEqual([66]);
  });
  it('hands over what a removed member created in an org when they delete their account', async () => {
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);
    const { projectId } = await orgProject(ana, bob);
    await send('DELETE', '/api/orgs/acme/members/5002', ana);
    const deleted = await send('DELETE', '/api/me', bob, { confirm: true });
    expect(deleted.status).toBe(200);
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toMatchObject({
      orgId: org.id,
      ownerUserId: 'u_ana',
    });
    expect(await db.select().from(cfConnections).where(eq(cfConnections.orgId, org.id)).all()).toHaveLength(1);
    expect(await db.select().from(users).where(eq(users.id, 'u_bob')).get()).toBeUndefined();
  });
});

describe('admin panel', () => {
  it('lists orgs, shows the org of each project and the orgs of a user', async () => {
    const root = await person('u_root', 'root', 5010, { role: 'admin' });
    const ana = await person('u_ana', 'ana', 5001);
    const bob = await person('u_bob', 'bob', 5002);
    const org = await createAcme(ana);
    const { projectId } = await orgProject(ana, bob);

    expect((await call('/api/manage/orgs', { headers: ana.headers })).status).toBe(403);
    expect(await get('/api/manage/orgs', root)).toEqual({
      orgs: [{ id: org.id, slug: 'acme', name: 'Acme Inc', members: 3, projects: 1, subscription: null }],
      total: 1,
    });
    expect(await get('/api/manage/orgs?query=nothing', root)).toEqual({ orgs: [], total: 0 });
    expect((await get<{ total: number }>('/api/manage/orgs?query=ACME', root)).total).toBe(1);
    const projectList = await get<{ projects: { id: string; org: unknown }[] }>('/api/manage/projects', root);
    expect(projectList.projects).toEqual([
      expect.objectContaining({ id: projectId, org: { slug: 'acme', name: 'Acme Inc' } }),
    ]);
    const detail = await get<{ orgs: unknown[]; projects: { org: unknown }[] }>('/api/manage/users/u_bob', root);
    expect(detail.orgs).toEqual([{ id: org.id, slug: 'acme', name: 'Acme Inc', role: 'member' }]);
    expect(detail.projects).toEqual([expect.objectContaining({ org: { slug: 'acme', name: 'Acme Inc' } })]);
    // The users list shows each user's organizations
    const userList = await get<{ users: { id: string; orgs: unknown[] }[] }>('/api/manage/users', root);
    expect(userList.users.find((user) => user.id === 'u_bob')?.orgs).toEqual([{ slug: 'acme', name: 'Acme Inc' }]);
    expect(userList.users.find((user) => user.id === 'u_root')?.orgs).toEqual([]);
    // An instance admin can open any org with admin access
    expect((await get<{ org: { role: string } }>('/api/orgs/acme', root)).org.role).toBe('admin');
  });
});
