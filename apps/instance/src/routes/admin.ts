import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb, type Db, type Project } from '../db/client';
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
  siteConfig,
  subscriptions,
  users,
  v1Migrations,
} from '../db/schema';
import { deps } from '../deps';
import type { AppEnv, Env } from '../env';
import { randomId, safeEqual } from '../lib/crypto';
import { badRequest, conflict, HttpError, notFound, unauthorized } from '../lib/http';
import { isValidHostname, scriptName } from '../lib/names';
import { audit } from '../services/audit';
import {
  buildPlanSchema,
  buildVariablesSchema,
  deleteBuildPlan,
  readBuildPlan,
  saveBuildPlan,
  saveBuildVariables,
} from '../services/build-plans';
import { importZones, zoneImportSchema } from '../services/dns';
import { recordInstallation } from '../services/onboarding';
import { syncMembers } from '../services/orgs';
import { startImport } from '../services/provision';
import { rewrapAll } from '../services/rotation';
import { cutoverHostname, rollbackHostname, writeProjectRoutes } from '../services/routing';
import { setRuntimeSecret } from '../services/secrets';
import { normalizeEmail, publicUser, upsertGithubUser } from '../services/users';
import { syncCustomer } from './billing';

// Operator API (migration from bohr v1 and support), authenticated with ADMIN_TOKEN
const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  if (expected === undefined || expected.length < 32) throw new HttpError(503, 'The admin API is not configured.');
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (token === undefined || !(await safeEqual(token, expected))) throw unauthorized('Invalid admin token.');
  await next();
});

const githubUser = z.object({
  githubId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  login: z.string().min(1).max(39),
  name: z.string().max(255).nullish(),
  email: z.string().max(320).nullish(),
});

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('basic'),
    users: z
      .array(
        z.object({
          username: z.string().min(1).max(255),
          salt: z.string().min(16),
          hash: z.string().min(32),
          iterations: z.number().int().min(1000).max(100_000),
        }),
      )
      .min(1)
      .max(50),
    bypassPaths: z.array(z.string().startsWith('/')).max(100).optional(),
  }),
]);

const importSchema = z.object({
  projects: z
    .array(
      z.object({
        repoOwner: z.string().min(1).max(100),
        repoName: z.string().min(1).max(100),
        productionBranch: z.string().min(1).max(255).default('main'),
        owner: githubUser,
        members: z.array(githubUser).max(200).default([]),
        hostnames: z
          .array(
            z.object({
              hostname: z
                .string()
                .transform((value) => value.toLowerCase())
                .refine(isValidHostname, 'Invalid hostname'),
              branch: z.string().min(1).max(255),
              isProduction: z.boolean().default(false),
              zoneId: z.string().max(64).optional(),
            }),
          )
          .max(100)
          .default([]),
        config: z
          .array(
            z.object({
              branch: z.string().min(1).max(255).default(ALL_BRANCHES),
              auth: authSchema.optional(),
              headers: z.record(z.string(), z.string().max(4096)).optional(),
            }),
          )
          .max(100)
          .default([]),
        envVars: z
          .array(
            z.object({
              key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
              branch: z.string().min(1).max(255).default(ALL_BRANCHES),
              target: z.enum(['runtime', 'build']),
              isSecret: z.boolean(),
              value: z.string().max(5120).optional(),
            }),
          )
          .max(500)
          .default([]),
        v1SiteId: z.string().max(64).optional(),
        // A repository of a GitHub organization: the project belongs to that org in bohr (created when needed)
        org: z
          .object({
            githubId: z.number().int().positive(),
            login: z.string().min(1).max(39),
            name: z.string().max(255).nullish(),
            installationId: z.number().int().positive().nullish(),
          })
          .optional(),
        // The v1 payer's Stripe customer: their subscription and price carry over as legacy
        stripeCustomerId: z
          .string()
          .regex(/^cus_[A-Za-z0-9]+$/)
          .optional(),
      }),
    )
    .min(1)
    .max(200),
});

