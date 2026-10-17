import { env } from 'cloudflare:workers';
import { signBrokerRequest } from '@bohr/shared';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  envVars,
  githubInstallations,
  identities,
  projectMembers,
  projects,
  runtimes,
  sessions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { vault } from '../src/lib/vault';
import { projectSecretContext } from '../src/routes/runtime';
import { githubApp, saveGithubApp } from '../src/services/github-app';
import { buildVariableContext } from '../src/services/variables';
import { call, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const PROJECT_SECRET = 'project-secret-0123456789abcdef-xyz';
let requests: Request[] = [];

async function pkcs8Pem() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const base64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
}
const privateKey = await pkcs8Pem();

async function seedProject() {
  await db.insert(users).values({ id: 'u_owner', name: 'Ana' }).run();
  await db
    .insert(projects)
    .values({
      id: 'p_store',
      ownerUserId: 'u_owner',
      name: 'Loja',
      repoOwner: 'acme',
      repoName: 'store',
      repoKey: 'acme/store',
      mode: 'byo',
    })
    .run();
  await db.insert(projectMembers).values({ projectId: 'p_store', userId: 'u_owner', role: 'owner' }).run();
  await db
    .insert(runtimes)
    .values({
      projectId: 'p_store',
      accountId: 'acc-user',
      script: 'bohr-loja-x1',
      previewScript: 'bohr-loja-preview-k2j4',
      workerUrl: 'https://bohr-loja-x1.ana.workers.dev',
      previewUrl: 'https://bohr-loja-preview-k2j4.ana.workers.dev',
      projectSecretSealed: await vault(env).seal(PROJECT_SECRET, projectSecretContext('p_store')),
      status: 'ready',
    })
    .run();
  await saveGithubApp(db, env, {
    appId: '12345',
    slug: 'bohr-test',
    clientId: 'Iv1.client',
    clientSecret: 'client-secret',
    privateKey,
    webhookSecret: 'hook-secret',
  });
}

