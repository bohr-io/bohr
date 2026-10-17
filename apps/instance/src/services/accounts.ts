// A person's account: the services connected to it, disconnecting them, and deleting the whole account.
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  cfConnections,
  emailCodes,
  githubInstallations,
  identities,
  instanceSettings,
  onboarding,
  projectMembers,
  projects,
  runtimes,
  sessions,
  subscriptions,
  users,
} from '../db/schema';
import type { Env } from '../env';
import { conflict, notFound } from '../lib/http';
import { connectionsOf, projectsOf, subscriptionsOf, userOwner } from '../lib/owner';
import { cancelStripeSubscriptions } from '../lib/stripe';
import { agentSettings, agentSettingsView } from './agent-settings';
import { audit } from './audit';
import { deleteProject } from './delete-project';
import { uninstallGithubApp } from './github-app';
import { readOnboarding, writeOnboarding } from './onboarding';
import { deleteOrg, leaveOrgs, orgInstallationIds, orgsOfDeletedAccount } from './orgs';
import { deleteSetting } from './settings';
import { SIGN_IN_PROVIDERS } from './users';

export { uninstallGithubApp } from './github-app';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Personal projects a user owns whose repositories an installation (by its account) covers. */
async function projectsOfInstallation(db: Db, userId: string, accountLogin: string) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(projectsOf(userOwner(userId)), sql`lower(${projects.repoOwner}) = ${accountLogin.toLowerCase()}`))
    .all();
}

/** Projects that deploy to a Cloudflare connection's account, or whose runtime runs with it. */
export async function projectsOfConnection(db: Db, connectionId: string) {
  return db
    .selectDistinct({ id: projects.id, name: projects.name })
    .from(projects)
    .leftJoin(runtimes, eq(runtimes.projectId, projects.id))
    .where(or(eq(projects.cfConnectionId, connectionId), eq(runtimes.cfConnectionId, connectionId)))
    .all();
}

export async function connectionsView(db: Db, env: Env, userId: string) {
  const owner = userOwner(userId);
  const [ids, installations, connections, subscription, agent] = await Promise.all([
    db
      .select({ provider: identities.provider, username: identities.username })
      .from(identities)
      .where(eq(identities.userId, userId))
      .all(),
    db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)).all(),
    db.select().from(cfConnections).where(connectionsOf(owner)).all(),
    db.select({ status: subscriptions.status }).from(subscriptions).where(subscriptionsOf(owner)).get(),
    agentSettings(db, env, userId),
  ]);
  const signIns = ids.filter((identity) => (SIGN_IN_PROVIDERS as readonly string[]).includes(identity.provider));
  const telegram = ids.find((identity) => identity.provider === 'telegram');
  return {
    identities: ids.map((identity) => ({
      provider: identity.provider,
      username: identity.username,
      // The last way to sign in stays
      canRemove: identity.provider === 'telegram' || signIns.length > 1,
    })),
    githubInstallations: await Promise.all(
      installations.map(async (installation) => ({
        id: installation.id,
        account: installation.accountLogin,
        projects: (await projectsOfInstallation(db, userId, installation.accountLogin)).length,
      })),
    ),
    cloudflare: await Promise.all(
      connections.map(async (connection) => ({
        id: connection.id,
        accountId: connection.accountId,
        accountName: connection.accountName,
        projects: (await projectsOfConnection(db, connection.id)).length,
      })),
    ),
    telegram: telegram === undefined ? null : { username: telegram.username },
    agent: agentSettingsView(agent),
    subscription: subscription === undefined ? null : { status: subscription.status },
  };
}

/** Disconnects a provider. GitHub and email: never the last way to sign in. Telegram: the bot stops writing. */
export async function removeIdentity(db: Db, userId: string, provider: 'github' | 'email' | 'telegram') {
  const ids = await db.select().from(identities).where(eq(identities.userId, userId)).all();
  const removed = ids.filter((identity) => identity.provider === provider);
  if (removed.length === 0) throw notFound(`No ${provider} account is connected.`);
  if (provider !== 'telegram') {
    const remaining = ids.filter(
      (identity) =>
        identity.provider !== provider && (SIGN_IN_PROVIDERS as readonly string[]).includes(identity.provider),
    );
    if (remaining.length === 0) throw conflict('This is your only way to sign in. Connect another one first.');
  }
  await db
    .delete(identities)
    .where(and(eq(identities.userId, userId), eq(identities.provider, provider)))
    .run();
  if (provider === 'telegram') {
    const row = await db.select().from(onboarding).where(eq(onboarding.userId, userId)).get();
    if (row !== undefined) {
      const { chatId: _chat, ...state } = await readOnboarding(db, userId);
      await writeOnboarding(db, userId, state);
    }
  }
  await audit(db, { actor: `user:${userId}`, actorUserId: userId, action: 'identity.remove', metadata: { provider } });
}

export async function removeGithubInstallation(db: Db, env: Env, userId: string, installationId: number) {
  const installation = await db
    .select()
    .from(githubInstallations)
    .where(and(eq(githubInstallations.id, installationId), eq(githubInstallations.userId, userId)))
    .get();
  if (installation === undefined) throw notFound('Installation not found.');
  const using = await projectsOfInstallation(db, userId, installation.accountLogin);
  if (using.length > 0) {
    throw conflict(`These projects use this installation: ${using.map((project) => project.name).join(', ')}.`, {
      projects: using.map((project) => project.name),
    });
  }
  // An organization's installation stays installed: it only stops being this person's
  if ((await orgInstallationIds(db)).has(installation.id)) {
    await db.update(githubInstallations).set({ userId: null }).where(eq(githubInstallations.id, installation.id)).run();
  } else {
    await uninstallGithubApp(db, env, installation.id);
    await db.delete(githubInstallations).where(eq(githubInstallations.id, installation.id)).run();
  }
  await audit(db, {
    actor: `user:${userId}`,
    actorUserId: userId,
    action: 'github.installation.remove',
    target: String(installation.id),
    metadata: { account: installation.accountLogin },
  });
}

