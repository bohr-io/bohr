import { AGENT_EFFORTS, claudeLoginCodeSchema, claudeLoginIdSchema } from '@bohr/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb } from '../db/client';
import {
  ALL_BRANCHES,
  deployments,
  envVars,
  hostnames,
  identities,
  orgMembers,
  orgs,
  projectMembers,
  projects,
  runtimes,
} from '../db/schema';
import { deps } from '../deps';
import type { AppEnv } from '../env';
import { auditActor, projectAccess, projectRole } from '../lib/access';
import { inChunks } from '../lib/chunks';
import { randomId } from '../lib/crypto';
import { badRequest, HttpError, inBackground, notFound, unauthorized } from '../lib/http';
import { sessionUser } from '../lib/session';
import { agentSettings, agentSettingsView, removeAgentSettings, saveAgentSettings } from '../services/agent-settings';
import { audit } from '../services/audit';
import { buildJobs, listBuilds } from '../services/builds';
import { cancelSubscriptionLogin, finishSubscriptionLogin, startSubscriptionLogin } from '../services/claude-login';
import { deleteProject } from '../services/delete-project';
import { redeploy } from '../services/deploy';
import { addDomain, domainsView, removeDomain } from '../services/domains';
import { orgAccess } from '../services/orgs';
import { protectionView, setProtection } from '../services/protection';
import { capturesScreenshots, isStale, readScreenshot, refreshScreenshot } from '../services/screenshots';
import { deleteRuntimeSecret, setRuntimeSecret } from '../services/secrets';
import { deleteVariable, listVariables, setVariable } from '../services/variables';

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c, createDb(c.env.DB));
  if (user === null) throw unauthorized();
  // Mutations only accept JSON: browsers cannot send it cross-site without a preflight
  if (
    !['GET', 'HEAD', 'DELETE'].includes(c.req.method) &&
    !c.req.header('Content-Type')?.startsWith('application/json')
  ) {
    throw new HttpError(415, 'Send application/json.');
  }
  c.set('user', user);
  await next();
});

const envVarBody = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  value: z.string().max(5120),
  isSecret: z.boolean(),
  branch: z.string().min(1).max(255).default(ALL_BRANCHES),
});

export const apiRoutes = new Hono<AppEnv>();
apiRoutes.use('/me', requireUser);
apiRoutes.use('/me/*', requireUser);
apiRoutes.use('/projects', requireUser);
apiRoutes.use('/projects/*', requireUser);

apiRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const db = createDb(c.env.DB);
  const accounts = await db
    .select({ provider: identities.provider, username: identities.username })
    .from(identities)
    .where(eq(identities.userId, user.id))
    .all();
  // role at the top level is what the panel reads (its admin area); user.role stays for older clients
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    role: user.role,
    identities: accounts,
  });
});

// The agent's model provider, model and effort: one setting per user, applied to every project they own
apiRoutes.get('/me/agent', async (c) => {
  const db = createDb(c.env.DB);
  return c.json({ agent: agentSettingsView(await agentSettings(db, c.env, c.get('user').id)) });
});

apiRoutes.put('/me/agent', async (c) => {
  const db = createDb(c.env.DB);
  const input = z
    .object({
      // "subscription" here is the fallback: a token the user created with `claude setup-token` themselves
      provider: z.enum(['anthropic', 'compatible', 'subscription']),
      apiKey: z.string().max(500).optional(),
      baseUrl: z.string().max(500).nullish(),
      model: z.string().max(100).regex(/^\S*$/, 'The model name has no spaces.').nullish(),
      effort: z.enum(AGENT_EFFORTS).nullish(),
    })
    .parse(await c.req.json());
  const { settings, applied, failed } = await saveAgentSettings(db, c.env, c.get('user').id, input);
  return c.json({ agent: agentSettingsView(settings), projects: { applied, failed } });
});

