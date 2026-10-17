import { and, count, desc, eq, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb, type Db, type Project } from '../db/client';
import {
  cfConnections,
  githubInstallations,
  hostnames,
  identities,
  orgMembers,
  orgs,
  projects,
  runtimes,
  subscriptions,
  users,
} from '../db/schema';
import type { AppEnv, User } from '../env';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { connectionsOf, userOwner } from '../lib/owner';
import { deleteAccount } from '../services/accounts';
import { agentSettings } from '../services/agent-settings';
import { audit } from '../services/audit';
import { userOrgs } from '../services/orgs';
import { updateOutdatedRuntimes } from '../services/runtime-updates';
import { requireUser } from './api';

// The admin panel's API: signed-in users with the admin role (the operator API with ADMIN_TOKEN is /api/admin)

/** requireUser, then 403 unless the user is an admin. */
export const requireAdminUser = createMiddleware<AppEnv>(async (c, next) => {
  await requireUser(c, async () => {
    if (c.get('user').role !== 'admin') throw forbidden('Only admins can do this.');
    await next();
  });
});

const PAGE_SIZE = 50;
const ACTIVE_SUBSCRIPTIONS = ['active', 'trialing', 'past_due'];

const listQuery = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** A LIKE pattern matching the text anywhere, with % and _ taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
const likeAny = (pattern: string, ...columns: SQL[]) =>
  sql.join(
    columns.map((column) => sql`${column} LIKE ${pattern} ESCAPE '\\'`),
    sql` OR `,
  );

type UserRow = typeof users.$inferSelect;

/** The users' rows as the panel lists them: identities, owned projects and subscription. */
async function userViews(db: Db, rows: UserRow[]) {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [ids_, owned, subs, memberships] = await Promise.all([
    db
      .select({ userId: identities.userId, provider: identities.provider, username: identities.username })
      .from(identities)
      .where(inArray(identities.userId, ids))
      .all(),
    db
      .select({ userId: projects.ownerUserId, total: count() })
      .from(projects)
      .where(inArray(projects.ownerUserId, ids))
      .groupBy(projects.ownerUserId)
      .all(),
    db
      .select({ userId: subscriptions.userId, status: subscriptions.status })
      .from(subscriptions)
      .where(and(inArray(subscriptions.userId, ids), isNull(subscriptions.orgId)))
      .all(),
    // The organizations each user is an active member of (the panel shows them as badges)
    db
      .select({ userId: orgMembers.userId, slug: orgs.slug, name: orgs.name })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
      .where(and(inArray(orgMembers.userId, ids), eq(orgMembers.status, 'active')))
      .orderBy(orgs.name)
      .all(),
  ]);
  return rows.map((row) => {
    const userSubs = subs.filter((sub) => sub.userId === row.id);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt,
      identities: ids_
        .filter((identity) => identity.userId === row.id)
        .map(({ provider, username }) => ({ provider, username })),
      projects: owned.find((entry) => entry.userId === row.id)?.total ?? 0,
      subscription: (userSubs.find((sub) => ACTIVE_SUBSCRIPTIONS.includes(sub.status)) ?? userSubs[0])?.status ?? null,
      orgs: memberships.filter((membership) => membership.userId === row.id).map(({ slug, name }) => ({ slug, name })),
    };
  });
}

/** Projects as the panel lists them: owner, organization, production address and runtime. */
async function projectRows(db: Db, rows: Project[]) {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const ownerIds = [...new Set(rows.map((row) => row.ownerUserId))];
  const orgIds = [...new Set(rows.map((row) => row.orgId).filter((id): id is string => id !== null))];
  const [owners, hosts, projectRuntimes, projectOrgs] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds))
      .all(),
    db
      .select()
      .from(hostnames)
      .where(and(inArray(hostnames.projectId, ids), eq(hostnames.isProduction, true)))
      .all(),
    db.select().from(runtimes).where(inArray(runtimes.projectId, ids)).all(),
    orgIds.length > 0
      ? db.select({ id: orgs.id, slug: orgs.slug, name: orgs.name }).from(orgs).where(inArray(orgs.id, orgIds)).all()
      : [],
  ]);
  return rows.map((project) => {
    const org = projectOrgs.find((entry) => entry.id === project.orgId);
    const host = hosts.find((entry) => entry.projectId === project.id);
    const runtime = projectRuntimes.find((entry) => entry.projectId === project.id);
    return {
      id: project.id,
      name: project.name,
      repository: `${project.repoOwner}/${project.repoName}`,
      owner: owners.find((owner) => owner.id === project.ownerUserId) ?? {
        id: project.ownerUserId,
        name: null,
        email: null,
      },
      org: org === undefined ? null : { slug: org.slug, name: org.name },
      mode: project.mode,
      status: project.status,
      createdAt: project.createdAt,
      productionUrl: host ? `https://${host.hostname.replace(/^\*\./, '')}` : null,
      runtime:
        runtime === undefined ? null : { status: runtime.status, version: runtime.version, error: runtime.error },
    };
  });
}

