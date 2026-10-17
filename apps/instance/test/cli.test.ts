import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { apiTokens, deployments, hostnames, projectMembers, projects, sessions, users } from '../src/db/schema';
import { sha256Hex } from '../src/lib/crypto';
import { MAX_TOKEN_PREVIEW_BRANCHES } from '../src/services/deploy';
import type { FakeCloudflare } from './fake-cloudflare';
import { baseMetadata, call, finalize, oidcToken, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
let cloudflare: FakeCloudflare;

beforeEach(async () => {
  await resetStorage();
  cloudflare = useFakes();
});

/** A user with a panel session; returns the headers that carry it. */
async function person(id: string, role: 'user' | 'admin' = 'user') {
  await db
    .insert(users)
    .values({ id, name: id.slice(2), email: `${id.slice(2)}@example.com`, role })
    .run();
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { Cookie: `__Host-bohr_session=${token}`, 'Content-Type': 'application/json' };
}

/** Ana owns Loja (bohr hosts it, migrated from v1); Bia is a member; Eve is an instance admin, not a member. */
async function world(options: { productionLive?: boolean; mode?: 'managed' | 'byo' } = {}) {
  const ana = await person('u_ana');
  const bia = await person('u_bia');
  const eve = await person('u_eve', 'admin');
  await db
    .insert(projects)
    .values([
      {
        id: 'p_loja',
        ownerUserId: 'u_ana',
        name: 'Loja',
        repoOwner: 'ana',
        repoName: 'loja',
        repoKey: 'ana/loja',
        repoId: 77,
        mode: options.mode ?? 'managed',
        productionBranch: 'main',
      },
      {
        id: 'p_blog',
        ownerUserId: 'u_ana',
        name: 'Blog',
        repoOwner: 'ana',
        repoName: 'blog',
        repoKey: 'ana/blog',
        mode: 'managed',
        productionBranch: 'main',
      },
    ])
    .run();
  await db
    .insert(projectMembers)
    .values([
      { projectId: 'p_loja', userId: 'u_ana', role: 'owner' },
      { projectId: 'p_loja', userId: 'u_bia', role: 'member' },
      { projectId: 'p_blog', userId: 'u_ana', role: 'owner' },
    ])
    .run();
  await db
    .insert(hostnames)
    .values({
      hostname: 'loja.example.com',
      projectId: 'p_loja',
      branch: 'main',
      isProduction: true,
      zoneId: 'zone-example',
      status: options.productionLive ? 'live' : 'pending',
    })
    .run();
  return { ana, bia, eve };
}

async function createToken(headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const response = await call('/api/me/tokens', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'agent', projectIds: null, expiresInDays: null, ...body }),
  });
  const json = (await response.json()) as { token: string; id: string; error?: string };
  return { response, ...json };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('bohr login (device flow)', () => {
  it('gives the CLI a token once the signed-in person approves the code', async () => {
    const { ana } = await world();
    const start = await call('/api/cli/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'CLI on ana-laptop' }),
    });
    expect(start.status).toBe(200);
    const login = (await start.json()) as Record<string, string | number>;
    expect(login).toMatchObject({ expiresIn: 600, interval: 5 });
    expect(String(login.userCode)).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(login.verificationUrl).toBe(`https://app.bohr.io/cli?code=${login.userCode}`);

    const poll = async () => {
      const response = await call('/api/cli/login/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: login.deviceCode }),
      });
      return (await response.json()) as Record<string, unknown>;
    };
    expect(await poll()).toEqual({ status: 'pending' });

    // The panel needs the session, and finds the code typed in any case, without the dash
    const code = String(login.userCode).replace('-', '').toLowerCase();
    expect((await call(`/api/cli/logins/${code}`)).status).toBe(401);
    const shown = (await (await call(`/api/cli/logins/${code}`, { headers: ana })).json()) as {
      login: Record<string, unknown>;
    };
    expect(shown.login).toMatchObject({ userCode: login.userCode, clientName: 'CLI on ana-laptop', status: 'pending' });
    const approved = await call(`/api/cli/logins/${code}/approve`, { method: 'POST', headers: ana, body: '{}' });
    expect(approved.status).toBe(200);

    const answer = await poll();
    expect(answer).toMatchObject({
      status: 'approved',
      user: { id: 'u_ana', name: 'ana', email: 'ana@example.com' },
    });
    expect(String(answer.token)).toMatch(/^bohr_[a-z0-9]{40}$/);
    // Handed out once
    expect(await poll()).toEqual({ status: 'expired' });

    const me = (await (await call('/api/cli/me', { headers: bearer(String(answer.token)) })).json()) as Record<
      string,
      Record<string, unknown>
    >;
    expect(me.user).toMatchObject({ id: 'u_ana' });
    expect(me.token).toMatchObject({ name: 'CLI on ana-laptop', projects: null, expiresAt: null });

    // Only the hash is stored
    const row = await db.select().from(apiTokens).get();
    expect(row?.tokenHash).toBe(await sha256Hex(String(answer.token)));
    expect(JSON.stringify(row)).not.toContain(String(answer.token).slice(5));
    expect(row).toMatchObject({ source: 'cli', hint: `${String(answer.token).slice(0, 9)}…` });
  });

  it('tells the CLI when the code is denied, and refuses to answer twice', async () => {
    const { ana } = await world();
    const login = (await (
      await call('/api/cli/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    ).json()) as Record<string, string>;
    const deny = await call(`/api/cli/logins/${login.userCode}/deny`, { method: 'POST', headers: ana, body: '{}' });
    expect(deny.status).toBe(200);
    const again = await call(`/api/cli/logins/${login.userCode}/approve`, { method: 'POST', headers: ana, body: '{}' });
    expect(again.status).toBe(409);
    const poll = await call('/api/cli/login/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: login.deviceCode }),
    });
    expect(await poll.json()).toEqual({ status: 'denied' });
    expect(await db.select().from(apiTokens).all()).toEqual([]);

    const unknown = await call('/api/cli/login/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: 'nope' }),
    });
    expect(unknown.status).toBe(404);
    expect((await call('/api/cli/logins/BCDF-GHJK', { headers: ana })).status).toBe(404);
  });
});