// The user's Claude subscription, through the official CLI's `claude setup-token` in the instance's sign-in
// container (or, without one, in one of their project containers): start answers with the link to authorize at,
// finish takes the code claude.ai shows and keeps the token (never sent back to the browser)
apiRoutes.post('/me/agent/subscription/start', async (c) => {
  return c.json(await startSubscriptionLogin(createDb(c.env.DB), c.env, c.get('user')));
});

apiRoutes.post('/me/agent/subscription/finish', async (c) => {
  const db = createDb(c.env.DB);
  const input = z
    .object({
      // The project container the sign-in runs in; null with the dedicated sign-in container
      projectId: z.string().min(1).max(100).nullish(),
      loginId: claudeLoginIdSchema,
      code: claudeLoginCodeSchema,
      model: z.string().max(100).regex(/^\S*$/, 'The model name has no spaces.').nullish(),
      effort: z.enum(AGENT_EFFORTS).nullish(),
    })
    .parse(await c.req.json());
  const { settings, applied, failed } = await finishSubscriptionLogin(db, c.env, c.get('user'), input);
  return c.json({ agent: agentSettingsView(settings), projects: { applied, failed } });
});

apiRoutes.post('/me/agent/subscription/cancel', async (c) => {
  const input = z
    .object({ projectId: z.string().min(1).max(100).nullish(), loginId: claudeLoginIdSchema })
    .parse(await c.req.json());
  await cancelSubscriptionLogin(createDb(c.env.DB), c.env, c.get('user'), input);
  return c.json({ cancelled: true });
});

apiRoutes.delete('/me/agent', async (c) => {
  await removeAgentSettings(createDb(c.env.DB), c.env, c.get('user').id);
  return c.json({ agent: agentSettingsView(null) });
});

/** The org of each of these projects, as { slug, name } (null for personal projects). */
async function projectOrgs(db: ReturnType<typeof createDb>, orgIds: (string | null)[]) {
  const ids = [...new Set(orgIds.filter((id): id is string => id !== null))];
  const rows =
    ids.length > 0
      ? await inChunks(ids, (chunk) =>
          db.select({ id: orgs.id, slug: orgs.slug, name: orgs.name }).from(orgs).where(inArray(orgs.id, chunk)).all(),
        )
      : [];
  return (orgId: string | null) => {
    const org = rows.find((row) => row.id === orgId);
    return org === undefined ? null : { slug: org.slug, name: org.name };
  };
}