type ImportedProject = z.infer<typeof importSchema>['projects'][number];

type ImportedMember = { githubId: number; login: string; userId: string };

/**
 * The bohr org of a migrated repository's GitHub organization: found by its GitHub id or created, with the
 * v1 payer as an admin and the v1 members as members (all of them bohr users after the import), and the
 * GitHub App installation when v1 knew it. GitHub's own roles replace these at the next member sync, when the
 * installation grants Members: read.
 */
async function importOrg(
  db: Db,
  env: Env,
  input: NonNullable<ImportedProject['org']>,
  owner: ImportedMember,
  members: ImportedMember[],
): Promise<string> {
  let org = await db.select().from(orgs).where(eq(orgs.githubAccountId, input.githubId)).get();
  if (org === undefined) {
    const base = input.login.toLowerCase();
    const taken = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, base)).get();
    const id = randomId('o_', 16);
    if (input.installationId != null) {
      await recordInstallation(db, { id: input.installationId, account: { login: input.login, type: 'Organization' } });
    }
    await db
      .insert(orgs)
      .values({
        id,
        slug: taken === undefined ? base : `${base}-${input.githubId}`,
        name: input.name || input.login,
        githubAccountId: input.githubId,
        githubLogin: input.login,
        installationId: input.installationId ?? null,
      })
      .run();
    await audit(db, {
      actor: 'admin',
      action: 'org.import',
      target: `org:${id}`,
      metadata: { githubLogin: input.login },
    });
    org = await db.select().from(orgs).where(eq(orgs.id, id)).get();
  }
  if (org === undefined) throw new Error('Organization insert failed.');
  for (const [person, role] of [[owner, 'admin'] as const, ...members.map((member) => [member, 'member'] as const)]) {
    await db
      .insert(orgMembers)
      .values({
        orgId: org.id,
        githubUserId: person.githubId,
        githubLogin: person.login,
        userId: person.userId,
        role,
        status: 'active',
        source: 'bohr',
      })
      .onConflictDoNothing()
      .run();
  }
  if (org.installationId !== null) {
    await syncMembers(db, env, org).catch((error: unknown) => console.error('[import] org member sync failed:', error));
  }
  return org.id;
}