describe('API tokens', () => {
  it('are shown once, listed without the token, limited to the chosen projects and revocable', async () => {
    const { ana } = await world();
    const created = await createToken(ana, { name: 'deploy agent', projectIds: ['p_loja'], expiresInDays: 30 });
    expect(created.response.status).toBe(201);
    expect(created.token).toMatch(/^bohr_/);

    const list = (await (await call('/api/me/tokens', { headers: ana })).json()) as {
      tokens: Record<string, unknown>[];
      projects: { id: string }[];
    };
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect(list.tokens).toEqual([
      expect.objectContaining({
        name: 'deploy agent',
        source: 'panel',
        projects: [{ id: 'p_loja', name: 'Loja' }],
        expired: false,
        lastUsedAt: null,
      }),
    ]);
    expect(list.projects.map((project) => project.id).sort()).toEqual(['p_blog', 'p_loja']);

    // The token sees Loja only
    const projectsSeen = (await (await call('/api/cli/projects', { headers: bearer(created.token) })).json()) as {
      projects: { id: string; role: string; productionUrl: string | null }[];
    };
    expect(projectsSeen.projects).toEqual([
      expect.objectContaining({ id: 'p_loja', role: 'owner', productionUrl: 'https://loja.example.com' }),
    ]);
    expect((await call('/api/cli/projects/p_blog', { headers: bearer(created.token) })).status).toBe(404);
    const byRepo = (await (
      await call('/api/cli/projects?repository=ANA/Loja', { headers: bearer(created.token) })
    ).json()) as { projects: { id: string }[] };
    expect(byRepo.projects.map((project) => project.id)).toEqual(['p_loja']);
    const used = await db.select().from(apiTokens).where(eq(apiTokens.id, created.id)).get();
    expect(used?.lastUsedAt).not.toBeNull();

    const revoked = await call(`/api/me/tokens/${created.id}`, { method: 'DELETE', headers: ana });
    expect(revoked.status).toBe(200);
    expect((await call('/api/cli/me', { headers: bearer(created.token) })).status).toBe(401);
  });

  it("refuses other people's projects, other people's tokens and expired tokens", async () => {
    const { ana, bia } = await world();
    expect((await createToken(bia, { projectIds: ['p_blog'] })).response.status).toBe(400);
    const anas = await createToken(ana);
    expect((await call(`/api/me/tokens/${anas.id}`, { method: 'DELETE', headers: bia })).status).toBe(404);

    await db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, anas.id))
      .run();
    expect((await call('/api/cli/me', { headers: bearer(anas.token) })).status).toBe(401);
    expect((await call('/api/cli/me', { headers: bearer('bohr_forged') })).status).toBe(401);
    // Session routes do not take tokens, and tokens never reach the panel's API
    expect((await call('/api/projects', { headers: bearer(anas.token) })).status).toBe(401);
  });

  it('never carry the instance admin role', async () => {
    const { eve } = await world();
    const token = (await createToken(eve)).token;
    const seen = (await (await call('/api/cli/projects', { headers: bearer(token) })).json()) as { projects: [] };
    expect(seen.projects).toEqual([]);
    expect((await call('/api/cli/projects/p_loja', { headers: bearer(token) })).status).toBe(404);
    const session = await call('/api/deploy/sessions', {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p_loja', branch: 'feature' }),
    });
    expect(session.status).toBe(404);
  });
});