// The user's projects: the ones they are a member of (?scope=personal: only those outside organizations); with
// ?org=<slug>, the organization's projects (its admins own them, its members are members)
apiRoutes.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const slug = c.req.query('org');
  let rows: { project: typeof projects.$inferSelect; role: 'owner' | 'member' }[];
  if (slug === undefined || slug === '') {
    const mine = eq(projectMembers.userId, user.id);
    const memberships = await db
      .select({ project: projects, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(c.req.query('scope') === 'personal' ? and(mine, isNull(projects.orgId)) : mine)
      .all();
    // An organization's admins own its projects (lib/access.ts), whatever their own row in the project says
    const adminOf = new Set(
      (
        await db
          .select({ orgId: orgMembers.orgId })
          .from(orgMembers)
          .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.role, 'admin'), eq(orgMembers.status, 'active')))
          .all()
      ).map((row) => row.orgId),
    );
    rows = memberships.map(({ project, role }) => ({
      project,
      role: project.orgId !== null && adminOf.has(project.orgId) ? 'owner' : role,
    }));
  } else {
    const { org, access } = await orgAccess(db, slug, user);
    const orgProjects = await db.select().from(projects).where(eq(projects.orgId, org.id)).orderBy(projects.name).all();
    rows = await Promise.all(
      orgProjects.map(async (project) => ({
        project,
        role: access === 'admin' ? 'owner' : ((await projectRole(db, project, user.id)) ?? 'member'),
      })),
    );
  }
  const ids = rows.map((row) => row.project.id);
  const hosts = await inChunks(ids, (chunk) =>
    db.select().from(hostnames).where(inArray(hostnames.projectId, chunk)).all(),
  );
  const projectRuntimes = await inChunks(ids, (chunk) =>
    db.select().from(runtimes).where(inArray(runtimes.projectId, chunk)).all(),
  );
  // The latest deploy of each project, of any branch
  const latestDeploys = await inChunks(ids, (chunk) =>
    db
      .select({
        projectId: deployments.projectId,
        status: deployments.status,
        branch: deployments.branch,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .where(
        and(
          inArray(deployments.projectId, chunk),
          sql`${deployments.createdAt} = (SELECT MAX(d.created_at) FROM deployments d WHERE d.project_id = ${deployments.projectId})`,
        ),
      )
      .all(),
  );
  const orgOf = await projectOrgs(
    db,
    rows.map((row) => row.project.orgId),
  );
  return c.json({
    projects: rows.map(({ project, role }) => {
      const runtime = projectRuntimes.find((row) => row.projectId === project.id);
      const host = hosts.find((h) => h.projectId === project.id && h.isProduction);
      const lastDeploy = latestDeploys.find((row) => row.projectId === project.id);
      return {
        id: project.id,
        name: project.name,
        repository: `${project.repoOwner}/${project.repoName}`,
        status: project.status,
        mode: project.mode,
        role,
        org: orgOf(project.orgId),
        productionUrl: host ? `https://${host.hostname.replace(/^\*\./, '')}` : null,
        updatedAt: project.updatedAt,
        lastDeploy:
          lastDeploy === undefined
            ? null
            : { status: lastDeploy.status, branch: lastDeploy.branch, createdAt: lastDeploy.createdAt },
        // The project Worker (agent, bot, preview); null for projects that only deploy
        runtime:
          runtime === undefined
            ? null
            : {
                status: runtime.status,
                previewUrl: runtime.previewUrl,
                botUsername: runtime.telegramBotUsername,
              },
      };
    }),
  });
});

// The danger zone: the owner deletes the project, typing its name to confirm
apiRoutes.delete('/projects/:id', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const input = z.object({ confirm: z.string(), deleteSite: z.boolean().default(false) }).parse(await c.req.json());
  if (input.confirm.trim() !== project.name) throw badRequest('Type the project name to confirm.');
  return c.json(
    await deleteProject(db, c.env, project, user.id, {
      deleteSite: input.deleteSite,
      actor: auditActor(user, access).actor,
    }),
  );
});

apiRoutes.get('/projects/:id', async (c) => {
  const db = createDb(c.env.DB);
  const { project, role, access } = await projectAccess(db, c.req.param('id'), c.get('user'));
  const [hosts, recent, vars] = await Promise.all([
    db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all(),
    db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .orderBy(desc(deployments.createdAt))
      .limit(30)
      .all(),
    db.select().from(envVars).where(eq(envVars.projectId, project.id)).all(),
  ]);
  const orgOf = await projectOrgs(db, [project.orgId]);
  const org = orgOf(project.orgId);
  return c.json({
    project: {
      id: project.id,
      name: project.name,
      repository: `${project.repoOwner}/${project.repoName}`,
      productionBranch: project.productionBranch,
      status: project.status,
      mode: project.mode,
      role,
      access,
      org,
    },
    // Also at the top level, where the panel reads them (ProjectDetail); project.access/org stay for older clients
    access,
    org,
    hostnames: hosts.map(({ hostname, branch, isProduction, status }) => ({ hostname, branch, isProduction, status })),
    deployments: recent.map(({ bundleKey: _bundle, ...deployment }) => deployment),
    envVars: vars.map(({ key, branch, target, isSecret, value, updatedAt }) => ({
      key,
      branch,
      target,
      isSecret,
      value: isSecret ? null : value,
      updatedAt,
    })),
  });
});