async function importProject(db: Db, env: Env, input: ImportedProject) {
  const repoKey = `${input.repoOwner}/${input.repoName}`.toLowerCase();
  const ownerUserId = await upsertGithubUser(db, input.owner);
  if (input.stripeCustomerId !== undefined) {
    await db
      .insert(subscriptions)
      .values({
        id: randomId('sub_', 16),
        userId: ownerUserId,
        stripeCustomerId: input.stripeCustomerId,
        status: 'imported',
        legacy: true,
      })
      .onConflictDoNothing()
      .run();
  }

  let project = await db.select().from(projects).where(eq(projects.repoKey, repoKey)).get();
  // A repository someone already brought to v2 in their own account is theirs now: the migration leaves it
  if (project?.mode === 'byo') throw conflict(`${repoKey} is already a project in its owner's Cloudflare account.`);
  if (project === undefined) {
    const id = randomId('p', 11);
    await db
      .insert(projects)
      .values({
        id,
        ownerUserId,
        name: input.repoName,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        repoKey,
        productionBranch: input.productionBranch,
        mode: 'managed',
        status: 'migrating',
      })
      .run();
    project = await db.select().from(projects).where(eq(projects.id, id)).get();
  } else {
    await db
      .update(projects)
      .set({ productionBranch: input.productionBranch, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .run();
  }
  if (project === undefined) throw new Error('Project insert failed.');

  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: ownerUserId, role: 'owner' })
    .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: 'owner' } })
    .run();
  const members: { githubId: number; login: string; userId: string }[] = [];
  for (const member of input.members) {
    const userId = await upsertGithubUser(db, member);
    if (userId === ownerUserId) continue;
    members.push({ githubId: Number(member.githubId), login: member.login, userId });
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId, role: 'member' })
      .onConflictDoNothing()
      .run();
  }
  if (input.org !== undefined) {
    const owner = { githubId: Number(input.owner.githubId), login: input.owner.login, userId: ownerUserId };
    const orgId = await importOrg(db, env, input.org, owner, members);
    if (project.orgId !== orgId) {
      await db.update(projects).set({ orgId, updatedAt: new Date() }).where(eq(projects.id, project.id)).run();
      project = { ...project, orgId };
    }
  }

  for (const host of input.hostnames) {
    const existing = await db.select().from(hostnames).where(eq(hostnames.hostname, host.hostname)).get();
    if (existing !== undefined && existing.projectId !== project.id) {
      throw conflict(`${host.hostname} already belongs to another project.`);
    }
    if (existing === undefined) {
      await db
        .insert(hostnames)
        .values({
          hostname: host.hostname,
          projectId: project.id,
          branch: host.branch,
          isProduction: host.isProduction,
          zoneId: host.zoneId ?? null,
        })
        .run();
    } else {
      await db
        .update(hostnames)
        .set({ branch: host.branch, isProduction: host.isProduction, zoneId: host.zoneId ?? existing.zoneId })
        .where(eq(hostnames.hostname, host.hostname))
        .run();
    }
  }

  for (const config of input.config) {
    await db
      .insert(siteConfig)
      .values({
        projectId: project.id,
        branch: config.branch,
        auth: config.auth ?? null,
        headers: config.headers ?? null,
      })
      .onConflictDoUpdate({
        target: [siteConfig.projectId, siteConfig.branch],
        set: { auth: config.auth ?? null, headers: config.headers ?? null, updatedAt: new Date() },
      })
      .run();
  }

  for (const variable of input.envVars) {
    if (variable.isSecret && variable.value !== undefined) {
      throw badRequest(`Secret ${variable.key} must be sent to /projects/:id/secrets, not imported in plain text.`);
    }
    await db
      .insert(envVars)
      .values({
        id: randomId('v_', 16),
        projectId: project.id,
        branch: variable.branch,
        key: variable.key,
        target: variable.target,
        isSecret: variable.isSecret,
        value: variable.isSecret ? null : (variable.value ?? ''),
      })
      .onConflictDoUpdate({
        target: [envVars.projectId, envVars.branch, envVars.key, envVars.target],
        set: {
          isSecret: variable.isSecret,
          value: variable.isSecret ? null : (variable.value ?? ''),
          updatedAt: new Date(),
        },
      })
      .run();
  }

  await db
    .insert(v1Migrations)
    .values({ projectId: project.id, v1SiteId: input.v1SiteId ?? null, status: 'imported' })
    .onConflictDoUpdate({
      target: v1Migrations.projectId,
      set: { v1SiteId: input.v1SiteId ?? null, updatedAt: new Date() },
    })
    .run();

  return project;
}

async function adminProject(db: Db, id: string) {
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (project === undefined) throw notFound('Project not found.');
  return project;
}

async function selectedHostnames(db: Db, project: Project, requested: string[] | undefined) {
  const rows = await db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all();
  if (requested === undefined) return rows;
  const wanted = new Set(requested.map((hostname) => hostname.toLowerCase()));
  const selected = rows.filter((row) => wanted.has(row.hostname));
  if (selected.length !== wanted.size) throw badRequest('Some hostnames do not belong to this project.');
  return selected;
}

const hostnamesBody = z.object({ hostnames: z.array(z.string()).max(100).optional() });

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAdmin);

// Organizations from bohr v1 without projects of their own in the import (or before them): the org, its admins
// and members (bohr users from their GitHub accounts) and the App installation v1 knew
const orgImportSchema = z.object({
  orgs: z
    .array(
      z.object({
        githubId: z.number().int().positive(),
        login: z.string().min(1).max(39),
        name: z.string().max(255).nullish(),
        installationId: z.number().int().positive().nullish(),
        admins: z.array(githubUser).min(1).max(200),
        members: z.array(githubUser).max(500).default([]),
      }),
    )
    .min(1)
    .max(50),
});

