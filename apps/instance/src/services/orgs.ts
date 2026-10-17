// Organizations: a GitHub organization where the App is installed becomes a bohr org with its own subscription,
// Cloudflare connection and agent settings. Its members mirror the GitHub organization (owners are admins):
// imported with the installation token, kept in step by the organization webhook and "Sync now". Members
// without a bohr account yet stay pending until they sign in with that GitHub account.
import { type AppInstallation, createInstallationToken, GithubClient, GithubError } from '@bohr/github';
import { and, eq, inArray, isNotNull, like, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  cfConnections,
  githubInstallations,
  identities,
  instanceSettings,
  orgMembers,
  orgs,
  projects,
  subscriptions,
  users,
} from '../db/schema';
import { deps } from '../deps';
import type { Env, User } from '../env';
import { randomId } from '../lib/crypto';
import { conflict, forbidden, HttpError, notFound } from '../lib/http';
import { connectionsOf, orgOwner } from '../lib/owner';
import { cancelStripeSubscriptions } from '../lib/stripe';
import { billingEnabled, hasActiveSubscription } from '../routes/billing';
import { agentSettings, settingKey } from './agent-settings';
import { audit } from './audit';
import { deleteProject } from './delete-project';
import { requireGithubApp, uninstallGithubApp } from './github-app';
import { recordInstallation } from './onboarding';
import { deleteSetting } from './settings';

export type Org = typeof orgs.$inferSelect;
export type OrgMemberRow = typeof orgMembers.$inferSelect;
export type OrgRole = 'admin' | 'member';
type Actor = { actor: string; actorUserId: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Access

export type OrgAccess = {
  org: Org;
  role: OrgRole;
  /** admin: the access comes from the user's admin role on the instance, not from a membership. */
  access: 'member' | 'admin';
};

/** The active membership of a user in an org, if any. */
export async function activeMembership(db: Db, orgId: string, userId: string) {
  return db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
    .get();
}

/**
 * What a signed-in user may do in an org: its active members by their role; the instance's admins get
 * admin-level access to every org. Orgs the user cannot see are "not found".
 */
export async function orgAccess(
  db: Db,
  slug: string,
  user: Pick<User, 'id' | 'role'>,
  required?: 'admin',
): Promise<OrgAccess> {
  const org = await db.select().from(orgs).where(eq(orgs.slug, slug.toLowerCase())).get();
  if (org === undefined) throw notFound('Organization not found.');
  const member = await activeMembership(db, org.id, user.id);
  if (member === undefined) {
    if (user.role === 'admin') return { org, role: 'admin', access: 'admin' };
    throw notFound('Organization not found.');
  }
  if (required === 'admin' && member.role !== 'admin') throw forbidden('Only organization admins can do this.');
  return { org, role: member.role, access: 'member' };
}

export const orgActor = (user: Pick<User, 'id'>, access: OrgAccess['access']): Actor => ({
  actor: access === 'admin' ? `admin:${user.id}` : `user:${user.id}`,
  actorUserId: user.id,
});

// Views

export type OrgStatus = { subscription: boolean; cloudflare: boolean; agent: boolean; installation: boolean };

/** The org's setup: subscription (always true without billing), Cloudflare, agent, GitHub App installation. */
export async function orgStatus(db: Db, env: Env, org: Org): Promise<OrgStatus> {
  const owner = orgOwner(org.id);
  const [subscribed, connection, agent] = await Promise.all([
    billingEnabled(env) ? hasActiveSubscription(db, owner) : true,
    db.select({ id: cfConnections.id }).from(cfConnections).where(connectionsOf(owner)).get(),
    agentSettings(db, env, owner),
  ]);
  return {
    subscription: subscribed,
    cloudflare: connection !== undefined,
    agent: agent !== null,
    installation: org.installationId !== null,
  };
}

export async function orgSummary(db: Db, env: Env, org: Org, role: OrgRole) {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    avatarUrl: org.avatarUrl,
    role,
    status: await orgStatus(db, env, org),
  };
}

