import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/client';
import { auditLog, buildPlans, envVars, projects } from '../src/db/schema';
import { adminHeaders, call, importProject, oidcToken, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const SECRET = 'sk_build_secret_value_0123456789';
const PLAN = {
  nodeVersion: '22',
  install: 'npm ci',
  build: 'npm run build',
  files: {
    'wrangler.jsonc': '{ "name": "store", "compatibility_date": "2026-10-01", "assets": { "directory": "dist" } }',
    '.bohr/worker.mjs': 'export default { fetch() { return new Response("hi"); } };\n',
    'lambda-adapter.mjs': 'export const adapt = () => {};\n',
  },
};

let projectId: string;

beforeEach(async () => {
  await resetStorage();
  useFakes();
  const { project } = await importProject();
  projectId = project?.projectId ?? '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

const admin = (path: string, method: string, body?: unknown) =>
  call(`/api/admin/projects/${projectId}${path}`, {
    method,
    headers: adminHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function request(
  repository = 'Acme/store',
  options: { branch?: string; repositoryId?: string; claims?: Record<string, unknown> } = {},
) {
  const token = await oidcToken(repository, options.branch ?? 'main', {
    repositoryId: options.repositoryId ?? '4242',
    claims: { event_name: 'push', ...options.claims },
  });
  const response = await call('/api/deploy/build-plan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('build plan operator API', () => {
  it('saves, reads and deletes the build plan of a project bohr hosts', async () => {
    expect((await admin('/build-plan', 'GET')).status).toBe(404);
    const saved = await admin('/build-plan', 'PUT', PLAN);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true });

    const read = await admin('/build-plan', 'GET');
    expect(await read.json()).toMatchObject({ ...PLAN, updatedAt: expect.any(String) });

    // Replaced as a whole; empty commands are skipped steps
    await admin('/build-plan', 'PUT', { nodeVersion: 'lts/*', install: '', files: {} });
    expect(await (await admin('/build-plan', 'GET')).json()).toMatchObject({
      nodeVersion: 'lts/*',
      install: null,
      build: null,
      files: {},
    });

    expect(await (await admin('/build-plan', 'DELETE')).json()).toEqual({ ok: true });
    expect((await admin('/build-plan', 'GET')).status).toBe(404);
    const actions = (await db.select().from(auditLog).all()).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['build_plan.set', 'build_plan.delete']));

    expect((await call(`/api/admin/projects/${projectId}/build-plan`, { method: 'GET' })).status).toBe(401);
  });

  it('refuses paths outside the repository, workflows and oversized plans', async () => {
    for (const path of [
      '/etc/passwd',
      '../outside.js',
      'a/../../b',
      'a//b',
      './wrangler.jsonc',
      '.github/workflows/evil.yml',
      '.GitHub/x',
      '.git/hooks/pre-commit',
      'C:/x',
      'a\\b',
      '',
    ]) {
      const response = await admin('/build-plan', 'PUT', { ...PLAN, files: { [path]: 'x' } });
      expect(response.status, path).toBe(400);
    }
    const big = await admin('/build-plan', 'PUT', {
      ...PLAN,
      files: { 'a.js': 'x'.repeat(1024 * 1024), 'b.js': 'x'.repeat(1024 * 1024 + 1) },
    });
    expect(big.status).toBe(400);
    expect((await admin('/build-plan', 'PUT', { ...PLAN, nodeVersion: '22; rm -rf /' })).status).toBe(400);
    expect(await db.select().from(buildPlans).all()).toEqual([]);
  });

  it("refuses projects in their owner's account", async () => {
    await db.update(projects).set({ mode: 'byo' }).where(eq(projects.id, projectId)).run();
    expect((await admin('/build-plan', 'PUT', PLAN)).status).toBe(409);
    expect((await admin('/build-variables', 'PUT', { values: { A: 'b' } })).status).toBe(409);
  });

  it('seals build variables, refusing the names bohr and GitHub use', async () => {
    expect((await admin('/build-variables', 'PUT', { values: { API_KEY: SECRET } })).status).toBe(200);
    const row = await db.select().from(envVars).where(eq(envVars.key, 'API_KEY')).get();
    expect(row).toMatchObject({ branch: '*', target: 'build', isSecret: true, value: null });
    expect(row?.valueSealed).not.toContain(SECRET);

    expect((await admin('/build-variables', 'PUT', { values: { GITHUB_TOKEN: 'x' } })).status).toBe(400);
    expect((await admin('/build-variables', 'PUT', { values: { 'A-B': 'x' } })).status).toBe(400);
    expect(
      (
        await call('/api/admin/projects/nope/build-variables', {
          method: 'PUT',
          headers: adminHeaders,
          body: '{"values":{}}',
        })
      ).status,
    ).toBe(404);
  });
});

describe('POST /api/deploy/build-plan', () => {
  beforeEach(async () => {
    await admin('/build-plan', 'PUT', PLAN);
    await admin('/build-variables', 'PUT', { values: { PUBLIC_API: 'https://api.example.com', API_KEY: SECRET } });
    await admin('/build-variables', 'PUT', { branch: 'main', values: { PUBLIC_API: 'https://prod.example.com' } });
    await admin('/build-variables', 'PUT', { branch: 'feature/x', values: { API_KEY: 'feature-key' } });
  });

  it("answers the plan and the pushed branch's build variables", async () => {
    const { response, body } = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      found: true,
      // Production has not moved yet: a failing deploy may still fall back to v1
      live: false,
      ...PLAN,
      buildVariables: { PUBLIC_API: 'https://prod.example.com', API_KEY: SECRET },
    });
    expect(JSON.stringify(body)).not.toContain(env.CF_API_TOKEN);

    // The first run records the repository id of a project imported without one
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    expect(project?.repoId).toBe(4242);

    const audited = await db.select().from(auditLog).where(eq(auditLog.action, 'deploy.build_plan')).get();
    expect(audited).toMatchObject({ actor: 'github-actions:Acme/store#42', target: projectId });
    expect(audited?.metadata).toMatchObject({ repository: 'Acme/store', ref: 'refs/heads/main', runId: '42' });
  });

  it("merges a branch's own variables over the project-wide ones", async () => {
    const feature = await request('Acme/store', { branch: 'feature/x' });
    expect(feature.body.buildVariables).toEqual({ PUBLIC_API: 'https://api.example.com', API_KEY: 'feature-key' });
    const other = await request('Acme/store', { branch: 'other' });
    expect(other.body.buildVariables).toEqual({ PUBLIC_API: 'https://api.example.com', API_KEY: SECRET });
  });

  it('answers 404 { found: false } for repositories without a plan, so bohr v1 takes over', async () => {
    const unknown = await request('someone/else', { repositoryId: '555' });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body).toEqual({ found: false });

    // A namesake: the project's repository has another id
    await request();
    const namesake = await request('Acme/store', { repositoryId: '9999' });
    expect(namesake.response.status).toBe(404);
    expect(namesake.body).toEqual({ found: false });

    // A project in its owner's account never gets one, even with a leftover plan
    await db.update(projects).set({ mode: 'byo' }).where(eq(projects.id, projectId)).run();
    expect((await request()).body).toEqual({ found: false });

    // A project bohr hosts without a plan
    await db.update(projects).set({ mode: 'managed' }).where(eq(projects.id, projectId)).run();
    await admin('/build-plan', 'DELETE');
    const noPlan = await request();
    expect(noPlan.response.status).toBe(404);
    expect(noPlan.body).toEqual({ found: false });

    // Invalid tokens are refused before anything is looked up
    const wrongAudience = await oidcToken('Acme/store', 'main', { audience: 'sts.amazonaws.com' });
    const denied = await call('/api/deploy/build-plan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wrongAudience}` },
    });
    expect(denied.status).toBe(401);
    expect((await call('/api/deploy/build-plan', { method: 'POST' })).status).toBe(401);
  });

  it('refuses suspended projects, pull requests, other events and tags', async () => {
    const refusals = [
      await request('Acme/store', { claims: { event_name: 'pull_request' } }),
      await request('Acme/store', { claims: { event_name: 'pull_request_target' } }),
      await request('Acme/store', { claims: { event_name: 'schedule' } }),
      await request('Acme/store', { claims: { event_name: undefined } }),
      await request('Acme/store', { claims: { ref: 'refs/tags/v1' } }),
    ];
    for (const { response, body } of refusals) {
      expect(response.status).toBe(403);
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
    for (const event of ['workflow_dispatch', 'repository_dispatch']) {
      expect((await request('Acme/store', { claims: { event_name: event } })).response.status).toBe(200);
    }

    await db.update(projects).set({ status: 'suspended' }).where(eq(projects.id, projectId)).run();
    const suspended = await request();
    expect(suspended.response.status).toBe(403);
    expect(suspended.body.error).toContain('suspended');
    expect(JSON.stringify(suspended.body)).not.toContain(SECRET);
  });

  it('never logs or audits build variable values', async () => {
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '));
      });
    }
    await admin('/build-variables', 'PUT', { values: { OTHER: `${SECRET}-2` } });
    await admin('/build-variables', 'PUT', { values: { CLOUDFLARE_API_TOKEN: `${SECRET}-3` } });
    const malformed = await call(`/api/admin/projects/${projectId}/build-variables`, {
      method: 'PUT',
      headers: adminHeaders,
      body: `{ "values": { "BROKEN": ${SECRET} } }`,
    });
    expect(malformed.status).toBe(400);
    await request();
    await request('Acme/store', { claims: { event_name: 'pull_request' } });
    expect(lines.join('\n')).not.toContain(SECRET);
    const audit = JSON.stringify(await db.select().from(auditLog).all());
    expect(audit).toContain('deploy.build_plan');
    expect(audit).toContain('build_variables.set');
    expect(audit).not.toContain(SECRET);
    expect(audit).not.toContain('https://prod.example.com');
  });
});
