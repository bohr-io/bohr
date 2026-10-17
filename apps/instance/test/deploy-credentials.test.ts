import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { auditLog, cfConnections, envVars, orgs, projects, runtimes, users } from '../src/db/schema';
import { randomId } from '../src/lib/crypto';
import { vault } from '../src/lib/vault';
import { cfTokenContext } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import { buildVariableContext } from '../src/services/variables';
import { call, oidcToken, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const USER_TOKEN = 'cf-user-token-0123456789abcdefghijklmnop';
const ORG_TOKEN = 'cf-org-token-0123456789abcdefghijklmnopq';
const WORKFLOW = '.github/workflows/bohr-deploy.yml';

beforeEach(async () => {
  await resetStorage();
  useFakes();
  await db
    .insert(users)
    .values([
      { id: 'u_ana', name: 'Ana' },
      { id: 'u_bruno', name: 'Bruno' },
    ])
    .run();
});

async function connection(id: string, token: string, owner: { userId: string; orgId?: string }, accountId: string) {
  await db
    .insert(cfConnections)
    .values({
      id,
      userId: owner.userId,
      orgId: owner.orgId ?? null,
      accountId,
      tokenSealed: await vault(env).seal(token, cfTokenContext(id)),
    })
    .run();
}

async function project(options: {
  id?: string;
  repo?: string;
  repoId?: number | null;
  mode?: 'byo' | 'managed';
  orgId?: string;
  productionBranch?: string;
  cfConnectionId?: string | null;
  runtime?: boolean;
}) {
  const id = options.id ?? 'p_loja';
  const [owner = 'ana', name = 'loja'] = (options.repo ?? 'ana/loja').split('/');
  await db
    .insert(projects)
    .values({
      id,
      ownerUserId: 'u_ana',
      name,
      repoOwner: owner,
      repoName: name,
      repoKey: `${owner}/${name}`.toLowerCase(),
      repoId: options.repoId === undefined ? 901 : options.repoId,
      productionBranch: options.productionBranch ?? 'main',
      mode: options.mode ?? 'byo',
      orgId: options.orgId ?? null,
    })
    .run();
  if (options.runtime !== false) {
    await db
      .insert(runtimes)
      .values({
        projectId: id,
        cfConnectionId: options.cfConnectionId === undefined ? 'cf_ana' : options.cfConnectionId,
        accountId: options.cfConnectionId === null ? 'acc' : 'acc-user',
        script: `bohr-${name}-x1`,
        previewScript: `bohr-${name}-preview-x1`,
        projectSecretSealed: 'x',
        status: 'ready',
      })
      .run();
  }
}

async function buildVariable(projectId: string, branch: string, key: string, value: string, secret = true) {
  await db
    .insert(envVars)
    .values({
      id: randomId('v_', 16),
      projectId,
      branch,
      key,
      target: 'build',
      isSecret: secret,
      value: secret ? null : value,
      valueSealed: await vault(env).seal(value, buildVariableContext(projectId, branch, key)),
    })
    .run();
}

/** A run of the production deploy workflow, unless the claims say otherwise. */
async function request(
  repository = 'ana/loja',
  options: { branch?: string; claims?: Record<string, unknown>; repositoryId?: string } = {},
) {
  const branch = options.branch ?? 'main';
  const token = await oidcToken(repository, branch, {
    repositoryId: options.repositoryId ?? '901',
    claims: {
      event_name: 'push',
      job_workflow_ref: `${repository}/${WORKFLOW}@refs/heads/${branch}`,
      ...options.claims,
    },
  });
  const response = await call('/api/deploy/credentials', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('deploy credentials', () => {
  it("hands a personal project's run the owner's token, account and production build variables", async () => {
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    await project({});
    await buildVariable('p_loja', '*', 'NEXT_PUBLIC_API', 'https://api.example.com', false);
    await buildVariable('p_loja', '*', 'SENTRY_TOKEN', 'all-branches');
    await buildVariable('p_loja', 'main', 'SENTRY_TOKEN', 'production');
    await buildVariable('p_loja', 'feature', 'ONLY_FEATURE', 'no');
    // An older build variable, whose value is still an Actions secret
    await db
      .insert(envVars)
      .values({ id: 'v_old', projectId: 'p_loja', key: 'OLD', target: 'build', isSecret: true, value: null })
      .run();
    // Site variables never reach the build
    await db
      .insert(envVars)
      .values({ id: 'v_site', projectId: 'p_loja', key: 'SITE', target: 'runtime', isSecret: false, value: 'x' })
      .run();

    const { response, body } = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      accountId: 'acc-user',
      apiToken: USER_TOKEN,
      buildVariables: { NEXT_PUBLIC_API: 'https://api.example.com', SENTRY_TOKEN: 'production' },
    });

    const audited = await db.select().from(auditLog).where(eq(auditLog.action, 'deploy.credentials')).get();
    expect(audited).toMatchObject({ actor: 'github-actions:ana/loja#42', target: 'p_loja' });
    expect(audited?.metadata).toMatchObject({ repository: 'ana/loja', ref: 'refs/heads/main', runId: '42' });
    expect(JSON.stringify(audited)).not.toContain(USER_TOKEN);
    const used = await db.select().from(cfConnections).where(eq(cfConnections.id, 'cf_ana')).get();
    expect(used?.lastUsedAt).not.toBeNull();
  });

  it("hands an organization project's run the org's connection, on its production branch", async () => {
    await db
      .insert(orgs)
      .values({ id: 'o_acme', slug: 'acme', name: 'Acme', githubAccountId: 7700, githubLogin: 'Acme' })
      .run();
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    await connection('cf_acme', ORG_TOKEN, { userId: 'u_bruno', orgId: 'o_acme' }, 'acc-acme');
    await project({ repo: 'Acme/Site', orgId: 'o_acme', cfConnectionId: 'cf_acme', productionBranch: 'release' });

    const { response, body } = await request('Acme/Site', { branch: 'release' });
    expect(response.status).toBe(200);
    expect(body).toEqual({ accountId: 'acc-acme', apiToken: ORG_TOKEN, buildVariables: {} });

    // A personal connection is not the org's, even its creator's
    await db.update(runtimes).set({ cfConnectionId: 'cf_ana' }).where(eq(runtimes.projectId, 'p_loja')).run();
    const personal = await request('Acme/Site', { branch: 'release' });
    expect(personal.response.status).toBe(403);
    expect(JSON.stringify(personal.body)).not.toContain(USER_TOKEN);
  });

  it('finds the project by repository id after a rename, and refuses a namesake', async () => {
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    await project({});
    const renamed = await request('ana/loja-nova');
    expect(renamed.response.status).toBe(200);

    const namesake = await request('ana/loja', { repositoryId: '9999' });
    expect(namesake.response.status).toBe(403);
    expect(namesake.body.error).toContain('not the repository');
  });

  it('refuses runs that are not the production deploy workflow on a push', async () => {
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    await project({});
    const refusals = [
      await request('ana/loja', { branch: 'homolog' }),
      await request('ana/loja', {
        branch: 'homolog',
        claims: { job_workflow_ref: `ana/loja/${WORKFLOW}@refs/heads/main` },
      }),
      await request('ana/loja', {
        claims: { job_workflow_ref: 'ana/loja/.github/workflows/other.yml@refs/heads/main' },
      }),
      await request('ana/loja', { claims: { job_workflow_ref: `ana/loja/${WORKFLOW}@refs/heads/homolog` } }),
      // A reusable workflow in another repository that calls it
      await request('ana/loja', { claims: { job_workflow_ref: `evil/repo/${WORKFLOW}@refs/heads/main` } }),
      await request('ana/loja', { claims: { event_name: 'pull_request' } }),
      await request('ana/loja', { claims: { event_name: 'pull_request_target' } }),
      await request('ana/loja', { claims: { event_name: undefined } }),
      await request('ana/loja', { claims: { ref: 'refs/tags/v1' } }),
    ];
    for (const { response, body } of refusals) {
      expect(response.status).toBe(403);
      expect(body.error).toMatch(/production branch|bohr-deploy\.yml|push and workflow_dispatch/);
      expect(JSON.stringify(body)).not.toContain(USER_TOKEN);
    }
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'deploy.credentials')).all()).toEqual([]);
    expect((await request('ana/loja', { claims: { event_name: 'workflow_dispatch' } })).response.status).toBe(200);
  });

  it('refuses unknown repositories, invalid tokens and projects without a connection', async () => {
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    const unknown = await request('someone/else', { repositoryId: '555' });
    expect(unknown.response.status).toBe(403);
    expect(unknown.body.error).toContain('No bohr project');

    const wrongAudience = await oidcToken('ana/loja', 'main', { audience: 'sts.amazonaws.com' });
    const denied = await call('/api/deploy/credentials', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wrongAudience}` },
    });
    expect(denied.status).toBe(401);
    expect((await call('/api/deploy/credentials', { method: 'POST' })).status).toBe(401);

    // No runtime and no move: no account of the owner's to deploy to
    await project({ runtime: false });
    const missing = await request();
    expect(missing.response.status).toBe(403);
    expect(missing.body.error).toContain('no Cloudflare account');

    // The connection was removed
    await db
      .insert(runtimes)
      .values({
        projectId: 'p_loja',
        cfConnectionId: 'cf_ana',
        accountId: 'acc-user',
        script: 's',
        previewScript: 'p',
        projectSecretSealed: 'x',
      })
      .run();
    await db.delete(cfConnections).where(eq(cfConnections.id, 'cf_ana')).run();
    const removed = await request();
    expect(removed.response.status).toBe(403);
  });

  it("never hands out the instance's own token", async () => {
    // A runtime in the instance's account (no connection of the owner's)
    await project({ cfConnectionId: null });
    const instance = await request();
    expect(instance.response.status).toBe(403);
    expect(JSON.stringify(instance.body)).not.toContain(env.CF_API_TOKEN);

    // A connection that holds the instance's token
    await connection('cf_ana', env.CF_API_TOKEN ?? '', { userId: 'u_ana' }, 'acc');
    await db.update(runtimes).set({ cfConnectionId: 'cf_ana' }).where(eq(runtimes.projectId, 'p_loja')).run();
    const copied = await request();
    expect(copied.response.status).toBe(403);
    expect(JSON.stringify(copied.body)).not.toContain(env.CF_API_TOKEN);
  });

  it('refuses projects bohr hosts, except the deploy that moves one to its owner account', async () => {
    await connection('cf_ana', USER_TOKEN, { userId: 'u_ana' }, 'acc-user');
    await project({ mode: 'managed', cfConnectionId: null });
    const managed = await request();
    expect(managed.response.status).toBe(403);
    expect(managed.body.error).toContain('hosted by bohr');
    expect(JSON.stringify(managed.body)).not.toContain(env.CF_API_TOKEN);

    // The move's pull request was merged: its workflow deploys to the account chosen for the move
    const move = { connectionId: 'cf_ana', accountId: 'acc-user', script: 'loja', preparedAt: 1 };
    await writeSetting(db, 'move:p_loja', move);
    const moving = await request();
    expect(moving.body).toEqual({ accountId: 'acc-user', apiToken: USER_TOKEN, buildVariables: {} });

    // Moved: the agent's runtime still runs in bohr's account, the site deploys to the owner's
    await writeSetting(db, 'move:p_loja', { ...move, completedAt: 2 });
    await db.update(projects).set({ mode: 'byo' }).where(eq(projects.id, 'p_loja')).run();
    expect((await request()).body).toMatchObject({ accountId: 'acc-user', apiToken: USER_TOKEN });

    // A suspended project gets nothing
    await db.update(projects).set({ status: 'suspended' }).where(eq(projects.id, 'p_loja')).run();
    expect((await request()).response.status).toBe(403);
  });
});