/** The orgs where the user is an active member. */
export async function userOrgs(db: Db, userId: string) {
  return db
    .select({ org: orgs, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
    .orderBy(orgs.name)
    .all();
}

export async function listMembers(db: Db, orgId: string) {
  const rows = await db
    .select({ member: orgMembers, name: users.name, email: users.email })
    .from(orgMembers)
    .leftJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.orgId, orgId), ne(orgMembers.status, 'removed')))
    .all();
  return rows
    .map(({ member, name, email }) => ({
      githubUserId: member.githubUserId,
      githubLogin: member.githubLogin,
      name: name ?? null,
      email: email ?? null,
      userId: member.userId,
      role: member.role,
      status: member.status,
      source: member.source,
    }))
    .sort((a, b) => (a.role === b.role ? a.githubLogin.localeCompare(b.githubLogin) : a.role === 'admin' ? -1 : 1));
}

// Members from GitHub

type GithubMember = { id: number; login: string; role: OrgRole };

/** bohr users by GitHub user id (their GitHub sign-in identity). */
async function usersByGithubId(db: Db, ids: number[]): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90).map(String);
    const rows = await db
      .select({ userId: identities.userId, githubId: identities.providerUserId })
      .from(identities)
      .where(and(eq(identities.provider, 'github'), inArray(identities.providerUserId, chunk)))
      .all();
    for (const row of rows) found.set(Number(row.githubId), row.userId);
  }
  return found;
}

/**
 * Brings one GitHub member into the org's rows. Members removed in bohr stay removed; a role an admin set in
 * bohr stays until GitHub reports a different role than before.
 */
async function applyGithubMember(
  db: Db,
  orgId: string,
  existing: OrgMemberRow | undefined,
  member: GithubMember,
  userId: string | undefined,
): Promise<'added' | 'updated' | 'unchanged'> {
  const now = new Date();
  if (existing === undefined) {
    await db
      .insert(orgMembers)
      .values({
        orgId,
        githubUserId: member.id,
        githubLogin: member.login,
        userId: userId ?? null,
        role: member.role,
        status: userId === undefined ? 'pending' : 'active',
        source: 'github',
        githubRole: member.role,
      })
      .run();
    return 'added';
  }
  if (existing.status === 'removed') {
    if (existing.githubLogin !== member.login || existing.githubRole !== member.role) {
      await db
        .update(orgMembers)
        .set({ githubLogin: member.login, githubRole: member.role, updatedAt: now })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.githubUserId, member.id)))
        .run();
    }
    return 'unchanged';
  }
  const keepOverride = existing.source === 'bohr' && existing.githubRole === member.role;
  const role = keepOverride ? existing.role : member.role;
  const linkedUser = existing.userId ?? userId ?? null;
  const next = {
    githubLogin: member.login,
    githubRole: member.role,
    role,
    source: keepOverride ? ('bohr' as const) : ('github' as const),
    userId: linkedUser,
    status: linkedUser === null ? ('pending' as const) : ('active' as const),
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).some((key) => existing[key] !== next[key]);
  if (!changed) return 'unchanged';
  await db
    .update(orgMembers)
    .set({ ...next, updatedAt: now })
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.githubUserId, member.id)))
    .run();
  return existing.role !== role || existing.status !== next.status ? 'updated' : 'unchanged';
}

/** A client with an installation token of the org's installation, narrowed to `permissions`. */
async function installationClient(db: Db, env: Env, installationId: number, permissions: Record<string, 'read'>) {
  const app = await requireGithubApp(db, env);
  if (app.appId === null || app.privateKey === null) {
    throw new HttpError(503, 'The GitHub App has no private key configured.');
  }
  const { token } = await createInstallationToken({
    appId: app.appId,
    privateKeyPem: app.privateKey,
    installationId,
    permissions,
    fetch: deps.fetch,
  });
  return new GithubClient({ token, fetch: deps.fetch });
}

/** GitHub refuses a token or a listing the installation has no permission for. */
const isPermissionError = (error: unknown) =>
  error instanceof GithubError && (error.status === 403 || error.status === 422);

export type SyncResult = { added: number; removed: number; updated: number; membersPermission: boolean };

/**
 * Imports the GitHub organization's members (owners as admins) with the installation token. Without the
 * Members: read permission nothing changes and membersPermission becomes false.
 */
