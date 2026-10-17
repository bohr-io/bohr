import {
  diagnoseToken,
  getWorkersSubdomain,
  listAccounts,
  OPTIONAL_CAPABILITIES,
  type TokenCapability,
  verifyApiToken,
} from '@bohr/cloudflare';
import {
  type AppInstallation,
  createAppJwt,
  createInstallationToken,
  GithubClient,
  type RepositorySummary,
} from '@bohr/github';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cfConnections, githubInstallations, onboarding, projects } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { badRequest, HttpError } from '../lib/http';
import { connectionsOf, type Owner, userOwner } from '../lib/owner';
import { vault } from '../lib/vault';
import { billingEnabled, ensureSubscription, hasActiveSubscription } from '../routes/billing';
import { requireGithubApp } from './github-app';
import { cfTokenContext } from './provision';
import { deleteSetting, readSetting, writeSetting } from './settings';

export type OnboardingStep =
  | 'subscription'
  | 'cloudflare'
  | 'cloudflare_account'
  | 'github'
  | 'repository'
  | 'provisioning'
  | 'project_bot'
  | 'done';

export type OnboardingState = {
  step: OnboardingStep;
  projectId?: string;
  /** Telegram chat that follows this onboarding, when it happens in the platform bot. */
  chatId?: number;
  locale?: string;
  /** While the user picks an account: the pasted token, sealed, and the accounts it can see. */
  pendingToken?: string;
  pendingAccounts?: { id: string; name: string }[];
  pendingUntil?: number;
  repositories?: { id: number; fullName: string; defaultBranch: string }[];
};

const PENDING_TOKEN_MS = 15 * 60_000;
const pendingContext = (userId: string) => `onboarding:${userId}:cf_token`;

export async function readOnboarding(db: Db, userId: string): Promise<OnboardingState> {
  const row = await db.select().from(onboarding).where(eq(onboarding.userId, userId)).get();
  const state = (row?.data as (Omit<OnboardingState, 'step'> & { step: string }) | undefined) ?? { step: 'cloudflare' };
  // Before the agent moved to the general settings, a key step came after provisioning
  return state.step === 'anthropic' ? { ...state, step: 'project_bot' } : (state as OnboardingState);
}

export async function writeOnboarding(db: Db, userId: string, state: OnboardingState): Promise<void> {
  const row = { userId, step: state.step, data: state, updatedAt: new Date() };
  await db.insert(onboarding).values(row).onConflictDoUpdate({ target: onboarding.userId, set: row }).run();
}

/**
 * Where a user should continue the onboarding: only what every user must set up (the Cloud subscription,
 * the Cloudflare account and the GitHub App). Projects and the agent's model come afterwards.
 */
export async function nextStep(db: Db, env: Env, userId: string, state: OnboardingState): Promise<OnboardingStep> {
  // bohr.io Cloud: projects need a subscription (self-hosted instances have no billing)
  if (billingEnabled(env) && !(await hasActiveSubscription(db, userId))) return 'subscription';
  if (state.step === 'cloudflare_account' && (state.pendingUntil ?? 0) > Date.now()) return 'cloudflare_account';
  const connection = await db
    .select()
    .from(cfConnections)
    .where(connectionsOf(userOwner(userId)))
    .get();
  if (connection === undefined) return 'cloudflare';
  const installation = await db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)).get();
  if (installation === undefined) return 'github';
  return 'done';
}

// Cloudflare

export type CloudflareResult =
  /** containers: whether the account can run the agent's sandbox itself (Workers Paid and Containers: Edit). */
  | { status: 'connected'; connectionId: string; accountName: string | null; containers: boolean }
  | { status: 'choose_account'; accounts: { id: string; name: string }[] }
  | { status: 'missing'; missing: TokenCapability[]; errors: Partial<Record<TokenCapability, string>> };

type PendingCloudflare = {
  pendingToken?: string;
  pendingAccounts?: { id: string; name: string }[];
  pendingUntil?: number;
};

/**
 * While someone picks among several accounts: the pasted token (sealed) and the accounts. A user's own
 * connection keeps them in their onboarding; an organization's, in a setting per org and admin.
 */
const orgPendingKey = (orgId: string, userId: string) => `org_cf_pending:${orgId}:${userId}`;
const pendingSealContext = (owner: Owner, userId: string) =>
  owner.kind === 'org' ? `org:${owner.id}:${userId}:cf_token` : pendingContext(userId);

async function readPending(db: Db, owner: Owner, userId: string): Promise<PendingCloudflare> {
  if (owner.kind === 'user') return readOnboarding(db, owner.id);
  return (await readSetting<PendingCloudflare>(db, orgPendingKey(owner.id, userId))) ?? {};
}

async function writePending(db: Db, owner: Owner, userId: string, pending: PendingCloudflare): Promise<void> {
  if (owner.kind === 'org') await writeSetting(db, orgPendingKey(owner.id, userId), pending);
  else
    await writeOnboarding(db, owner.id, {
      ...(await readOnboarding(db, owner.id)),
      ...pending,
      step: 'cloudflare_account',
    });
}