async function findUser(db: Db, id: string) {
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (user === undefined) throw notFound('User not found.');
  return user;
}

const adminActor = (user: User) => ({ actor: `admin:${user.id}`, actorUserId: user.id });

export const manageRoutes = new Hono<AppEnv>();
manageRoutes.use('*', requireAdminUser);

manageRoutes.get('/overview', async (c) => {
  const db = createDb(c.env.DB);
  const [userCount, projectCount, active, byStatus] = await Promise.all([
    db.select({ total: count() }).from(users).get(),
    db.select({ total: count() }).from(projects).get(),
    db
      .select({ total: sql<number>`count(distinct ${subscriptions.userId})` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ACTIVE_SUBSCRIPTIONS))
      .get(),
    db.select({ status: runtimes.status, total: count() }).from(runtimes).groupBy(runtimes.status).all(),
  ]);
  const runtimeCount = (status: string) => byStatus.find((row) => row.status === status)?.total ?? 0;
  return c.json({
    users: userCount?.total ?? 0,
    projects: projectCount?.total ?? 0,
    subscriptions: { active: active?.total ?? 0 },
    runtimes: {
      ready: runtimeCount('ready'),
      provisioning: runtimeCount('provisioning'),
      pending: runtimeCount('pending'),
      error: runtimeCount('error'),
    },
  });
});

manageRoutes.get('/users', async (c) => {
  const db = createDb(c.env.DB);
  const { query, page } = listQuery.parse(c.req.query());
  const pattern = query ? contains(query) : null;
  const where =
    pattern === null
      ? undefined
      : sql`(${likeAny(pattern, sql`${users.name}`, sql`${users.email}`, sql`${users.id}`)} OR EXISTS (SELECT 1 FROM ${identities} WHERE ${identities.userId} = ${users.id} AND ${identities.username} LIKE ${pattern} ESCAPE '\\'))`;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all(),
    db.select({ total: count() }).from(users).where(where).get(),
  ]);
  return c.json({ users: await userViews(db, rows), total: total?.total ?? 0 });
});

manageRoutes.get('/users/:id', async (c) => {
  const db = createDb(c.env.DB);
  const user = await findUser(db, c.req.param('id'));
  const [view] = await userViews(db, [user]);
  const [owned, installations, connections, telegram, agent, memberships] = await Promise.all([
    db.select().from(projects).where(eq(projects.ownerUserId, user.id)).orderBy(projects.name).all(),
    db
      .select({ id: githubInstallations.id, account: githubInstallations.accountLogin })
      .from(githubInstallations)
      .where(eq(githubInstallations.userId, user.id))
      .all(),
    db
      .select({ id: cfConnections.id, accountId: cfConnections.accountId, accountName: cfConnections.accountName })
      .from(cfConnections)
      .where(connectionsOf(userOwner(user.id)))
      .all(),
    db
      .select({ username: identities.username })
      .from(identities)
      .where(and(eq(identities.userId, user.id), eq(identities.provider, 'telegram')))
      .get(),
    agentSettings(db, c.env, user.id),
    userOrgs(db, user.id),
  ]);
  return c.json({
    user: view,
    projects: await projectRows(db, owned),
    orgs: memberships.map(({ org, role }) => ({ id: org.id, slug: org.slug, name: org.name, role })),
    connections: {
      githubInstallations: installations,
      cloudflare: connections,
      telegram: telegram === undefined ? null : { username: telegram.username },
      agent: { configured: agent !== null },
    },
  });
});