async function sessionCookie(userId: string) {
  const token = `session-${userId}-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return `__Host-bohr_session=${token}`;
}

beforeEach(async () => {
  await resetStorage();
  useFakes();
  requests = [];
  deps.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === '/repos/acme/store/installation')
      return Response.json({ id: 777, account: { login: 'acme' } });
    if (url.pathname === '/app/installations/777/access_tokens') {
      return Response.json(
        {
          token: 'ghs_scoped',
          expires_at: '2026-10-11T15:00:00Z',
          permissions: { contents: 'write' },
          repositories: [{ name: 'store' }],
        },
        { status: 201 },
      );
    }
    if (url.pathname === '/app-manifests/manifest-code/conversions') {
      return Response.json(
        {
          id: 999,
          slug: 'bohr-example',
          name: 'bohr example',
          client_id: 'Iv1.new',
          client_secret: 'new-secret',
          webhook_secret: 'new-hook',
          pem: privateKey,
          html_url: 'https://github.com/apps/bohr-example',
          owner: { login: 'ana' },
        },
        { status: 201 },
      );
    }
    if (url.hostname === 'bohr-loja-x1.ana.workers.dev') {
      if (url.pathname.endsWith('/evil')) {
        return new Response('<script>alert(1)</script>', { headers: { 'Content-Type': 'text/html' } });
      }
      return Response.json({ ok: true, path: url.pathname });
    }
    return new Response('unexpected', { status: 500 });
  };
});

describe('broker', () => {
  const brokerCall = async (secret: string, body = '{"scope":"worker"}', project = 'p_store') => {
    const path = '/api/runtime/v1/github-token';
    const headers = await signBrokerRequest(project, secret, { method: 'POST', path, body });
    return call(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
  };

  it('gives a project Worker a token for its own repository only', async () => {
    await seedProject();
    const response = await brokerCall(PROJECT_SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: 'ghs_scoped',
      expiresAt: '2026-10-11T15:00:00Z',
      repository: 'acme/store',
    });
    const tokenRequest = requests.find((request) => request.url.endsWith('/access_tokens'));
    expect(await tokenRequest?.json()).toEqual({
      repositories: ['store'],
      permissions: { contents: 'write', pull_requests: 'write', workflows: 'write', actions: 'read' },
    });
    expect(tokenRequest?.headers.get('authorization')).toMatch(/^Bearer ey/);
  });

  it('restricts the token to the repository id when the project knows it', async () => {
    await seedProject();
    await db.update(projects).set({ repoId: 4242 }).where(eq(projects.id, 'p_store')).run();
    expect((await brokerCall(PROJECT_SECRET, '{"scope":"sandbox"}')).status).toBe(200);
    const tokenRequest = requests.find((request) => request.url.endsWith('/access_tokens'));
    expect(await tokenRequest?.json()).toEqual({ repository_ids: [4242], permissions: { contents: 'write' } });
  });

  it('refuses unsigned, mis-signed and unknown callers', async () => {
    await seedProject();
    expect((await brokerCall('wrong-secret-0123456789abcdef-xyz')).status).toBe(401);
    expect((await brokerCall(PROJECT_SECRET, '{"scope":"worker"}', 'p_unknown')).status).toBe(401);
    const unsigned = await call('/api/runtime/v1/github-token', { method: 'POST', body: '{"scope":"worker"}' });
    expect(unsigned.status).toBe(401);
    expect(requests.filter((request) => request.url.includes('api.github.com'))).toHaveLength(0);
  });
});

describe('identity lookups from project Workers', () => {
  it('returns the instance user key of a linked Telegram account', async () => {
    await seedProject();
    await db
      .insert(identities)
      .values({ id: 'i_tg', userId: 'u_owner', provider: 'telegram', providerUserId: '1001', username: 'ana' })
      .run();
    const lookup = async (memberKey: string) => {
      const path = '/api/runtime/v1/identity';
      const body = JSON.stringify({ memberKey });
      const headers = await signBrokerRequest('p_store', PROJECT_SECRET, { method: 'POST', path, body });
      return (
        await call(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body })
      ).json();
    };
    expect(await lookup('tg:1001')).toEqual({ keys: ['tg:1001', 'u:u_owner'] });
    expect(await lookup('tg:9999')).toEqual({ keys: ['tg:9999'] });
  });
});

describe('member changes from project Workers', () => {
  it('lists the project for members who joined through the project bot, and removes them', async () => {
    await seedProject();
    const report = async (body: Record<string, string>) => {
      const path = '/api/runtime/v1/members';
      const text = JSON.stringify(body);
      const headers = await signBrokerRequest('p_store', PROJECT_SECRET, { method: 'POST', path, body: text });
      return call(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: text });
    };
    // Nobody with that Telegram account uses the instance yet: nothing to list
    expect((await report({ action: 'joined', memberKey: 'tg:2002', name: 'Bruno' })).status).toBe(204);
    expect(await db.select().from(identities).where(eq(identities.providerUserId, '2002')).get()).toBeUndefined();

    await db.insert(users).values({ id: 'u_bruno', name: 'Bruno' }).run();
    await db
      .insert(identities)
      .values({ id: 'i_bruno', userId: 'u_bruno', provider: 'telegram', providerUserId: '2002' })
      .run();
    expect((await report({ action: 'joined', memberKey: 'tg:2002', name: 'Bruno' })).status).toBe(204);
    const identity = await db.select().from(identities).where(eq(identities.providerUserId, '2002')).get();
    const member = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, identity?.userId ?? ''))
      .get();
    expect(member).toMatchObject({ projectId: 'p_store', role: 'member' });

    await report({ action: 'removed', memberKey: 'tg:2002', name: 'Bruno' });
    expect(
      await db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, identity?.userId ?? ''))
        .get(),
    ).toBeUndefined();
    // The owner is never removed this way
    await report({ action: 'removed', memberKey: 'u:u_owner', name: 'Ana' });
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, 'u_owner')).all()).toEqual([
      expect.objectContaining({ role: 'owner' }),
    ]);
  });
});

describe('web to project Worker', () => {
  it('signs a short-lived token for the member and forwards the call', async () => {
    await seedProject();
    await db
      .insert(identities)
      .values({ id: 'i_tg', userId: 'u_owner', provider: 'telegram', providerUserId: '1001', username: 'ana' })
      .run();
    const response = await call('/api/projects/p_store/agent/state?x=1', {
      headers: { Cookie: await sessionCookie('u_owner'), 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: '/__bohr/api/v1/state' });

    const forwarded = requests.at(-1);
    expect(forwarded?.url).toBe('https://bohr-loja-x1.ana.workers.dev/__bohr/api/v1/state?x=1');
    const token = forwarded?.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    const jwks = (await (await call('/.well-known/bohr-runtime-jwks.json')).json()) as Parameters<
      typeof createLocalJWKSet
    >[0];
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: env.APP_URL,
      audience: 'project:p_store',
    });
    expect(payload).toMatchObject({ sub: 'tg:1001', name: 'Ana', locale: 'pt-BR' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
  });

  it('uses the instance user id without a Telegram account, and needs a session', async () => {
    await seedProject();
    await call('/api/projects/p_store/agent/messages', {
      method: 'POST',
      headers: { Cookie: await sessionCookie('u_owner'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Oi' }),
    });
    const forwarded = requests.at(-1);
    expect(await forwarded?.text()).toBe('{"text":"Oi"}');
    const token = forwarded?.headers.get('authorization')?.split('.')[1] ?? '';
    expect(JSON.parse(atob(token.replaceAll('-', '+').replaceAll('_', '/'))).sub).toBe('u:u_owner');
    expect((await call('/api/projects/p_store/agent/state')).status).toBe(401);
  });
});

describe('agent proxy safety', () => {
  it('serves only JSON, only to members, and lets anyone signed in try an invite code', async () => {
    await seedProject();
    const owner = await sessionCookie('u_owner');
    const evil = await call('/api/projects/p_store/agent/evil', { headers: { Cookie: owner } });
    expect(evil.status).toBe(502);
    expect(evil.headers.get('content-type')).toContain('application/json');

    await db.insert(users).values({ id: 'u_stranger', name: 'Stranger' }).run();
    const stranger = await sessionCookie('u_stranger');
    expect((await call('/api/projects/p_store/agent/state', { headers: { Cookie: stranger } })).status).toBe(404);
    const joined = await call('/api/projects/p_store/agent/join', {
      method: 'POST',
      headers: { Cookie: stranger, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'K7P2-9QXM' }),
    });
    expect(joined.status).toBe(200);
    expect(joined.headers.get('x-content-type-options')).toBe('nosniff');
    const member = await db.select().from(projectMembers).where(eq(projectMembers.userId, 'u_stranger')).get();
    expect(member).toMatchObject({ projectId: 'p_store', role: 'member' });
  });
});

describe('first-run setup', () => {
  // A self-hosted instance: no GitHub App configured through secrets
  const selfHosted = { ...env, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined };
  const call = (path: string, init: RequestInit = {}) => app.request(path, init, selfHosted);

  it('creates the GitHub App from a manifest, guarded by the admin token', async () => {
    const form = await call('/setup');
    expect(await form.text()).toContain('Create the GitHub App');

    const wrong = await call('/setup/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=nope&name=bohr+test&public=on',
    });
    expect(wrong.status).toBe(401);

    const started = await call('/setup/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(env.ADMIN_TOKEN)}&name=bohr+test&org=acme&public=on`,
    });
    const html = await started.text();
    const state = /state=([\w-]+)/.exec(html)?.[1] ?? '';
    expect(html).toContain(`https://github.com/organizations/acme/settings/apps/new?state=${state}`);
    expect(html).toContain('&quot;hook_attributes&quot;');
    const cookie = started.headers.getSetCookie().find((value) => value.startsWith('__Host-bohr_setup='));
    expect(cookie).toContain('HttpOnly');

    const forged = await call('/setup/github/callback?code=manifest-code&state=forged', {
      headers: { Cookie: cookie?.split(';')[0] ?? '' },
    });
    expect(forged.status).toBe(401);

    const done = await call(`/setup/github/callback?code=manifest-code&state=${state}`, {
      headers: { Cookie: cookie?.split(';')[0] ?? '' },
    });
    expect(done.headers.get('Location')).toBe('https://github.com/apps/bohr-example/installations/new');
    expect(await githubApp(db, selfHosted)).toMatchObject({ appId: '999', slug: 'bohr-example', clientId: 'Iv1.new' });
    expect(await (await call('/setup')).text()).toContain('bohr is set up');
  });

  it('keeps installations in sync from signed webhooks', async () => {
    await seedProject();
    const body = JSON.stringify({
      action: 'created',
      installation: { id: 4242, account: { login: 'acme', type: 'Organization' } },
    });
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('hook-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    const signature = `sha256=${[...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

    const bad = await call('/api/github/webhook', {
      method: 'POST',
      headers: { 'X-GitHub-Event': 'installation', 'X-Hub-Signature-256': 'sha256=00' },
      body,
    });
    expect(bad.status).toBe(401);
    const good = await call('/api/github/webhook', {
      method: 'POST',
      headers: { 'X-GitHub-Event': 'installation', 'X-Hub-Signature-256': signature },
      body,
    });
    expect(good.status).toBe(204);
    expect(await db.select().from(githubInstallations).all()).toEqual([
      expect.objectContaining({ id: 4242, accountLogin: 'acme', accountType: 'Organization' }),
    ]);
  });
});