export async function syncMembers(db: Db, env: Env, org: Org): Promise<SyncResult> {
  if (org.installationId === null) throw conflict('The GitHub App is not installed on this organization.');
  let fetched: GithubMember[];
  try {
    const client = await installationClient(db, env, org.installationId, { members: 'read' });
    const [admins, members] = await Promise.all([
      client.listOrgMembers(org.githubLogin, 'admin'),
      client.listOrgMembers(org.githubLogin, 'member'),
    ]);
    const roles = new Map<number, GithubMember>();
    for (const member of members) roles.set(member.id, { id: member.id, login: member.login, role: 'member' });
    for (const admin of admins) roles.set(admin.id, { id: admin.id, login: admin.login, role: 'admin' });
    fetched = [...roles.values()];
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    await db.update(orgs).set({ membersPermission: false, updatedAt: new Date() }).where(eq(orgs.id, org.id)).run();
    return { added: 0, removed: 0, updated: 0, membersPermission: false };
  }

  const existing = await db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id)).all();
  const byId = new Map(existing.map((row) => [row.githubUserId, row]));
  const known = await usersByGithubId(
    db,
    fetched.map((member) => member.id),
  );
  const result = { added: 0, removed: 0, updated: 0, membersPermission: true };
  for (const member of fetched) {
    const outcome = await applyGithubMember(db, org.id, byId.get(member.id), member, known.get(member.id));
    if (outcome !== 'unchanged') result[outcome]++;
  }
  // No longer in the GitHub organization (a decision taken in bohr goes with them)
  const current = new Set(fetched.map((member) => member.id));
  const gone = existing.filter((row) => !current.has(row.githubUserId));
  for (const row of gone) {
    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, row.githubUserId)))
      .run();
    if (row.status !== 'removed') result.removed++;
  }
  await db.update(orgs).set({ membersPermission: true, updatedAt: new Date() }).where(eq(orgs.id, org.id)).run();
  return result;
}

/** A person who installed the App: GitHub account, and their bohr user when known. */
export type Installer = { githubUserId: number; login: string; userId: string | null };

/**
 * After an installation on a GitHub organization: links it to the org, creating the org when it does not
 * exist yet and the installer is a bohr user, then imports the members. The installer keeps the role GitHub
 * reports, or becomes an admin when GitHub cannot tell (no Members permission).
 */
export async function ensureOrgForInstallation(
  db: Db,
  env: Env,
  installation: AppInstallation,
  installer: Installer | null,
): Promise<Org | null> {
  const { account } = installation;
  if (account.type !== 'Organization' || account.id === 0 || account.login === '') return null;
  await recordInstallation(db, { id: installation.id, account: { login: account.login, type: account.type } });
  let org = await db.select().from(orgs).where(eq(orgs.githubAccountId, account.id)).get();
  if (org !== undefined) {
    await db
      .update(orgs)
      .set({
        installationId: installation.id,
        githubLogin: account.login,
        avatarUrl: account.avatar_url ?? org.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(orgs.id, org.id))
      .run();
  } else {
    if (installer?.userId == null) return null;
    let name = account.login;
    try {
      const client = await installationClient(db, env, installation.id, { metadata: 'read' });
      name = (await client.getOrganization(account.login)).name || account.login;
    } catch (error) {
      console.error('[orgs] could not read the organization profile:', message(error));
    }
    const base = account.login.toLowerCase();
    const taken = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, base)).get();
    const id = randomId('o_', 16);
    await db
      .insert(orgs)
      .values({
        id,
        slug: taken === undefined ? base : `${base}-${account.id}`,
        name,
        githubAccountId: account.id,
        githubLogin: account.login,
        avatarUrl: account.avatar_url,
        installationId: installation.id,
      })
      .run();
    await audit(db, {
      actor: `user:${installer.userId}`,
      actorUserId: installer.userId,
      action: 'org.create',
      target: `org:${id}`,
      metadata: { githubLogin: account.login, installationId: installation.id },
    });
  }
  org = await db.select().from(orgs).where(eq(orgs.githubAccountId, account.id)).get();
  if (org === undefined) return null;

  try {
    await syncMembers(db, env, org);
  } catch (error) {
    console.error('[orgs] member sync failed:', message(error));
  }
  if (installer?.userId != null) await ensureInstaller(db, org.id, installer as Installer & { userId: string });
  return (await db.select().from(orgs).where(eq(orgs.id, org.id)).get()) ?? org;
}