// The picture of the production site on the project's card (services/screenshots.ts); 404 until there is one. A
// missing or stale picture is taken after the response, so the next view has it.
apiRoutes.get('/projects/:id/screenshot', async (c) => {
  const db = createDb(c.env.DB);
  const { project } = await projectAccess(db, c.req.param('id'), c.get('user'));
  const etag = c.req.header('If-None-Match')?.replace(/^W\//, '').replaceAll('"', '');
  const object = await readScreenshot(db, c.env, project, etag || undefined);
  if (capturesScreenshots(c.env) && (await isStale(db, project, object?.uploaded ?? null))) {
    inBackground(c, refreshScreenshot(db, c.env, project, 'stale'));
  }
  if (object === null) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'No screenshot yet.' }, 404);
  }
  c.header('Cache-Control', 'private, max-age=300');
  c.header('ETag', object.httpEtag);
  c.header('Last-Modified', object.uploaded.toUTCString());
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'image/webp');
  c.header('X-Content-Type-Options', 'nosniff');
  // The condition held (the panel has this picture already): R2 sent no body
  if (!('body' in object)) return c.body(null, 304);
  return c.body(object.body);
});

const variableBody = z.object({
  target: z.enum(['runtime', 'build']),
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
  value: z.string().max(5120),
  secret: z.boolean(),
});

// The panel's environment variables: the site's (production Worker) and the build's (GitHub Actions)
apiRoutes.get('/projects/:id/variables', async (c) => {
  const db = createDb(c.env.DB);
  const { project, role } = await projectAccess(db, c.req.param('id'), c.get('user'));
  return c.json({ variables: await listVariables(db, project), canEdit: role === 'owner' });
});

apiRoutes.put('/projects/:id/variables', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  // A parse error would quote the body, the value included: it is never logged
  const body = variableBody.parse(
    await c.req.json().catch(() => {
      throw badRequest('The body must be JSON.');
    }),
  );
  await setVariable(db, c.env, project, body);
  await audit(db, {
    ...auditActor(user, access),
    action: 'variable.set',
    target: project.id,
    metadata: { key: body.key, target: body.target, secret: body.secret },
  });
  return c.json({ variables: await listVariables(db, project) });
});

apiRoutes.delete('/projects/:id/variables', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const input = z
    .object({ target: z.enum(['runtime', 'build']), key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/) })
    .parse({ target: c.req.query('target'), key: c.req.query('key') });
  await deleteVariable(db, c.env, project, input);
  await audit(db, {
    ...auditActor(user, access),
    action: 'variable.delete',
    target: project.id,
    metadata: input,
  });
  return c.json({ variables: await listVariables(db, project) });
});

const protectionBody = z.object({
  type: z.enum(['none', 'basic']),
  users: z
    .array(
      z.object({
        username: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[^:\s]+$/, 'Usernames cannot have spaces or ":".'),
        password: z.string().min(1).max(200).optional(),
      }),
    )
    .max(50)
    .default([]),
  bypassPaths: z
    .array(
      z
        .string()
        .min(1)
        .max(300)
        .regex(/^\/[^\s]*$/, 'Paths start with "/".'),
    )
    .max(50)
    .default([]),
});

// Builds: the repository's GitHub Actions runs (the deploys) and their logs
apiRoutes.get('/projects/:id/builds', async (c) => {
  const db = createDb(c.env.DB);
  const { project } = await projectAccess(db, c.req.param('id'), c.get('user'));
  return c.json({ builds: await listBuilds(db, c.env, project) });
});

apiRoutes.get('/projects/:id/builds/:runId', async (c) => {
  const db = createDb(c.env.DB);
  const { project } = await projectAccess(db, c.req.param('id'), c.get('user'));
  const runId = z.coerce.number().int().positive().parse(c.req.param('runId'));
  return c.json({ jobs: await buildJobs(db, c.env, project, runId) });
});

// Custom domains of the site
apiRoutes.get('/projects/:id/domains', async (c) => {
  const db = createDb(c.env.DB);
  const { project, role } = await projectAccess(db, c.req.param('id'), c.get('user'));
  return c.json({
    ...(await domainsView(db, c.env, project)),
    canEdit: role === 'owner' && project.mode !== 'managed',
  });
});