adminRoutes.post('/orgs', async (c) => {
  const db = createDb(c.env.DB);
  const body = orgImportSchema.parse(await c.req.json());
  const results = [];
  for (const input of body.orgs) {
    const people = async (list: z.infer<typeof githubUser>[]) => {
      const refs: ImportedMember[] = [];
      for (const person of list) {
        refs.push({
          githubId: Number(person.githubId),
          login: person.login,
          userId: await upsertGithubUser(db, person),
        });
      }
      return refs;
    };
    const [first, ...otherAdmins] = await people(input.admins);
    const members = await people(input.members);
    if (first === undefined) continue;
    const orgId = await importOrg(db, c.env, input, first, members);
    // The other admins: importOrg adds everyone after the first as members
    for (const admin of otherAdmins) {
      await db
        .insert(orgMembers)
        .values({
          orgId,
          githubUserId: admin.githubId,
          githubLogin: admin.login,
          userId: admin.userId,
          role: 'admin',
          status: 'active',
          source: 'bohr',
        })
        .onConflictDoUpdate({
          target: [orgMembers.orgId, orgMembers.githubUserId],
          set: { role: 'admin', updatedAt: new Date() },
        })
        .run();
    }
    results.push({ login: input.login, orgId });
  }
  return c.json({ orgs: results });
});

// DNS zones bohr v1 kept in bohr's Cloudflare account, and whose they are (a person or an organization); their
// records stay in Cloudflare (services/dns.ts). Zones that cannot be imported come back skipped, with the reason.
adminRoutes.post('/dns-zones', async (c) => {
  const db = createDb(c.env.DB);
  const body = zoneImportSchema.parse(await c.req.json());
  return c.json({ zones: await importZones(db, c.env, body) });
});

adminRoutes.post('/import', async (c) => {
  const db = createDb(c.env.DB);
  const body = importSchema.parse(await c.req.json());
  const results = [];
  for (const input of body.projects) {
    const project = await importProject(db, c.env, input);
    await writeProjectRoutes(db, c.env, project);
    const branches = [...new Set([project.productionBranch, ...input.hostnames.map((host) => host.branch)])];
    results.push({
      repository: `${project.repoOwner}/${project.repoName}`,
      projectId: project.id,
      scripts: Object.fromEntries(await Promise.all(branches.map(async (b) => [b, await scriptName(project.id, b)]))),
    });
  }
  await audit(db, { actor: 'admin', action: 'import', metadata: { projects: results.map((r) => r.projectId) } });
  return c.json({ projects: results });
});

adminRoutes.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(projects).orderBy(projects.repoKey).all();
  // Every project: the related rows of all of them (D1 binds at most 100 parameters, so no IN lists here)
  const [hosts, migrations, recent] = await Promise.all([
    db.select().from(hostnames).all(),
    db.select().from(v1Migrations).all(),
    db
      .select()
      .from(deployments)
      .where(
        sql`${deployments.createdAt} = (SELECT MAX(d2.created_at) FROM deployments d2 WHERE d2.project_id = ${deployments.projectId})`,
      )
      .all(),
  ]);
  return c.json({
    projects: rows.map((project) => ({
      id: project.id,
      repository: `${project.repoOwner}/${project.repoName}`,
      status: project.status,
      migration: migrations.find((m) => m.projectId === project.id)?.status ?? null,
      hostnames: hosts
        .filter((host) => host.projectId === project.id)
        .map(({ hostname, branch, status }) => ({ hostname, branch, status })),
      lastDeployment: recent.find((d) => d.projectId === project.id) ?? null,
    })),
  });
});

