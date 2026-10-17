import { env } from 'cloudflare:workers';
import { TEMPLATE_DATABASE_PLACEHOLDER } from '@bohr/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  auditLog,
  envVars,
  githubInstallations,
  identities,
  instanceSettings,
  orgMembers,
  orgs,
  projects,
  sessions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { saveGithubApp } from '../src/services/github-app';
import { DEFAULT_RUNTIME_IMAGE } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import { rewriteWranglerConfig } from '../src/services/templates';
import type { ProvisionParams } from '../src/workflows/provision';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const IMAGE = `registry.cloudflare.com/acc-user/bohr-agent@sha256:${'c'.repeat(64)}`;
const CF_TOKEN = 'cf-user-token-0123456789abcdefghijklmnop';
const selfHosted = {
  ...env,
  APP_URL: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  CF_API_TOKEN: undefined,
  CF_ACCOUNT_ID: undefined,
};
const call = (path: string, init: RequestInit = {}) => app.request(path, init, selfHosted);

// The menu template as bohr-io/template-menu has it: a Worker with assets and a D1 database
const TEMPLATE_WRANGLER = `// The digital menu: a Worker, its static assets and a D1 database
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "template-menu",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "./public" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "template-menu-db",
      "database_id": "${TEMPLATE_DATABASE_PLACEHOLDER}", // bohr creates the database
      "migrations_dir": "migrations"
    }
  ]
}
`;

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

/** A user signed in with GitHub, a session, and (unless said otherwise) the App installed on their account. */
async function person(id: string, login: string, githubId: number, options: { installation?: number } = {}) {
  await db.insert(users).values({ id, name: login }).run();
  await db
    .insert(identities)
    .values({ id: `i_${id}`, userId: id, provider: 'github', providerUserId: String(githubId), username: login })
    .run();
  if (options.installation !== undefined) {
    await db
      .insert(githubInstallations)
      .values({ id: options.installation, accountLogin: login, accountType: 'User', userId: id })
      .run();
  }
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { Cookie: `__Host-bohr_session=${token}`, 'Content-Type': 'application/json' };
}

async function connectCloudflare(headers: Record<string, string>) {
  const connected = await call('/api/onboarding/cloudflare', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: CF_TOKEN }),
  });
  expect(await connected.json()).toMatchObject({ status: 'connected' });
}