apiRoutes.post('/projects/:id/domains', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const { hostname } = z.object({ hostname: z.string().min(3).max(253) }).parse(await c.req.json());
  await addDomain(db, c.env, project, hostname);
  await audit(db, {
    ...auditActor(user, access),
    action: 'domain.add',
    target: project.id,
    metadata: { hostname },
  });
  return c.json({ ...(await domainsView(db, c.env, project)), canEdit: true }, 201);
});

apiRoutes.delete('/projects/:id/domains/:domainId', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  await removeDomain(db, c.env, project, c.req.param('domainId'));
  await audit(db, {
    ...auditActor(user, access),
    action: 'domain.remove',
    target: project.id,
    metadata: { domainId: c.req.param('domainId') },
  });
  return c.json({ ...(await domainsView(db, c.env, project)), canEdit: true });
});

// Site protection (Basic Auth)
apiRoutes.get('/projects/:id/protection', async (c) => {
  const db = createDb(c.env.DB);
  const { project, role } = await projectAccess(db, c.req.param('id'), c.get('user'));
  return c.json({ protection: await protectionView(db, c.env, project), canEdit: role === 'owner' });
});

apiRoutes.put('/projects/:id/protection', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const body = protectionBody.parse(await c.req.json());
  await setProtection(db, c.env, project, body);
  await audit(db, {
    ...auditActor(user, access),
    action: 'protection.set',
    target: project.id,
    metadata: { type: body.type, users: body.users.map((entry) => entry.username), bypassPaths: body.bypassPaths },
  });
  return c.json({ protection: await protectionView(db, c.env, project) });
});

// Runtime variables: plain values apply on the next deploy; secrets apply right away to deployed branches
apiRoutes.put('/projects/:id/env', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const body = envVarBody.parse(await c.req.json());

  if (body.isSecret) {
    await setRuntimeSecret(db, c.env, deps.cloudflare(c.env), project, body.branch, body.key, body.value);
  } else {
    await deleteRuntimeSecret(db, c.env, deps.cloudflare(c.env), project, body.branch, body.key);
    await db
      .insert(envVars)
      .values({
        id: randomId('v_', 16),
        projectId: project.id,
        branch: body.branch,
        key: body.key,
        target: 'runtime',
        isSecret: false,
        value: body.value,
      })
      .onConflictDoUpdate({
        target: [envVars.projectId, envVars.branch, envVars.key, envVars.target],
        set: { isSecret: false, value: body.value, updatedAt: new Date() },
      })
      .run();
  }
  await audit(db, {
    ...auditActor(user, access),
    action: 'env.set',
    target: project.id,
    metadata: { key: body.key, branch: body.branch, isSecret: body.isSecret },
  });
  return c.json({ ok: true, appliesOnNextDeploy: !body.isSecret });
});

apiRoutes.delete('/projects/:id/env', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user, 'owner');
  const key = c.req.query('key') ?? '';
  const branch = c.req.query('branch') ?? ALL_BRANCHES;
  await deleteRuntimeSecret(db, c.env, deps.cloudflare(c.env), project, branch, key);
  await db
    .delete(envVars)
    .where(and(eq(envVars.projectId, project.id), eq(envVars.branch, branch), eq(envVars.key, key)))
    .run();
  await audit(db, {
    ...auditActor(user, access),
    action: 'env.delete',
    target: project.id,
    metadata: { key, branch },
  });
  return c.json({ ok: true });
});

// Publishes an earlier deployment again (rollback)
apiRoutes.post('/projects/:id/deployments/:deploymentId/redeploy', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, access } = await projectAccess(db, c.req.param('id'), user);
  const deployment = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, c.req.param('deploymentId')), eq(deployments.projectId, project.id)))
    .get();
  if (deployment === undefined) throw notFound('Deployment not found.');
  return c.json(
    await redeploy(
      db,
      c.env,
      deps.cloudflare(c.env),
      project,
      deployment,
      user.id,
      auditActor(user, access).actor,
      (task) => inBackground(c, task),
    ),
  );
});