async function ensureInstaller(db: Db, orgId: string, installer: Installer & { userId: string }): Promise<void> {
  const row = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.githubUserId, installer.githubUserId)))
    .get();
  if (row === undefined) {
    // GitHub could not tell (no Members permission): whoever installs the App on an org is normally one of
    // its owners, so the org's first member is an admin. Once the org has an admin, the redirect (which any
    // member who can see the installation could replay) only adds a member; GitHub's roles come with the
    // permission.
    const admin = await db
      .select({ id: orgMembers.githubUserId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'admin'), eq(orgMembers.status, 'active')))
      .get();
    await db
      .insert(orgMembers)
      .values({
        orgId,
        githubUserId: installer.githubUserId,
        githubLogin: installer.login,
        userId: installer.userId,
        role: admin === undefined ? 'admin' : 'member',
        status: 'active',
        source: 'github',
      })
      .run();
  } else if (row.status === 'pending') {
    // Someone who signed up without GitHub: the installation proves this GitHub account is theirs.
    // A member removed in bohr stays removed.
    await db
      .update(orgMembers)
      .set({ userId: installer.userId, status: 'active', updatedAt: new Date() })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.githubUserId, installer.githubUserId)))
      .run();
  }
}

/** A person signed in (or linked) with GitHub: their pending memberships become active. */
export async function activatePendingMemberships(db: Db, githubUserId: number | string, userId: string) {
  await db
    .update(orgMembers)
    .set({ userId, status: 'active', updatedAt: new Date() })
    .where(and(eq(orgMembers.githubUserId, Number(githubUserId)), eq(orgMembers.status, 'pending')))
    .run();
}

// Webhooks

export type InstallationEvent = {
  action?: string;
  installation?: {
    id: number;
    account?: { id?: number; login?: string; type?: string; avatar_url?: string | null };
    permissions?: Record<string, string>;
  };
  sender?: { id?: number; login?: string };
};

/** installation events for GitHub organizations: link or create the org, or mark it without installation. */
export async function handleInstallationEvent(db: Db, env: Env, payload: InstallationEvent): Promise<void> {
  const installation = payload.installation;
  if (installation === undefined) return;
  if (payload.action === 'deleted') {
    // The org and its projects stay; it just has no installation until the App is installed again
    await db
      .update(orgs)
      .set({ installationId: null, updatedAt: new Date() })
      .where(eq(orgs.installationId, installation.id))
      .run();
    return;
  }
  if (payload.action !== 'created' && payload.action !== 'new_permissions_accepted') return;
  const account = installation.account;
  if (account?.type !== 'Organization' || account.id === undefined || !account.login) return;
  const sender = payload.sender;
  const userId = sender?.id === undefined ? undefined : (await usersByGithubId(db, [sender.id])).get(sender.id);
  await ensureOrgForInstallation(
    db,
    env,
    {
      id: installation.id,
      account: { id: account.id, login: account.login, type: account.type, avatar_url: account.avatar_url ?? null },
      permissions: installation.permissions ?? {},
    },
    // Only a bohr user who installed it creates an org; otherwise the setup redirect will
    sender?.id === undefined ? null : { githubUserId: sender.id, login: sender.login ?? '', userId: userId ?? null },
  );
}

export type OrganizationEvent = {
  action?: string;
  membership?: { role?: string; user?: { id?: number; login?: string } };
  organization?: { id?: number; login?: string };
};

/** organization events: members added to or removed from the GitHub organization. */
export async function handleOrganizationEvent(db: Db, payload: OrganizationEvent): Promise<void> {
  const accountId = payload.organization?.id;
  const user = payload.membership?.user;
  if (accountId === undefined || user?.id === undefined) return;
  const org = await db.select().from(orgs).where(eq(orgs.githubAccountId, accountId)).get();
  if (org === undefined) return;
  if (payload.action === 'member_added') {
    const member: GithubMember = {
      id: user.id,
      login: user.login ?? '',
      role: payload.membership?.role === 'admin' ? 'admin' : 'member',
    };
    const existing = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, member.id)))
      .get();
    const known = await usersByGithubId(db, [member.id]);
    await applyGithubMember(db, org.id, existing, member, known.get(member.id));
    // GitHub only sends these with the Members permission
    if (!org.membersPermission) {
      await db.update(orgs).set({ membersPermission: true, updatedAt: new Date() }).where(eq(orgs.id, org.id)).run();
    }
  } else if (payload.action === 'member_removed') {
    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, user.id)))
      .run();
  }
}