describe('master key rotation', () => {
  it('re-seals every stored secret under the new key, which then works without the old one', async () => {
    await seedProject();
    await db
      .insert(envVars)
      .values({
        id: 'v_build',
        projectId: 'p_store',
        key: 'API_KEY',
        target: 'build',
        isSecret: true,
        valueSealed: await vault(env).seal('build-secret', buildVariableContext('p_store', '*', 'API_KEY')),
      })
      .run();
    const newKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const rotating = { ...env, ENCRYPTION_KEY: `k2:${newKey},k1:${env.ENCRYPTION_KEY}` };
    const response = await app.request(
      '/api/admin/vault/rewrap',
      { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } },
      rotating,
    );
    const result = (await response.json()) as { total: number; rewrapped: number };
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.rewrapped).toBe(result.total);

    const onlyNew = { ...env, ENCRYPTION_KEY: `k2:${newKey}` };
    expect(await githubApp(db, onlyNew)).toMatchObject({ appId: '12345' });
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, 'p_store')).get();
    expect(runtime?.projectSecretSealed.startsWith('v2.k2.')).toBe(true);
    expect(await vault(onlyNew).open(runtime?.projectSecretSealed ?? '', projectSecretContext('p_store'))).toBe(
      PROJECT_SECRET,
    );
    const build = await db.select().from(envVars).where(eq(envVars.id, 'v_build')).get();
    expect(await vault(onlyNew).open(build?.valueSealed ?? '', buildVariableContext('p_store', '*', 'API_KEY'))).toBe(
      'build-secret',
    );
  });
});

describe('instance info', () => {
  it('tells the sign-in page what is set up', async () => {
    const selfHosted = { ...env, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined };
    const before = await app.request('/api/instance', {}, selfHosted);
    expect(await before.json()).toEqual({
      setup: { githubApp: false, platformBot: false },
      billing: false,
      telegramBot: null,
      githubAppSlug: null,
    });
    await seedProject();
    const after = (await (await app.request('/api/instance', {}, selfHosted)).json()) as {
      setup: { githubApp: boolean };
    };
    expect(after.setup.githubApp).toBe(true);
  });
});
