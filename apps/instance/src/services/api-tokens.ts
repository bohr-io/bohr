// API tokens for the CLI, scripts and AI agents (schema: api_tokens). A token acts as its user, on the projects
// the user is a member of (an org's projects through the org), intersected with the projects the token lists.
// The instance admin role never comes with a token: an agent's token cannot reach other people's projects.
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Project } from '../db/client';
import { apiTokens, hostnames, orgMembers, projectMembers, projects, users } from '../db/schema';
import type { User } from '../env';
import { projectRole } from '../lib/access';
import { inChunks } from '../lib/chunks';
import { randomId, sha256Hex } from '../lib/crypto';
import { badRequest, notFound, unauthorized } from '../lib/http';
import { audit } from './audit';

export const TOKEN_PREFIX = 'bohr_';
/** Tokens a user may have at once. */
export const MAX_TOKENS = 50;
/** last_used_at is written at most this often per token. */
const LAST_USED_RESOLUTION_MS = 60_000;

export type ApiToken = typeof apiTokens.$inferSelect;
export type TokenCaller = { user: User; token: ApiToken };

export const tokenNameSchema = z.string().trim().min(1, 'Give the token a name.').max(100);

/** A new token: "bohr_" and 40 random characters of [a-z0-9] (about 206 bits). */
export function generateToken() {
  return `${TOKEN_PREFIX}${randomId('', 40)}`;
}

export async function createApiToken(
  db: Db,
  input: {
    userId: string;
    name: string;
    /** null: every project the user can reach. */
    projectIds: string[] | null;
    expiresAt: Date | null;
    source: ApiToken['source'];
  },
) {
  const token = generateToken();
  const row: typeof apiTokens.$inferInsert = {
    id: randomId('tok_', 16),
    userId: input.userId,
    name: input.name,
    tokenHash: await sha256Hex(token),
    hint: `${token.slice(0, TOKEN_PREFIX.length + 4)}…`,
    projectIds: input.projectIds,
    source: input.source,
    expiresAt: input.expiresAt,
  };
  await db.insert(apiTokens).values(row).run();
  await audit(db, {
    actor: `user:${input.userId}`,
    actorUserId: input.userId,
    action: 'token.create',
    target: row.id,
    metadata: { name: input.name, source: input.source, projects: input.projectIds, expiresAt: input.expiresAt },
  });
  const stored = await db.select().from(apiTokens).where(eq(apiTokens.id, row.id)).get();
  if (stored === undefined) throw new Error('The token was not stored.');
  return { token, row: stored };
}

/**
 * The user and token of an `Authorization: Bearer bohr_…` header, or 401. The token is found by its sha256, so
 * the lookup reveals nothing about tokens that do not match.
 */
export async function authenticateToken(db: Db, authorization: string | undefined, now = new Date()) {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (token === undefined || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    throw unauthorized('Send a bohr token: Authorization: Bearer bohr_…');
  }
  const found = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, await sha256Hex(token)),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .get();
  if (found === undefined)
    throw unauthorized('This bohr token is not valid: it expired, was revoked or never existed.');
  if (found.token.lastUsedAt === null || now.getTime() - found.token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, found.token.id)).run();
  }
  return found satisfies TokenCaller;
}

/** Whether the token lists the project (or lists none: all of them). */
export function tokenAllows(token: ApiToken, projectId: string) {
  return token.projectIds === null || token.projectIds.includes(projectId);
}

/**
 * A project the token may act on, with the user's role in it; "not found" when the user is not a member (the
 * admin role does not count) or the token does not list it.
 */
export async function tokenProjectAccess(db: Db, caller: TokenCaller, projectId: string) {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (project === undefined || !tokenAllows(caller.token, project.id)) throw notFound('Project not found.');
  const role = await projectRole(db, project, caller.user.id);
  if (role === null) throw notFound('Project not found.');
  return { project, role };
}