// Managing members in bohr

async function memberRow(db: Db, orgId: string, githubUserId: number) {
  const row = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.githubUserId, githubUserId)))
    .get();
  if (row === undefined || row.status === 'removed') throw notFound('Member not found.');
  return row;
}

/** 409 when the member is the org's only active admin. */
async function keepAnAdmin(db: Db, orgId: string, row: OrgMemberRow, what: string) {
  if (row.role !== 'admin' || row.status !== 'active') return;
  const others = await db
    .select({ id: orgMembers.githubUserId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.role, 'admin'),
        eq(orgMembers.status, 'active'),
        ne(orgMembers.githubUserId, row.githubUserId),
      ),
    )
    .all();
  if (others.length === 0)
    throw conflict(`This is the organization's last admin; make someone else an admin before ${what}.`);
}

/** An admin sets a member's role in bohr; it stays until GitHub changes that member's role. */
export async function setMemberRole(db: Db, org: Org, githubUserId: number, role: OrgRole, actor: Actor) {
  const row = await memberRow(db, org.id, githubUserId);
  if (role === 'member') await keepAnAdmin(db, org.id, row, 'demoting them');
  await db
    .update(orgMembers)
    .set({ role, source: row.githubRole === role ? 'github' : 'bohr', updatedAt: new Date() })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, githubUserId)))
    .run();
  await audit(db, {
    ...actor,
    action: 'org.member.role',
    target: `org:${org.id}`,
    metadata: { githubUserId, login: row.githubLogin, role },
  });
}

/** Takes away the member's access in bohr (GitHub is not touched); later syncs honour it. */
export async function removeMember(db: Db, org: Org, githubUserId: number, actor: Actor) {
  const row = await memberRow(db, org.id, githubUserId);
  await keepAnAdmin(db, org.id, row, 'removing them');
  await db
    .update(orgMembers)
    .set({ status: 'removed', updatedAt: new Date() })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.githubUserId, githubUserId)))
    .run();
  await audit(db, {
    ...actor,
    action: 'org.member.remove',
    target: `org:${org.id}`,
    metadata: { githubUserId, login: row.githubLogin },
  });
}

// Deleting

/**
 * Deletes an org: its projects (and, with deleteSites, their sites), its subscription, Cloudflare connections
 * and agent settings, and the App's installation on the GitHub organization. What could not be cleaned up
 * outside bohr comes back as warnings.
 */
export async function deleteOrg(
  db: Db,
  env: Env,
  org: Org,
  options: { deleteSites: boolean; actor: Actor },
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  await audit(db, {
    ...options.actor,
    action: 'org.delete',
    target: `org:${org.id}`,
    metadata: { slug: org.slug, githubLogin: org.githubLogin, deleteSites: options.deleteSites },
  });
  for (const project of await db.select().from(projects).where(eq(projects.orgId, org.id)).all()) {
    const result = await deleteProject(db, env, project, options.actor.actorUserId, {
      deleteSite: options.deleteSites,
      actor: options.actor.actor,
    });
    warnings.push(...result.warnings.map((warning) => `${project.name}: ${warning}`));
  }
  const subscriptionRows = await db.select().from(subscriptions).where(eq(subscriptions.orgId, org.id)).all();
  await cancelStripeSubscriptions(env, subscriptionRows, warnings);
  if (org.installationId !== null) {
    try {
      await uninstallGithubApp(db, env, org.installationId);
    } catch (error) {
      warnings.push(`GitHub App on ${org.githubLogin}: ${message(error)}`);
    }
  }
  await deleteSetting(db, settingKey(orgOwner(org.id)));
  await db
    .delete(instanceSettings)
    .where(like(instanceSettings.key, `org_cf_pending:${org.id}:%`))
    .run();
  await db.batch([
    db.update(orgs).set({ installationId: null }).where(eq(orgs.id, org.id)),
    ...(org.installationId === null
      ? []
      : [db.delete(githubInstallations).where(eq(githubInstallations.id, org.installationId))]),
    db.delete(subscriptions).where(eq(subscriptions.orgId, org.id)),
    db.delete(cfConnections).where(eq(cfConnections.orgId, org.id)),
    db.delete(orgMembers).where(eq(orgMembers.orgId, org.id)),
    db.delete(orgs).where(eq(orgs.id, org.id)),
  ]);
  return { warnings };
}