manageRoutes.put('/users/:id/role', async (c) => {
  const db = createDb(c.env.DB);
  const admin = c.get('user');
  const user = await findUser(db, c.req.param('id'));
  const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(await c.req.json());
  if (user.role === 'admin' && role !== 'admin') {
    const others = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), ne(users.id, user.id)))
      .get();
    if ((others?.total ?? 0) === 0) throw conflict('This is the last admin; make someone else an admin first.');
  }
  await db.update(users).set({ role }).where(eq(users.id, user.id)).run();
  await audit(db, { ...adminActor(admin), action: 'user.role', target: user.id, metadata: { role } });
  const [view] = await userViews(db, [{ ...user, role }]);
  return c.json({ user: view });
});

manageRoutes.delete('/users/:id', async (c) => {
  const db = createDb(c.env.DB);
  const admin = c.get('user');
  const user = await findUser(db, c.req.param('id'));
  if (user.id === admin.id) throw badRequest('To delete your own account, use DELETE /api/me.');
  const { deleteSites } = z
    .object({ deleteSites: z.boolean().default(false) })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await deleteAccount(db, c.env, user.id, { deleteSites, actor: adminActor(admin) }));
});

manageRoutes.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  const { query, page } = listQuery.parse(c.req.query());
  const pattern = query ? contains(query) : null;
  const where =
    pattern === null
      ? undefined
      : sql`(${likeAny(pattern, sql`${projects.name}`, sql`${projects.repoKey}`, sql`${projects.id}`, sql`${users.name}`, sql`${users.email}`)})`;
  const [rows, total] = await Promise.all([
    db
      .select({ project: projects })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.ownerUserId))
      .where(where)
      .orderBy(desc(projects.createdAt), projects.id)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all(),
    db.select({ total: count() }).from(projects).leftJoin(users, eq(users.id, projects.ownerUserId)).where(where).get(),
  ]);
  return c.json({
    projects: await projectRows(
      db,
      rows.map((row) => row.project),
    ),
    total: total?.total ?? 0,
  });
});

// Organizations: members (not removed), projects and subscription
manageRoutes.get('/orgs', async (c) => {
  const db = createDb(c.env.DB);
  const { query, page } = listQuery.parse(c.req.query());
  const pattern = query ? contains(query) : null;
  const where =
    pattern === null
      ? undefined
      : sql`(${likeAny(pattern, sql`${orgs.name}`, sql`${orgs.slug}`, sql`${orgs.githubLogin}`, sql`${orgs.id}`)})`;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(orgs)
      .where(where)
      .orderBy(desc(orgs.createdAt), orgs.id)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all(),
    db.select({ total: count() }).from(orgs).where(where).get(),
  ]);
  const ids = rows.map((row) => row.id);
  const [members, owned, subs] =
    ids.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({ orgId: orgMembers.orgId, total: count() })
            .from(orgMembers)
            .where(and(inArray(orgMembers.orgId, ids), ne(orgMembers.status, 'removed')))
            .groupBy(orgMembers.orgId)
            .all(),
          db
            .select({ orgId: projects.orgId, total: count() })
            .from(projects)
            .where(inArray(projects.orgId, ids))
            .groupBy(projects.orgId)
            .all(),
          db
            .select({ orgId: subscriptions.orgId, status: subscriptions.status })
            .from(subscriptions)
            .where(inArray(subscriptions.orgId, ids))
            .all(),
        ]);
  return c.json({
    orgs: rows.map((org) => {
      const orgSubs = subs.filter((sub) => sub.orgId === org.id);
      return {
        id: org.id,
        slug: org.slug,
        name: org.name,
        members: members.find((entry) => entry.orgId === org.id)?.total ?? 0,
        projects: owned.find((entry) => entry.orgId === org.id)?.total ?? 0,
        subscription: (orgSubs.find((sub) => ACTIVE_SUBSCRIPTIONS.includes(sub.status)) ?? orgSubs[0])?.status ?? null,
      };
    }),
    total: total?.total ?? 0,
  });
});

manageRoutes.post('/runtimes/update', async (c) => {
  const db = createDb(c.env.DB);
  const result = await updateOutdatedRuntimes(db, c.env);
  await audit(db, { ...adminActor(c.get('user')), action: 'runtimes.update', metadata: result });
  return c.json(result);
});
