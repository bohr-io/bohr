import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeCloudflare } from './fake-cloudflare';
import {
  adminHeaders,
  baseMetadata,
  call,
  finalize,
  importProject,
  oidcToken,
  resetStorage,
  startSession,
  useFakes,
} from './helpers';

let cloudflare: FakeCloudflare;

beforeEach(async () => {
  await resetStorage();
  cloudflare = useFakes();
  cloudflare.zones.set('example.com', 'zone-example');
  cloudflare.routes.set('zone-example', [
    { id: 'v1-apex', pattern: 'store.example.com/*', script: 'bohr-tunnel' },
    { id: 'v1-wild', pattern: '*.example.com/*', script: 'bohr-tunnel' },
  ]);
});

describe('admin import', () => {
  it('creates the project, its members and pending hostnames with route records', async () => {
    const { response, project } = await importProject();
    expect(response.status).toBe(200);
    expect(project?.projectId).toMatch(/^p[a-z0-9]{11}$/);
    expect(project?.scripts.main).toBe(`${project?.projectId}-main`);

    const record = (await env.ROUTES.get('store.example.com', 'json')) as Record<string, unknown>;
    expect(record).toMatchObject({ v: 1, projectId: project?.projectId, script: `${project?.projectId}-main` });
    expect(record.headers).toEqual({ 'X-Frame-Options': 'SAMEORIGIN' });

    // Nothing moved yet: the v1 routes are untouched
    expect(cloudflare.routes.get('zone-example')?.[0]?.script).toBe('bohr-tunnel');
  });

  it('is idempotent', async () => {
    const first = await importProject();
    const second = await importProject();
    expect(second.project?.projectId).toBe(first.project?.projectId);
  });

  it("puts a GitHub organization's repository in its bohr org, with the payer as admin", async () => {
    const org = { githubId: 9001, login: 'Acme', name: 'Acme Inc' };
    const { response, project } = await importProject({ org });
    expect(response.status).toBe(200);
    const db = env.DB;
    const row = await db
      .prepare('SELECT org_id FROM projects WHERE id = ?')
      .bind(project?.projectId)
      .first<{ org_id: string }>();
    const created = await db
      .prepare('SELECT * FROM orgs WHERE github_account_id = 9001')
      .first<Record<string, unknown>>();
    expect(created).toMatchObject({ slug: 'acme', name: 'Acme Inc', github_login: 'Acme' });
    expect(row?.org_id).toBe(created?.id);
    const members = await db
      .prepare('SELECT github_login, role, status FROM org_members WHERE org_id = ? ORDER BY github_login')
      .bind(created?.id)
      .all<Record<string, unknown>>();
    expect(members.results).toEqual([
      { github_login: 'alice', role: 'admin', status: 'active' },
      { github_login: 'bob', role: 'member', status: 'active' },
    ]);
    // Another repository of the same organization joins the same org
    const second = await importProject({ repoName: 'site', org, hostnames: [] });
    const secondOrg = await db
      .prepare('SELECT org_id FROM projects WHERE id = ?')
      .bind(second.project?.projectId)
      .first<{ org_id: string }>();
    expect(secondOrg?.org_id).toBe(created?.id);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM orgs').first<{ n: number }>())?.n).toBe(1);
  });

  it('imports a v1 organization with its admins and members, without projects', async () => {
    const response = await call('/api/admin/orgs', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orgs: [
          {
            githubId: 7001,
            login: 'blueshift-cc',
            name: 'Blueshift',
            installationId: 555,
            admins: [
              { githubId: 1001, login: 'alice' },
              { githubId: 1003, login: 'carol' },
            ],
            members: [{ githubId: 1002, login: 'bob' }],
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const org = await env.DB.prepare("SELECT * FROM orgs WHERE slug = 'blueshift-cc'").first<Record<string, unknown>>();
    expect(org).toMatchObject({ name: 'Blueshift', installation_id: 555 });
    const members = await env.DB.prepare(
      'SELECT github_login, role FROM org_members WHERE org_id = ? ORDER BY github_login',
    )
      .bind(org?.id)
      .all<Record<string, unknown>>();
    expect(members.results).toEqual([
      { github_login: 'alice', role: 'admin' },
      { github_login: 'bob', role: 'member' },
      { github_login: 'carol', role: 'admin' },
    ]);
  });

  it('leaves a repository its owner already brought to their own Cloudflare account', async () => {
    const { project } = await importProject();
    await env.DB.prepare("UPDATE projects SET mode = 'byo' WHERE id = ?").bind(project?.projectId).run();
    expect((await importProject()).response.status).toBe(409);
  });

  it('lists every project, beyond the 100 parameters D1 binds', async () => {
    const { project } = await importProject();
    await env.DB.prepare("INSERT INTO users (id, name) VALUES ('u_bulk', 'Bulk')").run();
    await env.DB.batch(
      Array.from({ length: 120 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO projects (id, owner_user_id, name, repo_owner, repo_name, repo_key, production_branch, mode, status, created_at, updated_at) VALUES (?, 'u_bulk', ?, 'bulk', ?, ?, 'main', 'managed', 'migrating', 0, 0)",
        ).bind(`pbulk${i}`, `site${i}`, `site${i}`, `bulk/site${i}`),
      ),
    );
    const response = await call('/api/admin/projects', { headers: adminHeaders });
    expect(response.status).toBe(200);
    const list = (await response.json()) as { projects: { id: string; hostnames: unknown[] }[] };
    expect(list.projects).toHaveLength(121);
    expect(list.projects.find((p) => p.id === project?.projectId)?.hostnames).toHaveLength(2);
  });

  it('refuses secret values sent in plain text and requests without the admin token', async () => {
    const { response } = await importProject({
      envVars: [{ key: 'TOKEN', target: 'runtime', isSecret: true, value: 'leak' }],
    });
    expect(response.status).toBe(400);

    const denied = await call('/api/admin/projects', { headers: { Authorization: 'Bearer wrong' } });
    expect(denied.status).toBe(401);
  });
});

describe('deploy sessions', () => {
  it('ties the project to its repository id on the first deploy, then refuses a namesake', async () => {
    await importProject();
    const open = async (repositoryId: string) =>
      call('/api/deploy/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await oidcToken('acme/store', 'main', { repositoryId })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest: {}, assetsConfig: {} }),
      });
    expect((await open('4242')).status).toBe(200);
    const stored = await env.DB.prepare("SELECT repo_id FROM projects WHERE repo_key = 'acme/store'").first<{
      repo_id: number;
    }>();
    expect(stored?.repo_id).toBe(4242);

    // The repository was deleted and someone created another one with the same name
    const namesake = await open('9999');
    expect(namesake.status).toBe(403);
    expect(await namesake.json()).toMatchObject({ error: expect.stringContaining('not the repository') });
    expect((await open('4242')).status).toBe(200);
  });

  it('rejects tokens with another audience, unknown repositories and tags', async () => {
    await importProject();
    const wrongAudience = await oidcToken('Acme/store', 'main', { audience: 'sts.amazonaws.com' });
    const denied = await call('/api/deploy/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wrongAudience}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(401);

    const unknown = await startSession('someone/else', 'main');
    expect(unknown.response.status).toBe(404);
  });

  it('opens an assets session, deploys, records the bundle and keeps imported hostnames pending', async () => {
    const { project } = await importProject();
    const manifest = { '/index.html': { hash: 'a'.repeat(32), size: 12 } };
    const session = await startSession('acme/STORE', 'main', manifest, {
      notFoundHandling: 'single-page-application',
      redirects: '/old /new 301',
      headers: '/*\n  X-Robots-Tag: noindex',
    });
    expect(session.response.status).toBe(200);
    expect(session.body).toMatchObject({ accountId: 'acc', uploadToken: `upload-${project?.projectId}-main` });
    expect(session.body.buckets).toEqual([['a'.repeat(32)]]);

    const { response, body } = await finalize(session.token, String(session.body.sessionId), {
      ...baseMetadata,
      assetsCompletionToken: 'completion-jwt',
    });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ script: `${project?.projectId}-main`, url: 'https://store.example.com' });

    const uploaded = cloudflare.scripts.get(`${project?.projectId}-main`);
    expect(uploaded?.metadata).toMatchObject({
      main_module: 'index.js',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        jwt: 'completion-jwt',
        config: {
          not_found_handling: 'single-page-application',
          _redirects: '/old /new 301',
          _headers: '/*\n  X-Robots-Tag: noindex',
        },
      },
    });
    const bindings = uploaded?.metadata.bindings as { type: string; name: string; text?: string }[];
    // Project settings override the wrangler config
    expect(bindings).toContainEqual({ type: 'plain_text', name: 'PUBLIC_API', text: 'https://api.example.com' });
    expect(bindings).toContainEqual({ type: 'plain_text', name: 'FROM_CONFIG', text: 'yes' });
    expect(bindings).toContainEqual({ type: 'assets', name: 'ASSETS' });

    const stored = await env.BUNDLES.get(`deploys/${project?.projectId}/${body.deploymentId}/metadata.json`);
    expect(stored).not.toBeNull();
    expect(JSON.stringify(await stored?.json())).not.toContain('completion-jwt');
    expect(await env.BUNDLES.get(`deploys/${project?.projectId}/${body.deploymentId}/manifest.json`)).not.toBeNull();

    // Imported hostnames wait for the cutover
    expect(cloudflare.routes.get('zone-example')?.find((r) => r.id === 'v1-apex')?.script).toBe('bohr-tunnel');
  });

  it('gives a new branch a bohr.io hostname that goes live immediately', async () => {
    const { project } = await importProject();
    const session = await startSession('Acme/store', 'feature/Login UI');
    const { response, body } = await finalize(session.token, String(session.body.sessionId), baseMetadata);
    expect(response.status).toBe(200);
    expect(body.url).toBe('https://feature-login-ui-store-acme.bohr.io');
    expect(cloudflare.routes.get('zone-bohr')).toContainEqual(
      expect.objectContaining({ pattern: 'feature-login-ui-store-acme.bohr.io/*', script: 'bohr-dispatcher' }),
    );
    const record = (await env.ROUTES.get('feature-login-ui-store-acme.bohr.io', 'json')) as { script: string };
    expect(record.script).toBe(`${project?.projectId}-feature-login-ui`);
  });

  it('serves assets-only projects through a generated module', async () => {
    const { project } = await importProject();
    cloudflare.storedAssets.add('b'.repeat(32));
    const session = await startSession('Acme/store', 'main', { '/index.html': { hash: 'b'.repeat(32), size: 3 } });
    expect(session.body.buckets).toEqual([]);
    const { response } = await finalize(
      session.token,
      String(session.body.sessionId),
      { ...baseMetadata, mainModule: null, assetsCompletionToken: String(session.body.uploadToken) },
      {},
    );
    expect(response.status).toBe(200);
    const uploaded = cloudflare.scripts.get(`${project?.projectId}-main`);
    expect(uploaded?.metadata.main_module).toBe('bohr-assets-only.js');
    expect(uploaded?.modules['bohr-assets-only.js']?.text).toContain('env.ASSETS.fetch');
  });

  it('refuses a session used by another branch and a missing completion token', async () => {
    await importProject();
    const session = await startSession('Acme/store', 'main', { '/a.txt': { hash: 'c'.repeat(32), size: 1 } });
    const otherBranch = await oidcToken('Acme/store', 'dev');
    const stolen = await finalize(otherBranch, String(session.body.sessionId), baseMetadata);
    expect(stolen.response.status).toBe(403);

    const missingToken = await finalize(session.token, String(session.body.sessionId), baseMetadata);
    expect(missingToken.response.status).toBe(400);
  });
});