/** POST /api/templates/projects, then GitHub's authorization coming back to the callback. */
async function createFromTemplate(headers: Record<string, string>, body: Record<string, unknown>) {
  const started = await call('/api/templates/projects', { method: 'POST', headers, body: JSON.stringify(body) });
  if (started.status !== 200) return { started, callback: null };
  const { url } = (await started.json()) as { url: string };
  const authorize = new URL(url);
  const cookie = /__Host-bohr_oauth=([^;]+)/.exec(started.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  const callback = await call(`/auth/github/callback?code=oauth-code&state=${authorize.searchParams.get('state')}`, {
    headers: { Cookie: `${headers.Cookie}; __Host-bohr_oauth=${cookie}` },
  });
  return { started, authorize, cookie: decodeURIComponent(cookie), callback };
}

const location = (response: Response | null) => new URL(response?.headers.get('Location') ?? '', 'https://x');

beforeEach(async () => {
  await resetStorage();
  useFakes();
  world = new FakeWorld();
  deps.fetch = world.fetch;
  deps.sleep = async () => {};
  provisioning = [];
  deps.startProvisioning = async (_env, params) => {
    provisioning.push(params);
  };
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
  world.githubProfile = { id: 5001, login: 'ana', name: 'Ana', email: null };
  world.repoFiles.set('wrangler.jsonc', TEMPLATE_WRANGLER);
  world.repoFiles.set('.bohr/deploy.json', JSON.stringify({ install: 'npm ci', build: 'npm run build' }));
});

describe('new projects from a template', () => {
  it('lists the templates to signed-in users', async () => {
    expect((await call('/api/templates')).status).toBe(401);
    const headers = await person('u_ana', 'ana', 5001);
    const { templates } = (await (await call('/api/templates', { headers })).json()) as {
      templates: { slug: string; repository: string; locales: Record<string, { name: string }> }[];
    };
    expect(templates.map((template) => template.slug)).toContain('menu');
    expect(templates.find((template) => template.slug === 'menu')).toMatchObject({
      repository: 'bohr-io/template-menu',
      locales: { 'pt-BR': { name: 'Cardápio digital' } },
    });
  });

  it('creates the repository, its database and the project, which deploys with the admin password', async () => {
    const headers = await person('u_ana', 'ana', 5001, { installation: 55 });
    await connectCloudflare(headers);

    const { started, authorize, cookie, callback } = await createFromTemplate(headers, {
      template: 'menu',
      name: 'Cardapio',
      private: true,
      locale: 'pt-BR',
    });
    expect(started.status).toBe(200);
    // GitHub's user authorization with the App's client and its registered callback; the request stays here
    expect(authorize?.origin + (authorize?.pathname ?? '')).toBe('https://github.com/login/oauth/authorize');
    expect(authorize?.searchParams.get('client_id')).toBe('Iv1.ana');
    expect(authorize?.searchParams.get('redirect_uri')).toBe('https://bohr.ana.workers.dev/auth/github/callback');
    expect(authorize?.toString()).not.toContain('Cardapio');
    expect(cookie).toBe(`${authorize?.searchParams.get('state')}|/projects/new?template=menu|template`);

    expect(callback?.status).toBe(302);
    const back = location(callback);
    expect(back.pathname).toBe('/projects/new');
    expect(back.searchParams.get('template')).toBe('menu');
    const projectId = back.searchParams.get('project') ?? '';
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    expect(project).toMatchObject({
      name: 'Cardapio',
      repoOwner: 'ana',
      repoName: 'Cardapio',
      repoId: 7000,
      productionBranch: 'main',
      mode: 'byo',
      orgId: null,
    });
    // Provisioned like a project from a repository
    expect(provisioning).toEqual([{ projectId, userId: 'u_ana', locale: 'pt-BR' }]);

    // The repository: generated by the user, then given to the App's installation (limited to selected ones)
    expect(world.generated.get('ana/Cardapio')).toMatchObject({ template: 'bohr-io/template-menu', private: true });
    const generate = world.calls.find((entry) => entry.url.pathname === '/repos/bohr-io/template-menu/generate');
    expect(generate?.headers.get('authorization')).toBe('Bearer ghu_user_token');
    expect(JSON.parse(generate?.body ?? '{}')).toMatchObject({
      owner: 'ana',
      name: 'Cardapio',
      private: true,
      include_all_branches: false,
    });
    expect(world.installationAdds).toEqual([{ installationId: 55, repositoryId: 7000 }]);

    // The database, and the Worker bohr deploys to: the project's slug
    expect(world.d1Databases).toEqual([{ uuid: expect.any(String), name: 'cardapio-db' }]);
    const databaseId = world.d1Databases[0]?.uuid;
    expect(world.scripts.get('cardapio')?.metadata).toMatchObject({ main_module: 'placeholder.mjs' });
    const password = world.secrets.get('cardapio')?.get('ADMIN_PASSWORD') ?? '';
    expect(password.length).toBeGreaterThanOrEqual(20);
    const variable = await db.select().from(envVars).where(eq(envVars.projectId, projectId)).get();
    expect(variable).toMatchObject({ key: 'ADMIN_PASSWORD', target: 'runtime', isSecret: true, value: null });

    // The setup commits on production, the workflow last: its push deploys the configured project
    expect(world.commits.map((commit) => [commit.repository, commit.path, commit.message, commit.branch])).toEqual([
      ['ana/Cardapio', 'wrangler.jsonc', 'bohr: set up the project', 'main'],
      ['ana/Cardapio', '.github/workflows/bohr-deploy.yml', 'bohr: deploy workflow from .bohr/deploy.json', 'main'],
    ]);
    const wrangler = world.commits[0]?.content ?? '';
    expect(wrangler).toContain('// The digital menu');
    expect(wrangler).toContain('"name": "cardapio"');
    expect(wrangler).toContain(`"database_id": "${databaseId}", // bohr creates the database`);
    expect(wrangler).toContain('"database_name": "cardapio-db"');
    const workflow = world.commits[1]?.content ?? '';
    const steps = [...workflow.matchAll(/^ {6}- (?:name|uses): (.+)$/gm)].map((match) => match[1]);
    expect(steps).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'Build variables',
      'bohr credentials',
      'Install',
      'Build',
      'D1 migrations',
      'Deploy',
    ]);
    expect(workflow).toContain('instance-url: "https://bohr.ana.workers.dev"');

    // The admin password, once, with the address the deploy publishes
    const reveal = () =>
      call('/api/templates/password', { method: 'POST', headers, body: JSON.stringify({ projectId }) });
    const first = await reveal();
    expect(await first.json()).toEqual({ password, url: 'https://cardapio.ana.workers.dev' });
    expect((await reveal()).status).toBe(404);

    // The user's token was used in that request and kept nowhere
    const settings = await db.select().from(instanceSettings).all();
    const audit = await db.select().from(auditLog).all();
    expect(JSON.stringify([settings, audit])).not.toContain('ghu_user_token');
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['project.create', 'project.template']));
  });

  it("creates an organization's project in its account, on an installation that reaches every repository", async () => {
    const headers = await person('u_ana', 'ana', 5001, { installation: 55 });
    // GitHub answers 409 (empty repository) twice while it copies the template: the wait goes on
    world.branchDelay = 2;
    await db
      .insert(githubInstallations)
      .values({ id: 66, accountLogin: 'acme', accountType: 'Organization', userId: null })
      .run();
    world.installations.set(66, { login: 'acme', type: 'Organization', selection: 'all', repos: [] });
    await db
      .insert(orgs)
      .values({
        id: 'o_acme',
        slug: 'acme',
        name: 'Acme Inc',
        githubAccountId: 7001,
        githubLogin: 'acme',
        installationId: 66,
      })
      .run();
    await db
      .insert(orgMembers)
      .values({
        orgId: 'o_acme',
        githubUserId: 5001,
        githubLogin: 'ana',
        userId: 'u_ana',
        role: 'admin',
        status: 'active',
        source: 'github',
      })
      .run();
    // The personal account has no Cloudflare connection: the organization's is used
    expect(
      (await call('/api/orgs/acme/cloudflare', { method: 'POST', headers, body: JSON.stringify({ token: CF_TOKEN }) }))
        .status,
    ).toBe(200);

    const { callback } = await createFromTemplate(headers, {
      template: 'menu',
      name: 'menu',
      org: 'acme',
      private: false,
    });
    const back = location(callback);
    expect(back.searchParams.get('org')).toBe('acme');
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, back.searchParams.get('project') ?? ''))
      .get();
    expect(project).toMatchObject({ repoOwner: 'acme', repoName: 'menu', orgId: 'o_acme' });
    expect(world.generated.get('acme/menu')?.private).toBe(false);
    expect(world.installationAdds).toEqual([]);
    expect(world.d1Databases.map((database) => database.name)).toEqual(['menu-db']);
  });

  it('asks for D1: Edit before creating anything', async () => {
    const headers = await person('u_ana', 'ana', 5001, { installation: 55 });
    await connectCloudflare(headers);
    world.deniedCapabilities.add('d1');

    const { started } = await createFromTemplate(headers, { template: 'menu', name: 'Cardapio', private: true });
    expect(started.status).toBe(403);
    const body = (await started.json()) as { error: string; code: string };
    expect(body.code).toBe('d1_permission');
    expect(body.error).toContain('"D1: Edit"');
    expect(await db.select().from(instanceSettings).all()).not.toContainEqual(
      expect.objectContaining({ key: expect.stringMatching(/^template_request:/) }),
    );

    // The permission went away while the user was on GitHub: still nothing is created
    world.deniedCapabilities.delete('d1');
    const started2 = await call('/api/templates/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ template: 'menu', name: 'Cardapio', private: true }),
    });
    const state = new URL(((await started2.json()) as { url: string }).url).searchParams.get('state');
    const cookie = /__Host-bohr_oauth=([^;]+)/.exec(started2.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
    world.deniedCapabilities.add('d1');
    const callback = await call(`/auth/github/callback?code=oauth-code&state=${state}`, {
      headers: { Cookie: `${headers.Cookie}; __Host-bohr_oauth=${cookie}` },
    });
    const back = location(callback);
    expect(back.pathname).toBe('/projects/new');
    expect(back.searchParams.get('template')).toBe('menu');
    expect(back.searchParams.get('code')).toBe('d1_permission');
    expect(world.generated.size).toBe(0);
    expect(await db.select().from(projects).all()).toEqual([]);
  });

  it('undoes the database, the Worker and the project when the setup fails, and says the repository stays', async () => {
    const headers = await person('u_ana', 'ana', 5001, { installation: 55 });
    await connectCloudflare(headers);
    world.repoFiles.delete('wrangler.jsonc');

    const { callback } = await createFromTemplate(headers, { template: 'menu', name: 'Cardapio', private: true });
    const error = location(callback).searchParams.get('error') ?? '';
    expect(error).toContain('The template has no wrangler.jsonc');
    expect(error).toContain('The repository ana/Cardapio was created on GitHub and stays there');
    expect(world.generated.has('ana/Cardapio')).toBe(true);
    expect(world.d1Databases).toEqual([]);
    expect(world.scripts.has('cardapio')).toBe(false);
    expect(await db.select().from(projects).all()).toEqual([]);
    expect(await db.select().from(envVars).all()).toEqual([]);
    expect(provisioning).toEqual([]);
  });

  it('refuses names the repository owner or the Cloudflare account already use', async () => {
    const headers = await person('u_ana', 'ana', 5001, { installation: 55 });
    await connectCloudflare(headers);
    world.scripts.set('loja', { metadata: {}, modules: [] });
    const taken = await createFromTemplate(headers, { template: 'menu', name: 'Loja', private: true });
    expect(taken.started.status).toBe(409);
    expect(((await taken.started.json()) as { error: string }).error).toContain('a Worker named loja');

    world.d1Databases.push({ uuid: 'd1-old', name: 'menu-db' });
    const database = await createFromTemplate(headers, { template: 'menu', name: 'menu', private: true });
    expect(database.started.status).toBe(409);

    // GitHub refuses a repository name the account already has
    world.generated.set('ana/site', { id: 1, template: 'other', private: true, description: null });
    const { callback } = await createFromTemplate(headers, { template: 'menu', name: 'site', private: true });
    expect(location(callback).searchParams.get('error')).toContain('A repository with this name may already exist');
    expect(world.d1Databases.map((entry) => entry.uuid)).toEqual(['d1-old']);

    for (const name of ['..', 'a b', 'x/y', '']) {
      const invalid = await call('/api/templates/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ template: 'menu', name, private: true }),
      });
      expect(invalid.status, name).toBe(400);
    }
    const unknown = await createFromTemplate(headers, { template: 'nope', name: 'x', private: true });
    expect(unknown.started.status).toBe(404);
  });

  it('finishes a request only for the user who made it, once, with their own GitHub account', async () => {
    const ana = await person('u_ana', 'ana', 5001, { installation: 55 });
    const bob = await person('u_bob', 'bob', 5002);
    await connectCloudflare(ana);
    const started = await call('/api/templates/projects', {
      method: 'POST',
      headers: ana,
      body: JSON.stringify({ template: 'menu', name: 'Cardapio', private: true }),
    });
    const state = new URL(((await started.json()) as { url: string }).url).searchParams.get('state');
    const cookie = /__Host-bohr_oauth=([^;]+)/.exec(started.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
    const finish = (who: Record<string, string>) =>
      call(`/auth/github/callback?code=oauth-code&state=${state}`, {
        headers: { Cookie: `${who.Cookie}; __Host-bohr_oauth=${cookie}` },
      });

    expect(location(await finish(bob)).searchParams.get('error')).toBe('The request expired; please try again.');
    // GitHub authorized another account than the one linked to ana's bohr account
    world.githubProfile = { id: 9999, login: 'mallory', name: null, email: null };
    expect(location(await finish(ana)).searchParams.get('error')).toContain('GitHub authorized mallory');
    // Each request works once
    world.githubProfile = { id: 5001, login: 'ana', name: 'Ana', email: null };
    expect(location(await finish(ana)).searchParams.get('error')).toBe('The request expired; please try again.');
    expect(world.generated.size).toBe(0);
  });
});