// Secrets imported from v1 (or set by support); stored encrypted and bound on every deploy
adminRoutes.post('/projects/:id/secrets', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  const body = z
    .object({
      branch: z.string().min(1).max(255).default(ALL_BRANCHES),
      name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      value: z.string().max(5120),
    })
    .parse(await c.req.json());
  await setRuntimeSecret(db, c.env, deps.cloudflare(c.env), project, body.branch, body.name, body.value);
  await audit(db, {
    actor: 'admin',
    action: 'secret.set',
    target: project.id,
    metadata: { name: body.name, branch: body.branch },
  });
  return c.json({ ok: true });
});

// How a project bohr hosts builds when its repository keeps bohr v1's workflow (services/build-plans.ts)
adminRoutes.put('/projects/:id/build-plan', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  const body = await c.req.json().catch(() => {
    throw badRequest('The body must be JSON.');
  });
  await saveBuildPlan(db, project, buildPlanSchema.parse(body));
  return c.json({ ok: true });
});

adminRoutes.get('/projects/:id/build-plan', async (c) => {
  const db = createDb(c.env.DB);
  const plan = await readBuildPlan(db, await adminProject(db, c.req.param('id')));
  if (plan === null) throw notFound('This project has no build plan.');
  return c.json(plan);
});

adminRoutes.delete('/projects/:id/build-plan', async (c) => {
  const db = createDb(c.env.DB);
  await deleteBuildPlan(db, await adminProject(db, c.req.param('id')));
  return c.json({ ok: true });
});

// Build variables of a project bohr hosts, sealed in bohr for a branch or every branch ('*')
adminRoutes.put('/projects/:id/build-variables', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  // A parse error would quote the body, values included: it is never logged
  const body = await c.req.json().catch(() => {
    throw badRequest('The body must be JSON.');
  });
  await saveBuildVariables(db, c.env, project, buildVariablesSchema.parse(body));
  return c.json({ ok: true });
});

// Moves traffic to the dispatcher; each hostname's branch must have a successful deploy
adminRoutes.post('/projects/:id/cutover', async (c) => {
  const db = createDb(c.env.DB);
  const cf = deps.cloudflare(c.env);
  const project = await adminProject(db, c.req.param('id'));
  const body = hostnamesBody.parse(await c.req.json().catch(() => ({})));
  const rows = await selectedHostnames(db, project, body.hostnames);

  const deployed = new Set(
    (
      await db
        .selectDistinct({ branch: deployments.branch })
        .from(deployments)
        .where(and(eq(deployments.projectId, project.id), eq(deployments.status, 'success')))
        .all()
    ).map((row) => row.branch),
  );
  const missing = rows.filter((row) => !deployed.has(row.branch)).map((row) => row.hostname);
  if (missing.length > 0) throw conflict(`Deploy these hostnames' branches first: ${missing.join(', ')}`);

  await writeProjectRoutes(db, c.env, project);
  const changes = [];
  for (const row of rows) changes.push({ hostname: row.hostname, ...(await cutoverHostname(db, c.env, cf, row)) });

  const remaining = await db
    .select()
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.status, 'pending')))
    .all();
  // Live once production is: v1 addresses of other branches move when those branches deploy here (deploy.ts)
  if (remaining.every((row) => !row.isProduction)) {
    await db.batch([
      db.update(projects).set({ status: 'active', updatedAt: new Date() }).where(eq(projects.id, project.id)),
      db
        .update(v1Migrations)
        .set({ status: 'live', updatedAt: new Date() })
        .where(eq(v1Migrations.projectId, project.id)),
    ]);
  }
  await audit(db, { actor: 'admin', action: 'cutover', target: project.id, metadata: { changes } });
  return c.json({ changes, pending: remaining.map((row) => row.hostname) });
});