/**
 * Checks a pasted Cloudflare API token. With several accounts the user picks one (chooseCloudflareAccount).
 * The connection becomes the user's own (a string: their id), or an organization's, connected by `actorUserId`.
 */
export async function connectCloudflare(
  db: Db,
  env: Env,
  ownerOrUserId: string | Owner,
  token: string,
  actorUserId?: string,
): Promise<CloudflareResult> {
  const owner = typeof ownerOrUserId === 'string' ? userOwner(ownerOrUserId) : ownerOrUserId;
  const userId = actorUserId ?? owner.id;
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(trimmed)) throw badRequest('That does not look like a Cloudflare API token.');
  const cf = deps.userCloudflare(trimmed, '');
  try {
    const status = await verifyApiToken(cf);
    if (status.status !== 'active') throw badRequest(`This token is ${status.status}.`);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest('Cloudflare did not accept this token.');
  }
  const accounts = await listAccounts(cf);
  if (accounts.length === 0) throw badRequest('This token cannot see any Cloudflare account.');
  if (accounts.length === 1 && accounts[0] !== undefined) {
    return saveConnection(db, env, owner, userId, trimmed, accounts[0]);
  }
  await writePending(db, owner, userId, {
    pendingToken: await vault(env).seal(trimmed, pendingSealContext(owner, userId)),
    pendingAccounts: accounts,
    pendingUntil: Date.now() + PENDING_TOKEN_MS,
  });
  return { status: 'choose_account', accounts };
}

export async function chooseCloudflareAccount(
  db: Db,
  env: Env,
  ownerOrUserId: string | Owner,
  accountId: string,
  actorUserId?: string,
): Promise<CloudflareResult> {
  const owner = typeof ownerOrUserId === 'string' ? userOwner(ownerOrUserId) : ownerOrUserId;
  const userId = actorUserId ?? owner.id;
  const pending = await readPending(db, owner, userId);
  const account = pending.pendingAccounts?.find((candidate) => candidate.id === accountId);
  if (pending.pendingToken === undefined || account === undefined || (pending.pendingUntil ?? 0) < Date.now()) {
    throw badRequest('Paste the Cloudflare token again.');
  }
  const token = await vault(env).open(pending.pendingToken, pendingSealContext(owner, userId));
  const result = await saveConnection(db, env, owner, userId, token, account);
  if (owner.kind === 'org') {
    await deleteSetting(db, orgPendingKey(owner.id, userId));
  } else {
    const {
      pendingToken: _token,
      pendingAccounts: _accounts,
      pendingUntil: _until,
      ...rest
    } = await readOnboarding(db, owner.id);
    await writeOnboarding(db, owner.id, { ...rest, step: result.status === 'connected' ? 'github' : 'cloudflare' });
  }
  return result;
}

async function saveConnection(
  db: Db,
  env: Env,
  owner: Owner,
  userId: string,
  token: string,
  account: { id: string; name: string },
): Promise<CloudflareResult> {
  const cf = deps.userCloudflare(token, account.id);
  const diagnosis = await diagnoseToken(cf, account.id);
  if (!diagnosis.ok) {
    // Containers are optional (free accounts connect): only what every project needs is reported missing
    const missing = (Object.keys(diagnosis.capabilities) as TokenCapability[]).filter(
      (capability) => !diagnosis.capabilities[capability] && !OPTIONAL_CAPABILITIES.includes(capability),
    );
    const errors = Object.fromEntries(
      Object.entries(diagnosis.errors).filter(([capability]) => missing.includes(capability as TokenCapability)),
    );
    return { status: 'missing', missing, errors };
  }
  const existing = await db
    .select()
    .from(cfConnections)
    .where(and(connectionsOf(owner), eq(cfConnections.accountId, account.id)))
    .get();
  const id = existing?.id ?? randomId('cf_', 16);
  const row = {
    id,
    // An organization's connection: the admin who connected it
    userId,
    orgId: owner.kind === 'org' ? owner.id : null,
    accountId: account.id,
    accountName: account.name,
    tokenSealed: await vault(env).seal(token, cfTokenContext(id)),
    capabilities: diagnosis.capabilities,
    workersSubdomain: await getWorkersSubdomain(cf, account.id),
    verifiedAt: new Date(),
  };
  if (existing === undefined) await db.insert(cfConnections).values(row).run();
  else await db.update(cfConnections).set(row).where(eq(cfConnections.id, id)).run();
  if (owner.kind === 'user') {
    const state = await readOnboarding(db, owner.id);
    if (state.step === 'cloudflare' || state.step === 'cloudflare_account') {
      await writeOnboarding(db, owner.id, { ...state, step: 'github' });
    }
  }
  return {
    status: 'connected',
    connectionId: id,
    accountName: account.name,
    containers: diagnosis.capabilities.containers,
  };
}

// GitHub

/**
 * One-time code passed through GitHub's install flow, so the installation lands on this user. It also says
 * where the installation started, so GitHub's redirect brings the person back to the same place, and whether
 * it is meant for an organization (bohr then creates or links the org).
 */