export const CLOUDFLARE_TOKEN_HINT =
  'bohr no longer has this token. Delete the token itself in the Cloudflare dashboard (My Profile → API Tokens).';

export async function removeCloudflareConnection(db: Db, userId: string, connectionId: string) {
  const connection = await db
    .select()
    .from(cfConnections)
    .where(and(eq(cfConnections.id, connectionId), connectionsOf(userOwner(userId))))
    .get();
  if (connection === undefined) throw notFound('Cloudflare connection not found.');
  await deleteConnection(db, connection, { actor: `user:${userId}`, actorUserId: userId });
}

/** Removes a Cloudflare connection no project runs with (409 otherwise). */
export async function deleteConnection(
  db: Db,
  connection: typeof cfConnections.$inferSelect,
  actor: { actor: string; actorUserId: string },
) {
  const using = await projectsOfConnection(db, connection.id);
  if (using.length > 0) {
    throw conflict(`These projects run in this account: ${using.map((project) => project.name).join(', ')}.`, {
      projects: using.map((project) => project.name),
    });
  }
  await db.delete(cfConnections).where(eq(cfConnections.id, connection.id)).run();
  await audit(db, {
    ...actor,
    action: 'cloudflare.remove',
    target: connection.id,
    metadata: { accountId: connection.accountId, ...(connection.orgId ? { orgId: connection.orgId } : {}) },
  });
}

/**
 * Deletes an account and everything it owns: its projects (and, with deleteSites, their sites), its place in
 * other projects, its settings, the Stripe subscription, the GitHub App installations, the Cloudflare
 * connections, the identities and sessions. Organizations where it is the only member go with it; it leaves
 * the others (409 when it is the last admin of one with other members). Signing in again starts a new account.
 * What could not be cleaned up outside bohr comes back as warnings.
 */
export async function deleteAccount(
  db: Db,
  env: Env,
  userId: string,
  options: { deleteSites: boolean; actor: { actor: string; actorUserId: string } },
): Promise<{ warnings: string[] }> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user === undefined) throw notFound('User not found.');
  const soloOrgs = await orgsOfDeletedAccount(db, userId);
  const warnings: string[] = [];
  await audit(db, {
    ...options.actor,
    action: 'account.delete',
    target: userId,
    metadata: { name: user.name, email: user.email, deleteSites: options.deleteSites },
  });

  for (const org of soloOrgs) {
    const result = await deleteOrg(db, env, org, { deleteSites: options.deleteSites, actor: options.actor });
    warnings.push(...result.warnings.map((warning) => `${org.name}: ${warning}`));
  }
  await leaveOrgs(db, env, userId, { deleteSites: options.deleteSites, actor: options.actor }, warnings);

  const owned = await db
    .select()
    .from(projects)
    .where(projectsOf(userOwner(userId)))
    .all();
  for (const project of owned) {
    const result = await deleteProject(db, env, project, options.actor.actorUserId, {
      deleteSite: options.deleteSites,
      actor: options.actor.actor,
    });
    warnings.push(...result.warnings.map((warning) => `${project.name}: ${warning}`));
  }
  await db.delete(projectMembers).where(eq(projectMembers.userId, userId)).run();

  await cancelStripeSubscriptions(
    env,
    await db
      .select()
      .from(subscriptions)
      .where(subscriptionsOf(userOwner(userId)))
      .all(),
    warnings,
  );

  // Installations the orgs that stay use remain installed; they just stop being this person's
  const orgInstallations = await orgInstallationIds(db);
  const installations = await db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)).all();
  const personal = installations.filter((installation) => !orgInstallations.has(installation.id));
  for (const installation of personal) {
    try {
      await uninstallGithubApp(db, env, installation.id);
    } catch (error) {
      warnings.push(`GitHub App on ${installation.accountLogin}: ${message(error)}`);
    }
  }
  if (personal.length > 0) {
    await db
      .delete(githubInstallations)
      .where(
        inArray(
          githubInstallations.id,
          personal.map((installation) => installation.id),
        ),
      )
      .run();
  }
  await db.update(githubInstallations).set({ userId: null }).where(eq(githubInstallations.userId, userId)).run();

  // Settings: the agent's key, and one-time codes (install, linking) issued to this user
  await deleteSetting(db, `agent:${userId}`);
  await db
    .delete(instanceSettings)
    .where(
      and(
        or(
          like(instanceSettings.key, 'install_state:%'),
          like(instanceSettings.key, 'install_verify:%'),
          like(instanceSettings.key, 'telegram_link:%'),
        ),
        eq(instanceSettings.sealed, false),
        sql`json_extract(${instanceSettings.value}, '$.userId') = ${userId}`,
      ),
    )
    .run();
  await db
    .delete(instanceSettings)
    .where(like(instanceSettings.key, `org_cf_pending:%:${userId}`))
    .run();

  await db.batch([
    db.delete(cfConnections).where(and(eq(cfConnections.userId, userId), isNull(cfConnections.orgId))),
    db.delete(onboarding).where(eq(onboarding.userId, userId)),
    db.delete(emailCodes).where(eq(emailCodes.userId, userId)),
    db.delete(subscriptions).where(and(eq(subscriptions.userId, userId), isNull(subscriptions.orgId))),
    db.delete(identities).where(eq(identities.userId, userId)),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
  return { warnings };
}