describe('wrangler config of a new project', () => {
  it('keeps the comments while it sets the name and the database', () => {
    const out = rewriteWranglerConfig(TEMPLATE_WRANGLER, {
      name: 'loja',
      database: { uuid: 'db-1', name: 'loja-db' },
    });
    expect(out).toBe(
      TEMPLATE_WRANGLER.replace('"template-menu"', '"loja"')
        .replace('"template-menu-db"', '"loja-db"')
        .replace(`"${TEMPLATE_DATABASE_PLACEHOLDER}"`, '"db-1"'),
    );
    // Without a database only the name changes
    expect(rewriteWranglerConfig('{ "name": "x", "main": "a.ts" }', { name: 'y', database: null })).toBe(
      '{ "name": "y", "main": "a.ts" }',
    );
  });

  it('writes the config again when a replacement would hit another key first', () => {
    const text = '// header\n{ "vars": { "name": "site" }, "name": "site" }\n';
    const out = rewriteWranglerConfig(text, { name: 'loja', database: null });
    expect(out.startsWith('// header\n')).toBe(true);
    expect(JSON.parse(out.replace('// header\n', ''))).toEqual({ vars: { name: 'site' }, name: 'loja' });
    expect(() => rewriteWranglerConfig('{ "name": "x" }', { name: 'y', database: { uuid: 'u', name: 'n' } })).toThrow(
      'no D1 database',
    );
  });
});