// Deleting a person's account

/**
 * The orgs that go with a person's account: those where they are the only active member. 409 when they are the
 * last admin of an org with other active members.
 */
export async function orgsOfDeletedAccount(db: Db, userId: string): Promise<Org[]> {
  const remove: Org[] = [];
  const blocking: string[] = [];
  for (const { org, role } of await userOrgs(db, userId)) {
    const others = await otherActiveMembers(db, org.id, userId);
    if (others.length === 0) remove.push(org);
    else if (role === 'admin' && !others.some((other) => other.role === 'admin')) blocking.push(org.slug);
  }
  if (blocking.length > 0) {
    throw conflict(
      `You are the last admin of ${blocking.join(', ')}. Make another member an admin first, or delete the organization.`,
      { orgs: blocking },
    );
  }
  return remove;
}

async function otherActiveMembers(db: Db, orgId: string, userId: string) {
  return db
    .select({ userId: orgMembers.userId, role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.status, 'active'),
        isNotNull(orgMembers.userId),
        ne(orgMembers.userId, userId),
      ),
    )
    .all();
}

/**
 * The person leaves the orgs that stay: the projects they created there, the Cloudflare connections they made
 * and the subscriptions they pay pass to another active member (an admin when there is one). An org nobody is
 * active in anymore loses them: its projects of that person are deleted and the subscription is cancelled.
 */
export async function leaveOrgs(
  db: Db,
  env: Env,
  userId: string,
  options: { deleteSites: boolean; actor: Actor },
  warnings: string[],
): Promise<void> {
  const [created, connected, paid] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerUserId, userId), isNotNull(projects.orgId)))
      .all(),
    db
      .select({ orgId: cfConnections.orgId })
      .from(cfConnections)
      .where(and(eq(cfConnections.userId, userId), isNotNull(cfConnections.orgId)))
      .all(),
    db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), isNotNull(subscriptions.orgId)))
      .all(),
  ]);
  const orgIds = new Set(
    [...created, ...connected, ...paid].map((row) => row.orgId).filter((id): id is string => id !== null),
  );
  for (const orgId of orgIds) {
    const org = await db.select().from(orgs).where(eq(orgs.id, orgId)).get();
    const others = await otherActiveMembers(db, orgId, userId);
    const successor = (others.find((other) => other.role === 'admin') ?? others[0])?.userId ?? null;
    const orgPaid = paid.filter((row) => row.orgId === orgId);
    if (successor !== null) {
      if (orgPaid.some((row) => ['active', 'trialing', 'past_due'].includes(row.status))) {
        warnings.push(
          `${org?.name ?? orgId}: its subscription stays active on the Stripe customer you paid with; an admin can change it in the billing portal.`,
        );
      }
      await db.batch([
        db
          .update(projects)
          .set({ ownerUserId: successor, updatedAt: new Date() })
          .where(and(eq(projects.orgId, orgId), eq(projects.ownerUserId, userId))),
        db
          .update(cfConnections)
          .set({ userId: successor })
          .where(and(eq(cfConnections.orgId, orgId), eq(cfConnections.userId, userId))),
        db
          .update(subscriptions)
          .set({ userId: successor, updatedAt: new Date() })
          .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.userId, userId))),
      ]);
      continue;
    }
    for (const project of created.filter((row) => row.orgId === orgId)) {
      const result = await deleteProject(db, env, project, options.actor.actorUserId, {
        deleteSite: options.deleteSites,
        actor: options.actor.actor,
      });
      warnings.push(...result.warnings.map((warning) => `${project.name}: ${warning}`));
    }
    await cancelStripeSubscriptions(env, orgPaid, warnings);
  }
  await db.delete(orgMembers).where(eq(orgMembers.userId, userId)).run();
}

/** Installations that belong to an org (kept when the person who installed them leaves). */
export async function orgInstallationIds(db: Db): Promise<Set<number>> {
  const rows = await db.select({ id: orgs.installationId }).from(orgs).where(isNotNull(orgs.installationId)).all();
  return new Set(rows.map((row) => row.id).filter((id): id is number => id !== null));
}
