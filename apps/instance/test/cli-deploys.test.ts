import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  auditLog,
  cfConnections,
  cliDeploys,
  envVars,
  orgMembers,
  orgs,
  projectMembers,
  projects,
  runtimes,
  sessions,
  users,
} from '../src/db/schema';
import { randomId, sha256Hex } from '../src/lib/crypto';
import { vault } from '../src/lib/vault';
import { createApiToken } from '../src/services/api-tokens';
import { CREDENTIALS_ACTION, MAX_CREDENTIALS_PER_WINDOW, REPORT_ACTION } from '../src/services/cli-deploys';
import { cfTokenContext } from '../src/services/provision';
import { buildVariableContext } from '../src/services/variables';
import { call, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const ANA_CF = 'cf-ana-token-0123456789abcdefghijklmnop';
const ACME_CF = 'cf-acme-token-0123456789abcdefghijklmno';

beforeEach(async () => {
  await resetStorage();
  useFakes();
});

async function person(id: string) {
  await db
    .insert(users)
    .values({ id, name: id.slice(2), email: `${id.slice(2)}@example.com` })
    .run();
  const session = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(session), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { Cookie: `__Host-bohr_session=${session}`, 'Content-Type': 'application/json' };
}

async function token(userId: string, projectIds: string[] | null = null) {
  return (await createApiToken(db, { userId, name: 'agent', projectIds, expiresAt: null, source: 'panel' })).token;
}

async function connection(id: string, apiToken: string, owner: { userId: string; orgId?: string }, accountId: string) {
  await db
    .insert(cfConnections)
    .values({
      id,
      userId: owner.userId,
      orgId: owner.orgId ?? null,
      accountId,
      tokenSealed: await vault(env).seal(apiToken, cfTokenContext(id)),
    })
    .run();
}

async function project(
  id: string,
  options: { mode?: 'byo' | 'managed'; orgId?: string; connectionId?: string | null; owner?: string } = {},
) {
  await db
    .insert(projects)
    .values({
      id,
      ownerUserId: options.owner ?? 'u_ana',
      name: id.slice(2),
      repoOwner: 'ana',
      repoName: id.slice(2),
      repoKey: `ana/${id.slice(2)}`,
      mode: options.mode ?? 'byo',
      orgId: options.orgId ?? null,
      productionBranch: 'main',
    })
    .run();
  if (options.connectionId !== undefined || options.mode !== 'managed') {
    await db
      .insert(runtimes)
      .values({
        projectId: id,
        cfConnectionId: options.connectionId === undefined ? 'cf_ana' : options.connectionId,
        accountId: 'acc-ana',
        script: `bohr-${id}`,
        previewScript: `bohr-${id}-preview`,
        projectSecretSealed: 'x',
        status: 'ready',
      })
      .run();
  }
}

async function buildVariable(projectId: string, branch: string, key: string, value: string) {
  await db
    .insert(envVars)
    .values({
      id: randomId('v_', 16),
      projectId,
      branch,
      key,
      target: 'build',
      isSecret: true,
      value: null,
      valueSealed: await vault(env).seal(value, buildVariableContext(projectId, branch, key)),
    })
    .run();
}

/** Ana owns Loja (in her own account); Bia is a member of it. */
async function world() {
  const ana = await person('u_ana');
  const bia = await person('u_bia');
  await connection('cf_ana', ANA_CF, { userId: 'u_ana' }, 'acc-ana');
  await project('p_loja');
  await db
    .insert(projectMembers)
    .values([
      { projectId: 'p_loja', userId: 'u_ana', role: 'owner' },
      { projectId: 'p_loja', userId: 'u_bia', role: 'member' },
    ])
    .run();
  return { ana, bia };
}

async function credentials(bearer: string | null, projectId: string, body: unknown = { branch: 'feature' }) {
  const response = await call(`/api/cli/projects/${projectId}/credentials`, {
    method: 'POST',
    headers: { ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

async function report(bearer: string, projectId: string, body: Record<string, unknown>) {
  const response = await call(`/api/cli/projects/${projectId}/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('CLI credentials for projects in their owner account', () => {
  it("hands the owner's token the account, its Cloudflare token and the branch's build variables, audited", async () => {
    await world();
    await buildVariable('p_loja', '*', 'SENTRY_TOKEN', 'all');
    await buildVariable('p_loja', 'feature', 'SENTRY_TOKEN', 'feature');
    await buildVariable('p_loja', 'main', 'ONLY_MAIN', 'no');
    const bearer = await token('u_ana');

    const { response, text } = await credentials(bearer, 'p_loja');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({
      accountId: 'acc-ana',
      apiToken: ANA_CF,
      buildVariables: { SENTRY_TOKEN: 'feature' },
    });

    const audited = await db.select().from(auditLog).where(eq(auditLog.action, CREDENTIALS_ACTION)).all();
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ actorUserId: 'u_ana', target: 'p_loja' });
    expect(audited[0]?.actor).toMatch(/^token:tok_/);
    expect(audited[0]?.metadata).toMatchObject({
      tokenId: audited[0]?.actor.slice('token:'.length),
      branch: 'feature',
      production: false,
      accountId: 'acc-ana',
      connectionId: 'cf_ana',
      buildVariables: 1,
    });
    expect(JSON.stringify(audited)).not.toContain(ANA_CF);
    expect(JSON.stringify(audited)).not.toContain(bearer);

    // Production says so, on the production branch only
    const production = await credentials(bearer, 'p_loja', { branch: 'main', production: true });
    expect(JSON.parse(production.text)).toMatchObject({ apiToken: ANA_CF, buildVariables: { ONLY_MAIN: 'no' } });
    const unsaid = await credentials(bearer, 'p_loja', { branch: 'main' });
    expect(unsaid.response.status).toBe(409);
    expect(JSON.parse(unsaid.text).code).toBe('production_branch');
    expect((await credentials(bearer, 'p_loja', { branch: 'dev', production: true })).response.status).toBe(400);
    expect((await credentials(bearer, 'p_loja', { branch: 'bad..name' })).response.status).toBe(400);
  });

  it('refuses members, tokens that do not list the project, strangers and missing tokens', async () => {
    await world();
    await project('p_blog');
    await db.insert(projectMembers).values({ projectId: 'p_blog', userId: 'u_ana', role: 'owner' }).run();
    await person('u_eve');

    const member = await credentials(await token('u_bia'), 'p_loja');
    expect(member.response.status).toBe(403);
    expect(JSON.parse(member.text).code).toBe('own_account_not_allowed');

    const scoped = await token('u_ana', ['p_blog']);
    expect((await credentials(scoped, 'p_loja')).response.status).toBe(404);
    expect((await credentials(scoped, 'p_blog')).response.status).toBe(200);
    expect((await credentials(await token('u_eve'), 'p_loja')).response.status).toBe(404);
    expect((await credentials(null, 'p_loja')).response.status).toBe(401);
    expect((await credentials('bohr_notatoken', 'p_loja')).response.status).toBe(401);

    for (const refused of [member, await credentials(scoped, 'p_loja')]) expect(refused.text).not.toContain(ANA_CF);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, CREDENTIALS_ACTION)).all()).toHaveLength(1);
  });

  it("gives an organization's admins its connection, never its members", async () => {
    await person('u_ana');
    await person('u_bruno');
    await person('u_carla');
    await db
      .insert(orgs)
      .values({ id: 'o_acme', slug: 'acme', name: 'Acme', githubAccountId: 7700, githubLogin: 'Acme' })
      .run();
    const member = (userId: string, githubUserId: number, role: 'admin' | 'member', status = 'active' as const) => ({
      orgId: 'o_acme',
      githubUserId,
      githubLogin: userId.slice(2),
      userId,
      role,
      status,
      source: 'github' as const,
    });
    await db
      .insert(orgMembers)
      .values([member('u_ana', 1, 'admin'), member('u_bruno', 2, 'member'), member('u_carla', 3, 'admin')])
      .run();
    await connection('cf_ana', ANA_CF, { userId: 'u_ana' }, 'acc-ana');
    await connection('cf_acme', ACME_CF, { userId: 'u_ana', orgId: 'o_acme' }, 'acc-acme');
    await project('p_site', { orgId: 'o_acme', connectionId: 'cf_acme' });

    const admin = await credentials(await token('u_carla'), 'p_site');
    expect(admin.response.status).toBe(200);
    expect(JSON.parse(admin.text)).toMatchObject({ accountId: 'acc-acme', apiToken: ACME_CF });

    const plain = await credentials(await token('u_bruno'), 'p_site');
    expect(plain.response.status).toBe(403);
    expect(plain.text).not.toContain(ACME_CF);

    // An admin no longer active in the organization reaches nothing
    await db.update(orgMembers).set({ status: 'removed' }).where(eq(orgMembers.userId, 'u_carla')).run();
    expect((await credentials(await token('u_carla'), 'p_site')).response.status).toBe(404);

    // A personal connection is not the org's, even its creator's
    await db.update(runtimes).set({ cfConnectionId: 'cf_ana' }).where(eq(runtimes.projectId, 'p_site')).run();
    const personal = await credentials(await token('u_ana'), 'p_site');
    expect(personal.response.status).toBe(403);
    expect(personal.text).not.toContain(ANA_CF);
  });

  it("refuses projects bohr hosts, suspended ones, and never hands out the instance's token", async () => {
    await world();
    const bearer = await token('u_ana');
    await project('p_hosted', { mode: 'managed', connectionId: null });
    await db.insert(projectMembers).values({ projectId: 'p_hosted', userId: 'u_ana', role: 'owner' }).run();
    const hosted = await credentials(bearer, 'p_hosted');
    expect(hosted.response.status).toBe(409);
    expect(JSON.parse(hosted.text).code).toBe('hosted');
    expect(hosted.text).not.toContain(env.CF_API_TOKEN);

    // A runtime in the instance's own account, then a connection holding the instance's token
    await db.update(runtimes).set({ cfConnectionId: null }).where(eq(runtimes.projectId, 'p_loja')).run();
    const instance = await credentials(bearer, 'p_loja');
    expect(instance.response.status).toBe(403);
    expect(instance.text).not.toContain(env.CF_API_TOKEN);
    await connection('cf_copy', env.CF_API_TOKEN ?? '', { userId: 'u_ana' }, 'acc');
    await db.update(runtimes).set({ cfConnectionId: 'cf_copy' }).where(eq(runtimes.projectId, 'p_loja')).run();
    const copied = await credentials(bearer, 'p_loja');
    expect(copied.response.status).toBe(403);
    expect(copied.text).not.toContain(env.CF_API_TOKEN);

    await db.update(runtimes).set({ cfConnectionId: 'cf_ana' }).where(eq(runtimes.projectId, 'p_loja')).run();
    await db.update(projects).set({ status: 'suspended' }).where(eq(projects.id, 'p_loja')).run();
    const suspended = await credentials(bearer, 'p_loja');
    expect(suspended.response.status).toBe(403);
    expect(suspended.text).not.toContain(ANA_CF);
  });

  it('limits how often one person gets the token for a project', async () => {
    await world();
    const bearer = await token('u_ana');
    // D1 binds at most 100 parameters per statement: one row at a time
    for (let n = 0; n < MAX_CREDENTIALS_PER_WINDOW; n++) {
      await db
        .insert(auditLog)
        .values({
          id: `al_${n}`,
          actor: 'token:tok_x',
          actorUserId: 'u_ana',
          action: CREDENTIALS_ACTION,
          target: 'p_loja',
        })
        .run();
    }
    const limited = await credentials(bearer, 'p_loja');
    expect(limited.response.status).toBe(429);
    expect(limited.text).not.toContain(ANA_CF);
    // Older issuances no longer count
    await db
      .update(auditLog)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(auditLog.action, CREDENTIALS_ACTION))
      .run();
    expect((await credentials(bearer, 'p_loja')).response.status).toBe(200);
  });
});

describe('deploys reported by the CLI', () => {
  it("records the owner's deploys and lists them for the project's members in the panel", async () => {
    const { bia } = await world();
    const bearer = await token('u_ana');
    const preview = await report(bearer, 'p_loja', {
      branch: 'feature',
      workerName: 'loja',
      versionId: '0f1e2d3c-aaaa-bbbb-cccc-123456789abc',
      url: 'https://feature-loja.ana.workers.dev',
      commitSha: 'a'.repeat(40),
    });
    expect(preview.response.status).toBe(200);
    expect(preview.body.deploy).toMatchObject({ branch: 'feature', production: false, workerName: 'loja' });
    const production = await report(bearer, 'p_loja', {
      branch: 'main',
      production: true,
      versionId: 'abc-123',
      url: null,
    });
    expect(production.response.status).toBe(200);

    const rows = await db.select().from(cliDeploys).all();
    expect(rows.map((row) => [row.branch, row.production, row.userId])).toEqual(
      expect.arrayContaining([
        ['feature', false, 'u_ana'],
        ['main', true, 'u_ana'],
      ]),
    );
    expect(await db.select().from(auditLog).where(eq(auditLog.action, REPORT_ACTION)).all()).toHaveLength(2);

    const listed = await call('/api/projects/p_loja/cli-deploys', { headers: bia });
    expect(listed.status).toBe(200);
    const { deploys } = (await listed.json()) as { deploys: Record<string, unknown>[] };
    expect(deploys).toHaveLength(2);
    expect(deploys.map((deploy) => deploy.branch).sort()).toEqual(['feature', 'main']);
    expect((await call('/api/projects/p_loja/cli-deploys')).status).toBe(401);
  });

  it('refuses reports from members, for projects bohr hosts and with invalid fields', async () => {
    await world();
    const bearer = await token('u_ana');
    expect((await report(await token('u_bia'), 'p_loja', { branch: 'feature' })).response.status).toBe(403);
    await project('p_hosted', { mode: 'managed', connectionId: null });
    await db.insert(projectMembers).values({ projectId: 'p_hosted', userId: 'u_ana', role: 'owner' }).run();
    expect((await report(bearer, 'p_hosted', { branch: 'feature' })).response.status).toBe(409);
    for (const invalid of [
      { branch: 'feature', url: 'http://insecure.example.com' },
      { branch: 'feature', url: 'javascript:alert(1)' },
      { branch: 'feature', commitSha: 'not-a-sha' },
      { branch: 'feature', workerName: 'has spaces' },
      { branch: 'main' },
    ]) {
      expect((await report(bearer, 'p_loja', invalid)).response.status).toBeGreaterThanOrEqual(400);
    }
    expect(await db.select().from(cliDeploys).all()).toEqual([]);
  });
});