/** Every project the user is a member of, directly or through an organization, with their role. */
export async function memberProjects(db: Db, userId: string) {
  const [direct, orgIds] = await Promise.all([
    db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId)).all(),
    db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
      .all(),
  ]);
  const ids = new Set(direct.map((row) => row.id));
  const orgProjects =
    orgIds.length > 0
      ? await inChunks(
          orgIds.map((row) => row.orgId),
          (chunk) => db.select({ id: projects.id }).from(projects).where(inArray(projects.orgId, chunk)).all(),
        )
      : [];
  for (const row of orgProjects) ids.add(row.id);
  const rows =
    ids.size > 0
      ? await inChunks([...ids], (chunk) => db.select().from(projects).where(inArray(projects.id, chunk)).all())
      : [];
  const withRoles = await Promise.all(
    rows.map(async (project) => ({ project, role: (await projectRole(db, project, userId)) ?? 'member' })),
  );
  return withRoles.sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** How the CLI sees a project: what it needs to choose where and whether to deploy. */
export async function cliProjectViews(db: Db, rows: { project: Project; role: 'owner' | 'member' }[]) {
  const ids = rows.map((row) => row.project.id);
  const hosts =
    ids.length > 0
      ? await inChunks(ids, (chunk) => db.select().from(hostnames).where(inArray(hostnames.projectId, chunk)).all())
      : [];
  return rows.map(({ project, role }) => {
    const production = hosts.find((host) => host.projectId === project.id && host.isProduction);
    return {
      id: project.id,
      name: project.name,
      repository: `${project.repoOwner}/${project.repoName}`,
      productionBranch: project.productionBranch,
      mode: project.mode,
      status: project.status,
      role,
      productionUrl: production ? `https://${production.hostname.replace(/^\*\./, '')}` : null,
      hostnames: hosts
        .filter((host) => host.projectId === project.id)
        .map(({ hostname, branch, isProduction, status }) => ({ hostname, branch, isProduction, status })),
    };
  });
}

/** The tokens of a user for the panel, with the names of the projects they list. Never the token itself. */
export async function tokensView(db: Db, userId: string, now = new Date()) {
  const [rows, reachable] = await Promise.all([
    db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).all(),
    memberProjects(db, userId),
  ]);
  const names = new Map(reachable.map(({ project }) => [project.id, project.name]));
  return {
    tokens: rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        name: row.name,
        hint: row.hint,
        source: row.source,
        // A project the user no longer reaches is listed without its name
        projects: row.projectIds === null ? null : row.projectIds.map((id) => ({ id, name: names.get(id) ?? null })),
        expiresAt: row.expiresAt,
        expired: row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime(),
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
      })),
    // What a new token may list
    projects: reachable.map(({ project }) => ({
      id: project.id,
      name: project.name,
      repository: `${project.repoOwner}/${project.repoName}`,
    })),
  };
}

export const newTokenSchema = z.object({
  name: tokenNameSchema,
  // null: all my projects
  projectIds: z.array(z.string().min(1).max(100)).min(1).max(200).nullable(),
  // null: never
  expiresInDays: z.number().int().min(1).max(3650).nullable(),
});

/** A token made in the panel, for a script or an AI agent. Only projects the user reaches may be listed. */
export async function createPanelToken(db: Db, userId: string, body: unknown, now = new Date()) {
  const input = newTokenSchema.parse(body);
  const count = (await db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.userId, userId)).all())
    .length;
  if (count >= MAX_TOKENS) throw badRequest(`You have ${MAX_TOKENS} tokens already: revoke some first.`);
  let projectIds: string[] | null = null;
  if (input.projectIds !== null) {
    const reachable = new Set((await memberProjects(db, userId)).map(({ project }) => project.id));
    projectIds = [...new Set(input.projectIds)];
    if (projectIds.some((id) => !reachable.has(id))) throw badRequest('Choose among your projects.');
  }
  return createApiToken(db, {
    userId,
    name: input.name,
    projectIds,
    expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * 86_400_000),
    source: 'panel',
  });
}

/** Revokes one of the user's tokens; 404 for anyone else's. */
export async function revokeToken(db: Db, userId: string, tokenId: string, actor = `user:${userId}`) {
  const row = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .get();
  if (row === undefined) throw notFound('Token not found.');
  await db.delete(apiTokens).where(eq(apiTokens.id, row.id)).run();
  await audit(db, { actor, actorUserId: userId, action: 'token.revoke', target: row.id, metadata: { name: row.name } });
}