export type InstallSource = 'web' | 'telegram';
type InstallState = { userId: string; source: InstallSource; org?: boolean; expiresAt: number };

export async function installUrl(
  db: Db,
  env: Env,
  userId: string,
  source: InstallSource,
  options: { org?: boolean } = {},
): Promise<string> {
  const app = await requireGithubApp(db, env);
  if (app.slug === null) throw new HttpError(503, 'The GitHub App has no slug configured.');
  const code = randomToken(18);
  await writeSetting(db, `install_state:${await sha256Hex(code)}`, {
    userId,
    source,
    ...(options.org ? { org: true } : {}),
    expiresAt: Date.now() + 60 * 60_000,
  } satisfies InstallState);
  return `https://github.com/apps/${app.slug}/installations/new?state=${code}`;
}

export async function userForInstallState(
  db: Db,
  code: string,
): Promise<{ userId: string; source: InstallSource; org: boolean } | null> {
  const entry = await readSetting<InstallState>(db, `install_state:${await sha256Hex(code)}`);
  if (entry === null || entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, source: entry.source ?? 'web', org: entry.org === true };
}

/** An installation and its account, read with the App's JWT; null when the App has no private key here. */
export async function fetchInstallation(db: Db, env: Env, installationId: number): Promise<AppInstallation | null> {
  const app = await requireGithubApp(db, env);
  if (app.appId === null || app.privateKey === null) return null;
  const jwt = await createAppJwt(app.appId, app.privateKey);
  return new GithubClient({ token: jwt, fetch: deps.fetch }).getAppInstallation(installationId);
}

/** Records an installation without changing whose it is (an organization's has no user). */
export async function recordInstallation(
  db: Db,
  installation: { id: number; account: { login: string; type: string | null } },
): Promise<void> {
  const { id, account } = installation;
  await db
    .insert(githubInstallations)
    .values({ id, accountLogin: account.login, accountType: account.type })
    .onConflictDoUpdate({
      target: githubInstallations.id,
      set: account.login ? { accountLogin: account.login, accountType: account.type } : { id },
    })
    .run();
}

/**
 * Records an installation for a user, reading its account from GitHub (the webhook may come later) unless the
 * caller already did.
 */
export async function linkInstallation(
  db: Db,
  env: Env,
  installationId: number,
  userId: string,
  found?: AppInstallation | null,
): Promise<void> {
  const installation = found === undefined ? await fetchInstallation(db, env, installationId) : found;
  const account = { login: installation?.account.login ?? '', type: installation?.account.type ?? null };
  const existing = await db.select().from(githubInstallations).where(eq(githubInstallations.id, installationId)).get();
  if (existing?.userId && existing.userId !== userId) {
    throw new HttpError(409, 'This GitHub installation already belongs to another bohr account.');
  }
  await db
    .insert(githubInstallations)
    .values({ id: installationId, accountLogin: account.login, accountType: account.type, userId })
    .onConflictDoUpdate({
      target: githubInstallations.id,
      set: { userId, ...(account.login ? { accountLogin: account.login, accountType: account.type } : {}) },
    })
    .run();
  const state = await readOnboarding(db, userId);
  if (state.step === 'github') await writeOnboarding(db, userId, { ...state, step: 'repository' });
}

/**
 * Repositories the user's installations can reach that are not bohr projects yet; with `installationIds`, those
 * installations' instead (an organization's).
 */
export async function availableRepositories(
  db: Db,
  env: Env,
  userId: string,
  installationIds?: number[],
): Promise<RepositorySummary[]> {
  const app = await requireGithubApp(db, env);
  if (app.appId === null || app.privateKey === null) {
    throw new HttpError(503, 'The GitHub App has no private key configured.');
  }
  const installations =
    installationIds !== undefined
      ? installationIds.map((id) => ({ id }))
      : await db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)).all();
  const taken = new Set(
    (await db.select({ key: projects.repoKey }).from(projects).all()).map((project) => project.key),
  );
  const repositories: RepositorySummary[] = [];
  for (const installation of installations) {
    const { token } = await createInstallationToken({
      appId: app.appId,
      privateKeyPem: app.privateKey,
      installationId: installation.id,
      permissions: { metadata: 'read' },
      fetch: deps.fetch,
    });
    const found = await new GithubClient({ token, fetch: deps.fetch }).listInstallationRepositories();
    repositories.push(...found.filter((repo) => !taken.has(repo.full_name.toLowerCase())));
  }
  return repositories.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export type SubscriptionResult = { status: 'ready' } | { status: 'payment_required' };

/** bohr.io Cloud: the subscription step. Moves on when the user has a current subscription. */
export async function checkSubscription(db: Db, env: Env, userId: string): Promise<SubscriptionResult> {
  if (!(await ensureSubscription(db, env, userId))) return { status: 'payment_required' };
  const state = await readOnboarding(db, userId);
  if (state.step === 'subscription') {
    await writeOnboarding(db, userId, { ...state, step: await nextStep(db, env, userId, state) });
  }
  return { status: 'ready' };
}
