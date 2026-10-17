import { memberKey, RUNTIME_API_PREFIX } from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb, type Db } from '../db/client';
import { identities, projectMembers, projects, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { AppEnv, User } from '../env';
import { projectRole } from '../lib/access';
import { HttpError, notFound } from '../lib/http';
import { audit } from '../services/audit';
import { signRuntimeToken } from '../services/runtime-keys';
import { requireUser } from './api';

// The web chat talks to a project's Worker through the instance: the instance vouches for the
// signed-in user with a short-lived JWT, and the project Worker decides what they may do.
export const agentRoutes = new Hono<AppEnv>();
agentRoutes.use('/projects/:id/agent/*', requireUser);

/** Access follows the Telegram user when the account has one, so it matches what the bot knows. */
export async function memberKeyFor(db: Db, user: User): Promise<string> {
  const telegram = await db
    .select({ providerUserId: identities.providerUserId })
    .from(identities)
    .where(and(eq(identities.userId, user.id), eq(identities.provider, 'telegram')))
    .get();
  return memberKey({
    telegramUserId: telegram === undefined ? null : Number(telegram.providerUserId),
    instanceUserId: user.id,
  });
}

agentRoutes.all('/projects/:id/agent/*', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const projectId = c.req.param('id');
  const row = await db
    .select({ project: projects, runtime: runtimes })
    .from(projects)
    .innerJoin(runtimes, eq(runtimes.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .get();
  if (row === undefined) throw notFound('Project not found.');
  if (row.runtime.status !== 'ready' || row.runtime.workerUrl === null) {
    throw new HttpError(409, 'The project is still being set up.');
  }

  const url = new URL(c.req.url);
  const rest = url.pathname.slice(url.pathname.indexOf('/agent') + '/agent'.length) || '/';
  // The Claude subscription sign-in answers with the token: only the instance calls it (/api/me/agent/subscription)
  if (rest === '/claude-login' || rest.startsWith('/claude-login/')) throw notFound();
  // Only members reach a project Worker (it runs in its owner's account, so its answers are not trusted
  // to be safe for this origin); anyone signed in may try an invite code.
  // Admins reach every project (owner-level access); what they change through it is audited.
  const joining = c.req.method === 'POST' && rest === '/join';
  let grant: 'owner' | 'member' | undefined;
  if (!joining) {
    // Organization projects: the org's members too (lib/access.ts)
    const role = await projectRole(db, row.project, user.id);
    // The project Worker only knows invited members: for an org project (and an admin's visit) the instance
    // vouches for the role, so it needs no invite code
    if (row.project.orgId !== null && role !== null) grant = role;
    else if (role === null && user.role === 'admin') grant = 'owner';
    if (role === null && user.role !== 'admin') throw notFound('Project not found.');
    if (role !== 'owner' && user.role === 'admin' && !['GET', 'HEAD'].includes(c.req.method)) {
      await audit(db, {
        actor: `admin:${user.id}`,
        actorUserId: user.id,
        action: 'agent.request',
        target: projectId,
        metadata: { method: c.req.method, path: rest },
      });
    }
  }
  const target = new URL(`${RUNTIME_API_PREFIX}${rest}${url.search}`, row.runtime.workerUrl);
  const key = await memberKeyFor(db, user);
  const token = await signRuntimeToken(db, c.env, {
    projectId,
    memberKey: key,
    // A project may know this person by their instance user key (before they linked Telegram)
    aliases: key === `u:${user.id}` ? [] : [`u:${user.id}`],
    name: user.name ?? 'bohr user',
    locale: c.req.header('Accept-Language')?.split(',')[0],
    ...(grant ? { grant } : {}),
  });
  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(c.req.method);
  const response = await deps.fetch(target, {
    method: c.req.method,
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: await c.req.text() } : {}),
  });
  // Whatever the project Worker answers, this origin only ever serves it as inert JSON
  const isJson = response.headers.get('Content-Type')?.split(';')[0]?.trim() === 'application/json';
  if (!isJson || response.status < 200 || response.status >= 600 || (response.status >= 300 && response.status < 400)) {
    return c.json({ error: 'The project Worker gave an unexpected answer.' }, 502, API_HEADERS);
  }
  if (joining && response.ok) {
    // The project Worker accepted the code: list the project for this user right away
    await db.insert(projectMembers).values({ projectId, userId: user.id, role: 'member' }).onConflictDoNothing().run();
  }
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...API_HEADERS },
  });
});

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