/** Opens a deploy session with an API token. */
async function tokenSession(token: string, target: Record<string, unknown>, manifest: Record<string, unknown> = {}) {
  const response = await call('/api/deploy/sessions', {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, assetsConfig: {}, ...target }),
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('deploys with an API token (bohr deploy)', () => {
  it("deploys a preview of any branch for a member, recorded as the token's", async () => {
    const { bia } = await world();
    const token = (await createToken(bia)).token;
    const session = await tokenSession(token, { projectId: 'p_loja', branch: 'feature/login' });
    expect(session.response.status).toBe(200);
    const { response, body } = await finalize(token, String(session.body.sessionId), baseMetadata);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ script: 'p_loja-feature-login', url: 'https://feature-login-loja-ana.bohr.io' });
    const deployment = await db.select().from(deployments).get();
    expect(deployment).toMatchObject({ branch: 'feature/login', status: 'success' });
    expect(deployment?.actor).toMatch(/^token:tok_/);
  });

  it('keeps production for owners who say so, and leaves a production still on bohr v1 to its workflow', async () => {
    const { ana, bia } = await world();
    const owner = (await createToken(ana)).token;
    const member = (await createToken(bia)).token;

    const implicit = await tokenSession(owner, { projectId: 'p_loja', branch: 'main' });
    expect(implicit.response.status).toBe(409);
    expect(implicit.body.code).toBe('production_branch');
    const mismatch = await tokenSession(owner, { projectId: 'p_loja', branch: 'dev', production: true });
    expect(mismatch.response.status).toBe(400);
    const byMember = await tokenSession(member, { projectId: 'p_loja', branch: 'main', production: true });
    expect(byMember.response.status).toBe(403);
    expect(byMember.body.code).toBe('production_not_allowed');
    const onV1 = await tokenSession(owner, { projectId: 'p_loja', branch: 'main', production: true });
    expect(onV1.response.status).toBe(409);
    expect(onV1.body.code).toBe('production_on_v1');
    // Nothing was published, and the v1 address was not touched
    expect(cloudflare.scripts.size).toBe(0);
    expect((await db.select().from(hostnames).where(eq(hostnames.hostname, 'loja.example.com')).get())?.status).toBe(
      'pending',
    );

    await db.update(hostnames).set({ status: 'live' }).where(eq(hostnames.hostname, 'loja.example.com')).run();
    const session = await tokenSession(owner, { projectId: 'p_loja', branch: 'main', production: true });
    expect(session.response.status).toBe(200);
    const { response, body } = await finalize(owner, String(session.body.sessionId), baseMetadata);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ script: 'p_loja-main', url: 'https://loja.example.com' });
  });

  it("refuses projects in their owner's account and invalid branches", async () => {
    const { ana } = await world({ mode: 'byo' });
    const token = (await createToken(ana)).token;
    const byo = await tokenSession(token, { projectId: 'p_loja', branch: 'feature' });
    expect(byo.response.status).toBe(409);
    expect(byo.body.code).toBe('own_account');
    for (const branch of ['', '../x', 'a b', 'feature/', '-x', 'a..b', 'x.lock']) {
      expect((await tokenSession(token, { projectId: 'p_blog', branch })).response.status, branch).toBe(400);
    }
  });

  it('caps the preview branches a token can create, and keeps deploying the existing ones', async () => {
    const { bia } = await world({ productionLive: true });
    const token = (await createToken(bia)).token;
    // Preview branches with an address already, and another project's, which do not count (one row per insert:
    // D1 takes at most 100 bound parameters)
    const rows = [
      ...Array.from({ length: MAX_TOKEN_PREVIEW_BRANCHES - 1 }, (_, index) => ({
        hostname: `old-${index}-loja-ana.bohr.io`,
        projectId: 'p_loja',
        branch: `old-${index}`,
        zoneId: 'zone-bohr',
      })),
      { hostname: 'other-blog-ana.bohr.io', projectId: 'p_blog', branch: 'other', zoneId: 'zone-bohr' },
    ];
    for (const row of rows) await db.insert(hostnames).values(row).run();

    // The last one still fits
    const fits = await tokenSession(token, { projectId: 'p_loja', branch: 'feature/login' });
    expect(fits.response.status).toBe(200);
    expect((await finalize(token, String(fits.body.sessionId), baseMetadata)).response.status).toBe(200);

    const full = await tokenSession(token, { projectId: 'p_loja', branch: 'feature/cart' });
    expect(full.response.status).toBe(409);
    expect(full.body.code).toBe('too_many_previews');
    expect(String(full.body.error)).toContain(`already has ${MAX_TOKEN_PREVIEW_BRANCHES} preview branches`);
    expect(String(full.body.error)).toContain('Delete old previews');

    // A branch that has a preview keeps deploying
    expect((await tokenSession(token, { projectId: 'p_loja', branch: 'old-3' })).response.status).toBe(200);
    expect((await tokenSession(token, { projectId: 'p_loja', branch: 'feature/login' })).response.status).toBe(200);
    // The repository's workflow is not limited
    const run = await oidcToken('ana/loja', 'feature/cart', { repositoryId: '77' });
    const runSession = await call('/api/deploy/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${run}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: {} }),
    });
    expect(runSession.status).toBe(200);
  });

  it('only lets the token that opened a session finalize it, and never a GitHub run', async () => {
    const { ana } = await world({ productionLive: true });
    const first = await createToken(ana);
    const second = (await createToken(ana)).token;
    const session = await tokenSession(first.token, { projectId: 'p_loja', branch: 'feature' });
    const sessionId = String(session.body.sessionId);

    expect((await finalize(second, sessionId, baseMetadata)).response.status).toBe(403);
    const run = await oidcToken('ana/loja', 'feature', { repositoryId: '77' });
    expect((await finalize(run, sessionId, baseMetadata)).response.status).toBe(403);

    // A GitHub run's session is not the token's either
    const runSession = await call('/api/deploy/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${run}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: {} }),
    });
    expect(runSession.status).toBe(200);
    const runSessionId = String(((await runSession.json()) as Record<string, unknown>).sessionId);
    expect((await finalize(first.token, runSessionId, baseMetadata)).response.status).toBe(403);

    // Revoked before finalizing: nothing is published
    await call(`/api/me/tokens/${first.id}`, { method: 'DELETE', headers: ana });
    expect((await finalize(first.token, sessionId, baseMetadata)).response.status).toBe(401);
    expect(cloudflare.scripts.size).toBe(0);
  });
});