describe('secrets', () => {
  it('stores secrets encrypted, binds them on deploy and updates deployed scripts', async () => {
    const { project } = await importProject();
    const set = await call(`/api/admin/projects/${project?.projectId}/secrets`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'STRIPE_KEY', value: 'sk_test_123' }),
    });
    expect(set.status).toBe(200);

    const row = await env.DB.prepare('SELECT ciphertext FROM runtime_secrets WHERE key = ?').bind('STRIPE_KEY').first<{
      ciphertext: string;
    }>();
    expect(row?.ciphertext).toMatch(/^v2\.k1\./);
    expect(row?.ciphertext).not.toContain('sk_test_123');

    const session = await startSession('Acme/store', 'main');
    await finalize(session.token, String(session.body.sessionId), baseMetadata);
    const bindings = cloudflare.scripts.get(`${project?.projectId}-main`)?.metadata.bindings as {
      type: string;
      name: string;
      text?: string;
    }[];
    expect(bindings).toContainEqual({ type: 'secret_text', name: 'STRIPE_KEY', text: 'sk_test_123' });

    await call(`/api/admin/projects/${project?.projectId}/secrets`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'STRIPE_KEY', value: 'sk_test_456' }),
    });
    expect(cloudflare.secrets.get(`${project?.projectId}-main`)?.get('STRIPE_KEY')).toBe('sk_test_456');
  });
});

