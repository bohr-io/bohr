import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  cfConnections,
  envVars,
  hostnames,
  projectMembers,
  projects,
  runtimeSecrets,
  runtimes,
  sessions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { vault } from '../src/lib/vault';
import { saveGithubApp } from '../src/services/github-app';
import { cfTokenContext } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import { buildVariableContext } from '../src/services/variables';
import type { FakeCloudflare } from './fake-cloudflare';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const cloud = { ...env, APP_URL: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined };
const call = (path: string, init: RequestInit = {}) => app.request(path, init, cloud);

let world: FakeWorld;
let bohr: FakeCloudflare;
let repoFiles: Map<string, string>;
let deletedActionsSecrets: string[];
let failSecretDeletes: boolean;

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

beforeEach(async () => {
  await resetStorage();
  bohr = useFakes();
  world = new FakeWorld();
  repoFiles = new Map([
    ['.bohr/deploy.json', JSON.stringify({ directory: 'site', build: 'npm run build' })],
    ['site/wrangler.jsonc', '// the site\n{ "name": "loja-aurora", "compatibility_date": "2026-10-01" }'],
  ]);
  deletedActionsSecrets = [];
  failSecretDeletes = false;
  deps.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const file = /^\/repos\/ana\/loja\/contents\/(.+)$/.exec(url.pathname);
    if (url.hostname === 'api.github.com' && file?.[1] !== undefined) {
      const text = repoFiles.get(decodeURIComponent(file[1]));
      return text === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({ type: 'file', sha: 'blob', encoding: 'base64', content: btoa(text) });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/ana/loja/actions/runs') {
      return Response.json({
        workflow_runs: [
          {
            id: 4,
            name: 'bohr deploy',
            display_title: 'Botão verde',
            run_number: 3,
            head_branch: 'main',
            head_sha: 'a'.repeat(40),
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/ana/loja/actions/runs/4',
            event: 'push',
            created_at: '2026-10-11T10:00:00Z',
            updated_at: '2026-10-11T10:02:00Z',
          },
          {
            id: 5,
            name: 'bohr deploy',
            display_title: 'Banner',
            run_number: 4,
            head_branch: 'main',
            head_sha: 'b'.repeat(40),
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/ana/loja/actions/runs/5',
            event: 'push',
            created_at: '2026-10-11T11:00:00Z',
            updated_at: '2026-10-11T11:01:00Z',
          },
        ],
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/ana/loja/actions/runs/5/jobs') {
      return Response.json({
        jobs: [
          {
            id: 9,
            name: 'deploy',
            status: 'completed',
            conclusion: 'failure',
            started_at: '2026-10-11T11:00:05Z',
            completed_at: '2026-10-11T11:01:00Z',
            html_url: 'https://github.com/ana/loja/actions/runs/5/job/9',
            steps: [{ number: 4, name: 'Build', status: 'completed', conclusion: 'failure' }],
          },
        ],
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/ana/loja/actions/jobs/9/logs') {
      return new Response('2026-10-11T11:00:30.0000000Z npm ERR! Missing script: "build"', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    const secret = /^\/repos\/ana\/loja\/actions\/secrets\/([A-Z_]+)$/.exec(url.pathname);
    if (url.hostname === 'api.github.com' && secret?.[1] !== undefined && request.method === 'DELETE') {
      if (failSecretDeletes)
        return Response.json({ message: 'Resource not accessible by integration' }, { status: 403 });
      deletedActionsSecrets.push(secret[1]);
      return new Response(null, { status: 204 });
    }
    return world.fetch(input, init);
  };
  await saveGithubApp(db, cloud, {
    appId: '321',
    slug: 'bohr-ana',
    clientId: 'Iv1.ana',
    clientSecret: 'secret',
    privateKey: appKey,
    webhookSecret: 'hook',
  });
  await writeSetting(db, 'app_url', 'https://app.bohr.example');
});

async function project(mode: 'byo' | 'managed') {
  await db
    .insert(users)
    .values([
      { id: 'u_ana', name: 'Ana' },
      { id: 'u_bruno', name: 'Bruno' },
    ])
    .run();
  const headers: Record<string, Record<string, string>> = {};
  for (const id of ['u_ana', 'u_bruno']) {
    const token = `session-${id}`;
    await db
      .insert(sessions)
      .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
      .run();
    headers[id] = { Cookie: `__Host-bohr_session=${token}`, 'Content-Type': 'application/json' };
  }
  await db
    .insert(projects)
    .values({
      id: 'p_loja',
      ownerUserId: 'u_ana',
      name: 'Loja',
      repoOwner: 'ana',
      repoName: 'loja',
      repoKey: 'ana/loja',
      mode,
    })
    .run();
  await db.insert(projectMembers).values([
    { projectId: 'p_loja', userId: 'u_ana', role: 'owner' },
    { projectId: 'p_loja', userId: 'u_bruno', role: 'member' },
  ]);
  if (mode === 'byo') {
    await db
      .insert(cfConnections)
      .values({
        id: 'cf1',
        userId: 'u_ana',
        accountId: 'acc-user',
        tokenSealed: await vault(cloud).seal('cf-user-token-0123456789abcdefghijklmnop', cfTokenContext('cf1')),
      })
      .run();
    await db
      .insert(runtimes)
      .values({
        projectId: 'p_loja',
        cfConnectionId: 'cf1',
        accountId: 'acc-user',
        script: 'bohr-loja-x1',
        previewScript: 'bohr-loja-preview-x1',
        projectSecretSealed: 'x',
        status: 'ready',
      })
      .run();
  }
  return { owner: headers.u_ana ?? {}, member: headers.u_bruno ?? {} };
}

const put = (headers: Record<string, string>, body: unknown) =>
  call('/api/projects/p_loja/variables', { method: 'PUT', headers, body: JSON.stringify(body) });

describe('environment variables', () => {
  it("puts site variables on the production Worker in the owner's account and build ones in Actions", async () => {
    const { owner, member } = await project('byo');

    // The site was never deployed: there is no Worker to hold its variables yet
    const early = await put(owner, {
      target: 'runtime',
      key: 'API_URL',
      value: 'https://api.example.com',
      secret: false,
    });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: expect.stringContaining('loja-aurora') });

    world.scripts.set('loja-aurora', { metadata: {}, modules: [] });
    expect(
      (await put(owner, { target: 'runtime', key: 'API_URL', value: 'https://api.example.com', secret: false })).status,
    ).toBe(200);
    expect((await put(owner, { target: 'runtime', key: 'STRIPE_KEY', value: 'sk_live_x', secret: true })).status).toBe(
      200,
    );
    expect(world.secrets.get('loja-aurora')?.get('API_URL')).toBe('https://api.example.com');
    expect(world.secrets.get('loja-aurora')?.get('STRIPE_KEY')).toBe('sk_live_x');

    // Build variables are sealed in bohr; the copy an older version kept in the repository goes
    expect(
      (await put(owner, { target: 'build', key: 'NEXT_PUBLIC_API', value: 'https://api.example.com', secret: false }))
        .status,
    ).toBe(200);
    expect((await put(owner, { target: 'build', key: 'SENTRY_TOKEN', value: 'sntrys_x', secret: true })).status).toBe(
      200,
    );
    expect(world.actionsSecrets.size).toBe(0);
    expect(deletedActionsSecrets).toEqual(['BOHR_BUILD_NEXT_PUBLIC_API', 'BOHR_BUILD_SENTRY_TOKEN']);
    const sealed = await db.select().from(envVars).where(eq(envVars.key, 'SENTRY_TOKEN')).get();
    expect(sealed).toMatchObject({ target: 'build', isSecret: true, value: null });
    expect(sealed?.valueSealed).not.toContain('sntrys_x');
    expect(
      await vault(cloud).open(sealed?.valueSealed ?? '', buildVariableContext('p_loja', '*', 'SENTRY_TOKEN')),
    ).toBe('sntrys_x');
    deletedActionsSecrets.length = 0;

    // Members see the names and the plain values, never the secret ones, and cannot change them
    const listed = (await (await call('/api/projects/p_loja/variables', { headers: member })).json()) as {
      variables: { key: string; target: string; secret: boolean; value: string | null }[];
      canEdit: boolean;
    };
    expect(listed.canEdit).toBe(false);
    expect(listed.variables.map(({ key, target, secret, value }) => ({ key, target, secret, value }))).toEqual([
      { key: 'NEXT_PUBLIC_API', target: 'build', secret: false, value: 'https://api.example.com' },
      { key: 'SENTRY_TOKEN', target: 'build', secret: true, value: null },
      { key: 'API_URL', target: 'runtime', secret: false, value: 'https://api.example.com' },
      { key: 'STRIPE_KEY', target: 'runtime', secret: true, value: null },
    ]);
    expect((await put(member, { target: 'build', key: 'X', value: 'y', secret: false })).status).toBe(403);
    // bohr never keeps the secret value of a project in its owner's account
    expect(await db.select().from(runtimeSecrets).all()).toEqual([]);

    const removed = await call('/api/projects/p_loja/variables?target=build&key=NEXT_PUBLIC_API', {
      method: 'DELETE',
      headers: owner,
    });
    expect(removed.status).toBe(200);
    expect(deletedActionsSecrets).toEqual(['BOHR_BUILD_NEXT_PUBLIC_API']);
    expect((await put(owner, { target: 'build', key: 'CLOUDFLARE_API_TOKEN', value: 'x', secret: true })).status).toBe(
      400,
    );
  });

  it('keeps the v1 path for projects bohr still hosts', async () => {
    const { owner } = await project('managed');
    expect((await put(owner, { target: 'runtime', key: 'STRIPE_KEY', value: 'sk_live_x', secret: true })).status).toBe(
      200,
    );
    expect(
      (await put(owner, { target: 'runtime', key: 'API_URL', value: 'https://api.example.com', secret: false })).status,
    ).toBe(200);
    expect((await db.select().from(runtimeSecrets).all()).map((row) => row.key)).toEqual(['STRIPE_KEY']);
    const rows = await db.select().from(envVars).all();
    expect(rows.find((row) => row.key === 'API_URL')?.value).toBe('https://api.example.com');
    expect(bohr.calls.some((entry) => entry.path.includes('/workers/dispatch/'))).toBe(false);

    // Their build variables are sealed in bohr too (the build plan hands them to the build); the copy an
    // earlier migration kept in the repository goes
    expect((await put(owner, { target: 'build', key: 'API_KEY', value: 'k-build', secret: true })).status).toBe(200);
    expect(world.actionsSecrets.size).toBe(0);
    expect(deletedActionsSecrets).toEqual(['BOHR_BUILD_API_KEY']);
    const build = (await db.select().from(envVars).all()).find((row) => row.key === 'API_KEY');
    expect(build).toMatchObject({ target: 'build', value: null });
    expect(await vault(cloud).open(build?.valueSealed ?? '', buildVariableContext('p_loja', '*', 'API_KEY'))).toBe(
      'k-build',
    );

    const removed = await call('/api/projects/p_loja/variables?target=build&key=API_KEY', {
      method: 'DELETE',
      headers: owner,
    });
    expect(removed.status).toBe(200);
    expect(deletedActionsSecrets).toEqual(['BOHR_BUILD_API_KEY', 'BOHR_BUILD_API_KEY']);
    expect((await db.select().from(envVars).all()).some((row) => row.key === 'API_KEY')).toBe(false);
  });

  it('saves the build variables of a project bohr hosts even when GitHub refuses to delete the old secret', async () => {
    const { owner } = await project('managed');
    failSecretDeletes = true;
    expect((await put(owner, { target: 'build', key: 'API_KEY', value: 'k-build', secret: true })).status).toBe(200);
    const build = (await db.select().from(envVars).all()).find((row) => row.key === 'API_KEY');
    expect(build?.valueSealed).toEqual(expect.any(String));
  });
});

describe('site protection', () => {
  const protect = (headers: Record<string, string>, body: unknown) =>
    call('/api/projects/p_loja/protection', { method: 'PUT', headers, body: JSON.stringify(body) });

  it('puts the hashed users on the production Worker, keeps passwords not resent, and turns off', async () => {
    const { owner, member } = await project('byo');
    world.scripts.set('loja-aurora', { metadata: {}, modules: [] });
    const saved = await protect(owner, {
      type: 'basic',
      users: [{ username: 'cliente', password: 's3nh@' }],
      bypassPaths: ['/health', '/api/public/*'],
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      protection: {
        type: 'basic',
        users: [{ username: 'cliente' }],
        bypassPaths: ['/health', '/api/public/*'],
        warning: null,
      },
    });
    const secret = JSON.parse(world.secrets.get('loja-aurora')?.get('BOHR_SITE_AUTH') ?? '{}') as {
      users: { username: string; hash: string; salt: string; iterations: number }[];
      bypassPaths: string[];
    };
    expect(secret.users[0]).toMatchObject({ username: 'cliente', iterations: 20_000 });
    expect(JSON.stringify(secret)).not.toContain('s3nh@');
    const firstHash = secret.users[0]?.hash;

    // A user listed without a password keeps the one it had; a new user needs one
    expect(
      (await protect(owner, { type: 'basic', users: [{ username: 'cliente' }, { username: 'novo' }] })).status,
    ).toBe(400);
    await protect(owner, { type: 'basic', users: [{ username: 'cliente' }] });
    const kept = JSON.parse(world.secrets.get('loja-aurora')?.get('BOHR_SITE_AUTH') ?? '{}') as {
      users: { hash: string }[];
    };
    expect(kept.users[0]?.hash).toBe(firstHash);

    expect((await protect(member, { type: 'none' })).status).toBe(403);
    expect((await protect(owner, { type: 'none' })).status).toBe(200);
    const view = (await (await call('/api/projects/p_loja/protection', { headers: member })).json()) as {
      protection: { type: string };
      canEdit: boolean;
    };
    expect(view).toEqual({ protection: { type: 'none', users: [], bypassPaths: [], warning: null }, canEdit: false });
  });

  it('warns when the site deploys with its own command, which the gate cannot wrap', async () => {
    const { owner } = await project('byo');
    repoFiles.set(
      '.bohr/deploy.json',
      JSON.stringify({ directory: 'site', deploy: 'npx opennextjs-cloudflare deploy' }),
    );
    const view = (await (await call('/api/projects/p_loja/protection', { headers: owner })).json()) as {
      protection: { warning: string | null };
    };
    expect(view.protection.warning).toBe('custom_deploy');
  });

  it('protects projects bohr hosts through the dispatcher route records', async () => {
    const { owner } = await project('managed');
    await db
      .insert(hostnames)
      .values({ hostname: 'loja.example.com', projectId: 'p_loja', branch: 'main', isProduction: true })
      .run();
    expect((await protect(owner, { type: 'basic', users: [{ username: 'cliente', password: 's3nh@' }] })).status).toBe(
      200,
    );
    const record = JSON.parse((await env.ROUTES.get('loja.example.com')) ?? '{}') as {
      auth: { type: string; users: unknown[] };
    };
    expect(record.auth.type).toBe('basic');
    expect(record.auth.users).toHaveLength(1);
  });
});

describe('custom domains', () => {
  it("attaches domains whose zone is in the owner's account to the production Worker", async () => {
    const { owner, member } = await project('byo');
    const before = (await (await call('/api/projects/p_loja/domains', { headers: owner })).json()) as {
      deployed: boolean;
    };
    expect(before.deployed).toBe(false);

    world.scripts.set('loja-aurora', { metadata: {}, modules: [] });
    world.zones.set('example.com', 'zone-example');
    const add = (hostname: string, headers = owner) =>
      call('/api/projects/p_loja/domains', { method: 'POST', headers, body: JSON.stringify({ hostname }) });
    expect((await add('loja.other.com')).status).toBe(409);
    expect((await add('*.example.com')).status).toBe(400);
    expect((await add('loja.example.com', member)).status).toBe(403);
    const added = await add('Loja.Example.com');
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({
      hosting: 'own',
      deployed: true,
      worker: 'loja-aurora',
      workersDev: 'https://loja-aurora.ana.workers.dev',
      domains: [{ id: 'dom-1', hostname: 'loja.example.com' }],
      zones: [{ name: 'example.com', status: 'active' }],
      canEdit: true,
    });
    expect(world.domains[0]).toMatchObject({
      hostname: 'loja.example.com',
      service: 'loja-aurora',
      zone_id: 'zone-example',
    });

    expect((await call('/api/projects/p_loja/domains/dom-9', { method: 'DELETE', headers: owner })).status).toBe(404);
    expect((await call('/api/projects/p_loja/domains/dom-1', { method: 'DELETE', headers: owner })).status).toBe(200);
    expect(world.domains).toEqual([]);
  });

  it('lists the hostnames of projects bohr hosts, read-only', async () => {
    const { owner } = await project('managed');
    await db
      .insert(hostnames)
      .values({ hostname: 'loja.example.com', projectId: 'p_loja', branch: 'main', isProduction: true, status: 'live' })
      .run();
    const view = await (await call('/api/projects/p_loja/domains', { headers: owner })).json();
    expect(view).toEqual({
      hosting: 'bohr',
      domains: [{ id: 'loja.example.com', hostname: 'loja.example.com', status: 'live' }],
      canEdit: false,
    });
    const add = await call('/api/projects/p_loja/domains', {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ hostname: 'x.example.com' }),
    });
    expect(add.status).toBe(409);
  });
});

describe('builds', () => {
  it('lists the deploy runs, newest first, and shows the failing job log', async () => {
    const { member } = await project('byo');
    const list = (await (await call('/api/projects/p_loja/builds', { headers: member })).json()) as {
      builds: { id: number; title: string; conclusion: string }[];
    };
    expect(list.builds.map((build) => [build.id, build.title, build.conclusion])).toEqual([
      [5, 'Banner', 'failure'],
      [4, 'Botão verde', 'success'],
    ]);
    const detail = (await (await call('/api/projects/p_loja/builds/5', { headers: member })).json()) as {
      jobs: { name: string; steps: { name: string; conclusion: string }[]; log: string }[];
    };
    expect(detail.jobs[0]?.steps[0]).toMatchObject({ name: 'Build', conclusion: 'failure' });
    expect(detail.jobs[0]?.log).toContain('Missing script: "build"');
    expect((await call('/api/projects/p_loja/builds/abc', { headers: member })).status).toBe(400);
  });
});