// Sends traffic back to the v1 edge
adminRoutes.post('/projects/:id/rollback-cutover', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  const body = hostnamesBody.parse(await c.req.json().catch(() => ({})));
  const rows = (await selectedHostnames(db, project, body.hostnames)).filter((row) => row.status === 'live');
  for (const row of rows) await rollbackHostname(db, deps.cloudflare(c.env), row);
  await db.batch([
    db.update(projects).set({ status: 'migrating', updatedAt: new Date() }).where(eq(projects.id, project.id)),
    db
      .update(v1Migrations)
      .set({ status: 'rolled_back', updatedAt: new Date() })
      .where(eq(v1Migrations.projectId, project.id)),
  ]);
  await audit(db, {
    actor: 'admin',
    action: 'cutover.rollback',
    target: project.id,
    metadata: { hostnames: rows.map((r) => r.hostname) },
  });
  return c.json({ rolledBack: rows.map((row) => row.hostname) });
});

adminRoutes.post('/projects/:id/status', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  const { status } = z.object({ status: z.enum(['active', 'suspended', 'migrating']) }).parse(await c.req.json());
  await db.update(projects).set({ status, updatedAt: new Date() }).where(eq(projects.id, project.id)).run();
  await writeProjectRoutes(db, c.env, { ...project, status });
  await audit(db, { actor: 'admin', action: 'project.status', target: project.id, metadata: { status } });
  return c.json({ ok: true });
});

// Asks a project's agent to prepare its repository (when the automatic start after provisioning failed)
adminRoutes.post('/projects/:id/runtime/import', async (c) => {
  const db = createDb(c.env.DB);
  const project = await adminProject(db, c.req.param('id'));
  await startImport(db, c.env, project.id);
  await audit(db, { actor: 'admin', action: 'runtime.import', target: project.id });
  return c.json({ started: true });
});

// Pulls the current status of every subscription from Stripe (after an import, or to repair missed webhooks)
adminRoutes.post('/billing/sync', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) throw new HttpError(404, 'Billing is not enabled on this instance.');
  const db = createDb(c.env.DB);
  const rows = await db.select().from(subscriptions).all();
  const results = [];
  for (const row of rows) {
    results.push({
      customer: row.stripeCustomerId,
      status: await syncCustomer(db, c.env, row.userId, row.stripeCustomerId, row.legacy),
    });
  }
  await audit(db, { actor: 'admin', action: 'billing.sync', metadata: { customers: results.length } });
  return c.json({ subscriptions: results });
});

// Makes a user an admin of the panel (or takes it back): by id, GitHub login or email address
adminRoutes.post('/users/role', async (c) => {
  const db = createDb(c.env.DB);
  const input = z
    .object({
      userId: z.string().min(1).max(100).optional(),
      githubLogin: z.string().min(1).max(39).optional(),
      email: z.string().min(3).max(254).optional(),
      role: z.enum(['user', 'admin']),
    })
    .refine((value) => [value.userId, value.githubLogin, value.email].filter(Boolean).length === 1, {
      message: 'Send one of userId, githubLogin or email.',
    })
    .parse(await c.req.json());
  let userId = input.userId;
  if (input.githubLogin !== undefined) {
    const identity = await db
      .select({ userId: identities.userId })
      .from(identities)
      .where(
        and(eq(identities.provider, 'github'), sql`lower(${identities.username}) = ${input.githubLogin.toLowerCase()}`),
      )
      .get();
    userId = identity?.userId;
  } else if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    const identity = await db
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.provider, 'email'), eq(identities.providerUserId, email)))
      .get();
    userId =
      identity?.userId ??
      (await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).get())?.id;
  }
  const user = userId === undefined ? undefined : await db.select().from(users).where(eq(users.id, userId)).get();
  if (user === undefined) throw notFound('User not found.');
  await db.update(users).set({ role: input.role }).where(eq(users.id, user.id)).run();
  await audit(db, { actor: 'admin', action: 'user.role', target: user.id, metadata: { role: input.role } });
  return c.json({ user: publicUser({ ...user, role: input.role }) });
});

// After a new master key goes in front of ENCRYPTION_KEY: re-seals everything under it
adminRoutes.post('/vault/rewrap', async (c) => {
  const result = await rewrapAll(createDb(c.env.DB), c.env);
  await audit(createDb(c.env.DB), { actor: 'admin', action: 'vault.rewrap', metadata: result });
  return c.json(result);
});