describe('cutover', () => {
  it('requires a deploy, then points routes at the dispatcher and can be rolled back', async () => {
    const { project } = await importProject();
    const early = await call(`/api/admin/projects/${project?.projectId}/cutover`, {
      method: 'POST',
      headers: adminHeaders,
      body: '{}',
    });
    expect(early.status).toBe(409);

    const session = await startSession('Acme/store', 'main');
    await finalize(session.token, String(session.body.sessionId), baseMetadata);

    const cutover = await call(`/api/admin/projects/${project?.projectId}/cutover`, {
      method: 'POST',
      headers: adminHeaders,
      body: '{}',
    });
    expect(cutover.status).toBe(200);
    expect(cloudflare.routes.get('zone-example')?.find((r) => r.id === 'v1-apex')?.script).toBe('bohr-dispatcher');
    // The zone-wide wildcard still serves the customer's other v1 sites
    expect(cloudflare.routes.get('zone-example')?.find((r) => r.id === 'v1-wild')?.script).toBe('bohr-tunnel');
    expect(cloudflare.routes.get('zone-bohr')).toContainEqual(
      expect.objectContaining({ pattern: 'store-acme.bohr.io/*', script: 'bohr-dispatcher' }),
    );
    const list = (await (await call('/api/admin/projects', { headers: adminHeaders })).json()) as {
      projects: { id: string; status: string; migration: string }[];
    };
    expect(list.projects.find((p) => p.id === project?.projectId)).toMatchObject({
      status: 'active',
      migration: 'live',
    });

    const rollback = await call(`/api/admin/projects/${project?.projectId}/rollback-cutover`, {
      method: 'POST',
      headers: adminHeaders,
      body: '{}',
    });
    expect(rollback.status).toBe(200);
    expect(cloudflare.routes.get('zone-example')?.find((r) => r.id === 'v1-apex')?.script).toBe('bohr-tunnel');
    expect(cloudflare.routes.get('zone-bohr')?.some((r) => r.pattern === 'store-acme.bohr.io/*')).toBe(false);
  });

  it("moves a preview branch's v1 address on its first deploy once production moved", async () => {
    const { project } = await importProject({
      hostnames: [
        { hostname: 'store.example.com', branch: 'main', isProduction: true, zoneId: 'zone-example' },
        { hostname: 'dev-store-acme.bohr.io', branch: 'dev', isProduction: false, zoneId: 'zone-bohr' },
      ],
    });
    const main = await startSession('Acme/store', 'main');
    await finalize(main.token, String(main.body.sessionId), baseMetadata);
    await call(`/api/admin/projects/${project?.projectId}/cutover`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ hostnames: ['store.example.com'] }),
    });
    expect((cloudflare.routes.get('zone-bohr') ?? []).some((r) => r.pattern === 'dev-store-acme.bohr.io/*')).toBe(
      false,
    );
    const dev = await startSession('Acme/store', 'dev');
    await finalize(dev.token, String(dev.body.sessionId), baseMetadata);
    expect(cloudflare.routes.get('zone-bohr')).toContainEqual(
      expect.objectContaining({ pattern: 'dev-store-acme.bohr.io/*', script: 'bohr-dispatcher' }),
    );
  });

  it('suspends a project through its route records', async () => {
    const { project } = await importProject();
    await call(`/api/admin/projects/${project?.projectId}/status`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'suspended' }),
    });
    const record = (await env.ROUTES.get('store.example.com', 'json')) as { suspended: boolean };
    expect(record.suspended).toBe(true);
    const session = await startSession('Acme/store', 'main');
    expect(session.response.status).toBe(403);
  });
});
