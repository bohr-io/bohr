import {
  BROKER_HEADERS,
  BROKER_PREFIX,
  githubTokenRequestSchema,
  identityRequestSchema,
  memberChangeSchema,
  verifyBrokerRequest,
} from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { createDb, type Db } from '../db/client';
import { identities, projectMembers, projects, runtimes, users } from '../db/schema';
import type { AppEnv } from '../env';
import { unauthorized } from '../lib/http';
import { vault } from '../lib/vault';
import { audit } from '../services/audit';
import { repositoryToken } from '../services/github-app';
import { runtimeJwks } from '../services/runtime-keys';

// Calls from project Workers (the broker): authenticated by an HMAC with the project's secret.
export const runtimeRoutes = new Hono<AppEnv>();

export const projectSecretContext = (projectId: string) => `runtime:${projectId}:secret`;

/** The project behind a signed broker call, and the call's body. */
async function signedCall(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const projectId = c.req.header(BROKER_HEADERS.project) ?? '';
  const body = await c.req.text();
  const runtime = projectId
    ? await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()
    : undefined;
  if (runtime === undefined) throw unauthorized('Unknown project.');
  const secret = await vault(c.env).open(runtime.projectSecretSealed, projectSecretContext(projectId));
  const url = new URL(c.req.url);
  const valid = await verifyBrokerRequest(secret, c.req.raw.headers, {
    method: 'POST',
    path: `${url.pathname}${url.search}`,
    body,
  });
  if (!valid) throw unauthorized('Invalid signature.');
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (project === undefined || project.status === 'suspended') throw unauthorized('This project is not active.');
  return { db, project, body: JSON.parse(body) as unknown };
}

runtimeRoutes.post(`${BROKER_PREFIX}/github-token`, async (c) => {
  const { db, project, body } = await signedCall(c);
  const projectId = project.id;
  const { scope } = githubTokenRequestSchema.parse(body);
  const token = await repositoryToken(db, c.env, project, scope);
  await audit(db, { actor: `runtime:${projectId}`, action: 'github.token', target: projectId, metadata: { scope } });
  return c.json({ ...token, repository: `${project.repoOwner}/${project.repoName}` });
});

// Public keys project Workers use to verify the instance's calls
runtimeRoutes.get('/.well-known/bohr-runtime-jwks.json', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(await runtimeJwks(createDb(c.env.DB), c.env));
});

// The other keys of a person, so a project Worker recognizes an owner who linked Telegram after onboarding
runtimeRoutes.post(`${BROKER_PREFIX}/identity`, async (c) => {
  const { db, body } = await signedCall(c);
  const { memberKey } = identityRequestSchema.parse(body);
  const [kind, id = ''] = memberKey.split(':');
  const keys = [memberKey];
  if (kind === 'tg') {
    const identity = await db
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.provider, 'telegram'), eq(identities.providerUserId, id)))
      .get();
    if (identity !== undefined) keys.push(`u:${identity.userId}`);
  }
  return c.json({ keys });
});

// Members who joined or left through the project bot, so the web lists the project for them
runtimeRoutes.post(`${BROKER_PREFIX}/members`, async (c) => {
  const { db, project, body } = await signedCall(c);
  const change = memberChangeSchema.parse(body);
  const userId = await userForMemberKey(db, change.memberKey);
  if (userId === null || userId === project.ownerUserId) return c.body(null, 204);
  if (change.action === 'joined') {
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId, role: 'member' })
      .onConflictDoNothing()
      .run();
  } else {
    await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'member'),
        ),
      )
      .run();
  }
  await audit(db, {
    actor: `runtime:${project.id}`,
    action: `member.${change.action}`,
    target: project.id,
    metadata: { member: change.memberKey },
  });
  return c.body(null, 204);
});

/**
 * tg:<id> finds the user with that Telegram account, u:<id> is an instance user id. People without an
 * instance account are left out: a project Worker (run by its owner) must not create users for others.
 */
async function userForMemberKey(db: Db, key: string): Promise<string | null> {
  const [kind, id = ''] = key.split(':');
  if (kind === 'u') {
    return (await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get())?.id ?? null;
  }
  const identity = await db
    .select({ userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.provider, 'telegram'), eq(identities.providerUserId, id)))
    .get();
  return identity?.userId ?? null;
}