describe('a deploy never takes a site down', () => {
  it('keeps serving the previous version when a session is abandoned or Cloudflare refuses the new one', async () => {
    const { ana } = await world();
    const token = (await createToken(ana)).token;
    const first = await tokenSession(token, { projectId: 'p_loja', branch: 'feature' });
    expect((await finalize(token, String(first.body.sessionId), baseMetadata)).response.status).toBe(200);
    const live = cloudflare.scripts.get('p_loja-feature');
    expect(live?.modules['index.js']?.text).toContain('hi');

    // Uploads that never finalize change nothing
    const abandoned = await tokenSession(
      token,
      { projectId: 'p_loja', branch: 'feature' },
      {
        '/index.html': { hash: 'd'.repeat(32), size: 3 },
      },
    );
    expect(abandoned.response.status).toBe(200);
    expect(cloudflare.scripts.get('p_loja-feature')).toBe(live);

    // The new version is refused: the previous one stays, and the deployment says why
    cloudflare.rejectScripts = 'Uncaught SyntaxError in index.js';
    const second = await tokenSession(token, { projectId: 'p_loja', branch: 'feature' });
    const failed = await finalize(token, String(second.body.sessionId), baseMetadata, {
      'index.js': 'export default { fetch() { return new Response("broken"); } };',
    });
    expect(failed.response.status).toBe(502);
    expect(failed.body.error).toContain('Uncaught SyntaxError');
    expect(cloudflare.scripts.get('p_loja-feature')).toBe(live);
    const rows = await db.select().from(deployments).all();
    expect(rows.map((row) => row.status).sort()).toEqual(['error', 'success']);
  });
});
