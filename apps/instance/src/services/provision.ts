import {
  type AccountScriptBinding,
  canRunContainers,
  copyImageToAccount,
  enableWorkersDevForScript,
  ensureContainerApplication,
  findDurableObjectNamespaceId,
  getAccountScriptSettings,
  getWorkersSubdomain,
  prepareContainerImage,
  putAccountScriptSecret,
  uploadAccountScript,
  workersDevUrl,
} from '@bohr/cloudflare';
import { GithubClient } from '@bohr/github';
import {
  DEPLOY_WORKFLOW_PATH,
  LEGACY_CLOUDFLARE_SECRETS,
  memberKey,
  RUNTIME_API_PREFIX,
  usesDeployCredentials,
  WORK_BRANCH,
} from '@bohr/shared';
import { newWebhookSecret, TelegramBot } from '@bohr/telegram';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cfConnections, identities, projectMembers, projects, runtimes, users } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { AGENT_IMAGE_VERSION, PROJECT_WORKER_SOURCE, PROJECT_WORKER_VERSION } from '../generated/runtime';
import { instanceUrl } from '../lib/app-url';
import { hasCloud } from '../lib/cloud';
import { randomId, randomToken } from '../lib/crypto';
import { badRequest, conflict, HttpError, notFound } from '../lib/http';
import { slugify } from '../lib/names';
import { connectionsOf, orgOwner, projectOwner, userOwner } from '../lib/owner';
import { vault } from '../lib/vault';
import { requireSubscription } from '../routes/billing';
import { projectSecretContext } from '../routes/runtime';
import { audit } from './audit';
import { repositoryToken } from './github-app';
import { runtimeJwks, signRuntimeToken } from './runtime-keys';
import { readSetting, writeSetting } from './settings';

// Provisioning of a project's runtime (runtime/project-worker) in the account that runs it.
// Each stage is idempotent and returns nothing secret, so a Workflow can checkpoint and retry it.

/** Public image the agent container starts from; GHCR avoids Docker Hub's anonymous pull limits. */
/** The deploy message and tag of the Workers bohr uploads, so account owners can tell them apart. */
const BOHR_ANNOTATIONS = { 'workers/message': 'bohr', 'workers/tag': `bohr-${PROJECT_WORKER_VERSION}` };

export const DEFAULT_RUNTIME_IMAGE = `ghcr.io/bohr-io/agent:${AGENT_IMAGE_VERSION}`;
export const RUNTIME_COMPATIBILITY_DATE = '2026-08-15';
const MAIN_MODULE = 'project-worker.mjs';
const PREVIEW_SOURCE = `export default {
  fetch(request, env) {
    return env.PROJECT.fetch(request);
  },
};
`;

export const cfTokenContext = (connectionId: string) => `cf_connection:${connectionId}`;

export type Step = <T>(name: string, run: () => Promise<T>) => Promise<T>;
const runNow: Step = (_name, run) => run();

async function loadTarget(db: Db, env: Env, projectId: string) {
  const row = await db
    .select({ project: projects, runtime: runtimes, owner: users })
    .from(projects)
    .innerJoin(runtimes, eq(runtimes.projectId, projects.id))
    .innerJoin(users, eq(users.id, projects.ownerUserId))
    .where(eq(projects.id, projectId))
    .get();
  if (row === undefined) throw notFound('Project not found.');
  return { ...row, cf: await accountClient(db, env, row.runtime.cfConnectionId, row.runtime.accountId) };
}

/** The Cloudflare client for the account a runtime lives in: the user's connection, or the instance's own. */
export async function accountClient(db: Db, env: Env, connectionId: string | null, accountId: string) {
  if (connectionId === null) {
    if (!env.CF_API_TOKEN) throw new HttpError(501, 'This instance has no Cloudflare account of its own.');
    return deps.userCloudflare(env.CF_API_TOKEN, accountId);
  }
  const connection = await db.select().from(cfConnections).where(eq(cfConnections.id, connectionId)).get();
  if (connection === undefined) throw notFound('The Cloudflare connection was removed.');
  const token = await vault(env).open(connection.tokenSealed, cfTokenContext(connectionId));
  await db.update(cfConnections).set({ lastUsedAt: new Date() }).where(eq(cfConnections.id, connectionId)).run();
  return deps.userCloudflare(token, accountId);
}

export async function ownerMemberKey(db: Db, userId: string): Promise<string> {
  const telegram = await db
    .select({ id: identities.providerUserId })
    .from(identities)
    .where(and(eq(identities.userId, userId), eq(identities.provider, 'telegram')))
    .get();
  return memberKey({ telegramUserId: telegram ? Number(telegram.id) : null, instanceUserId: userId });
}

/** A branch name git accepts that is not the agent's work branch (pushes there would skip approval). */
export function isProductionBranch(branch: string): boolean {
  return /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/.test(branch) && branch !== WORK_BRANCH;
}

/** A connection's row, as placement reads it. */
type Connection = typeof cfConnections.$inferSelect;

/**
 * Whether the connection's account can run Containers (the Workers Paid plan and the token's Containers: Edit),
 * asked again each time a runtime is placed, so an upgrade counts without reconnecting. The answer is kept in
 * the connection's capabilities; when the check fails (Cloudflare unreachable, a token that cannot be opened),
 * the kept one stands.
 */
async function connectionRunsContainers(db: Db, env: Env, connection: Connection): Promise<boolean> {
  const known = connection.capabilities?.containers === true;
  const check = async () => {
    const token = await vault(env).open(connection.tokenSealed, cfTokenContext(connection.id));
    return canRunContainers(deps.userCloudflare(token, connection.accountId), connection.accountId);
  };
  const available = await check().catch((error: unknown) => {
    console.error('[provision] could not check Containers', connection.id, error);
    return known;
  });
  if (available !== known) {
    await db
      .update(cfConnections)
      .set({ capabilities: { ...connection.capabilities, containers: available } })
      .where(eq(cfConnections.id, connection.id))
      .run();
  }
  return available;
}

export const CONTAINERS_UNAVAILABLE =
  "The agent's sandbox is a Cloudflare Container: the account needs the Workers Paid plan, and the token the Containers: Edit permission.";

/**
 * Where the runtime of a project that deploys with this connection runs: in the owner's account when it can run
 * Containers; otherwise, on bohr.io Cloud, in bohr's own account (the site still deploys to the owner's, like a
 * project that moved out of bohr's hosting with its agent). null on a self-hosted instance: the project works
 * without the agent until the account can run Containers. Callers have already checked the owner's subscription.
 */
export async function runtimePlacement(
  db: Db,
  env: Env,
  connection: Connection,
): Promise<{ cfConnectionId: string | null; accountId: string } | null> {
  if (await connectionRunsContainers(db, env, connection)) {
    return { cfConnectionId: connection.id, accountId: connection.accountId };
  }
  if (hasCloud(env)) return { cfConnectionId: null, accountId: env.CF_ACCOUNT_ID };
  return null;
}

/**
 * Creates the project and its (not yet provisioned) runtime for a repository the user picked: a personal
 * project, or with `orgId` an organization's (its subscription, its Cloudflare connection; access through the
 * org's members, so the creator gets no member row of their own). `runtime` is false when the agent cannot run
 * anywhere (runtimePlacement): the project only deploys, and there is nothing to provision.
 */
export async function createProject(
  db: Db,
  env: Env,
  userId: string,
  input: {
    repoOwner: string;
    repoName: string;
    repoId: number;
    productionBranch: string;
    name?: string;
    /** The owner's Cloudflare connection: new projects always deploy to the user's (or the org's) own account. */
    cfConnectionId: string;
    orgId?: string;
  },
): Promise<{ projectId: string; runtime: boolean }> {
  const repoKey = `${input.repoOwner}/${input.repoName}`.toLowerCase();
  if ((await db.select().from(projects).where(eq(projects.repoKey, repoKey)).get()) !== undefined) {
    throw conflict(`${input.repoOwner}/${input.repoName} is already a bohr project.`);
  }
  if (!isProductionBranch(input.productionBranch)) {
    throw badRequest(`${input.productionBranch} cannot be the production branch.`);
  }
  const owner = input.orgId === undefined ? userOwner(userId) : orgOwner(input.orgId);
  await requireSubscription(db, env, owner);
  const connection = await db
    .select()
    .from(cfConnections)
    .where(and(eq(cfConnections.id, input.cfConnectionId), connectionsOf(owner)))
    .get();
  if (connection === undefined) throw notFound('Cloudflare connection not found.');
  const placement = await runtimePlacement(db, env, connection);

  const projectId = randomId('p', 11);
  await db
    .insert(projects)
    .values({
      id: projectId,
      ownerUserId: userId,
      name: input.name ?? input.repoName,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      repoKey,
      repoId: input.repoId,
      productionBranch: input.productionBranch,
      mode: 'byo',
      orgId: input.orgId ?? null,
      cfConnectionId: connection.id,
    })
    .run();
  if (input.orgId === undefined) await db.insert(projectMembers).values({ projectId, userId, role: 'owner' }).run();
  if (placement !== null) {
    await createRuntime(
      db,
      env,
      projectId,
      input.name ?? input.repoName,
      placement.cfConnectionId,
      placement.accountId,
    );
  }
  await audit(db, {
    actorUserId: userId,
    actor: `user:${userId}`,
    action: 'project.create',
    target: projectId,
    metadata: {
      ...(input.orgId === undefined ? {} : { orgId: input.orgId }),
      // Where the agent runs: the owner's account, bohr's, or nowhere yet
      runtime: placement === null ? 'none' : placement.cfConnectionId === null ? 'bohr' : 'owner',
    },
  });
  return { projectId, runtime: placement !== null };
}

/** The runtime row of a project (not provisioned yet): Worker names and the project secret. */
async function createRuntime(
  db: Db,
  env: Env,
  projectId: string,
  name: string,
  cfConnectionId: string | null,
  accountId: string,
): Promise<void> {
  const slug = slugify(name).slice(0, 30) || 'project';
  await db
    .insert(runtimes)
    .values({
      projectId,
      cfConnectionId,
      accountId,
      script: `bohr-${slug}-${randomId('', 6)}`,
      // The preview URL is public; an unguessable name keeps it unlisted
      previewScript: `bohr-${slug}-preview-${randomId('', 12)}`,
      projectSecretSealed: await vault(env).seal(randomToken(32), projectSecretContext(projectId)),
      status: 'pending',
    })
    .run();
}

/**
 * Turns the agent on for a project that only deploys (migrated from v1, or created while its account could not
 * run Containers): while bohr hosts the project, its runtime runs next to its hosting, in bohr's account;
 * otherwise where runtimePlacement says (422 containers_unavailable on a self-hosted instance whose owner's
 * account still cannot run Containers).
 */
export async function enableAgent(
  db: Db,
  env: Env,
  projectId: string,
  userId: string,
  actor = `user:${userId}`,
): Promise<void> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (project === undefined) throw notFound('Project not found.');
  if ((await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()) !== undefined) {
    throw conflict('The agent is already set up for this project.');
  }
  // The owner's subscription and Cloudflare account: the organization's for an org project
  const owner = projectOwner(project);
  await requireSubscription(db, env, owner);
  if (project.mode === 'managed') {
    if (!env.CF_ACCOUNT_ID) throw badRequest('This instance does not host projects.');
    await createRuntime(db, env, projectId, project.name, null, env.CF_ACCOUNT_ID);
  } else {
    // A project in its owner's account (created without the agent, or moved there from bohr's hosting): the
    // connection it deploys with, else one of the owner's; the runtime goes where runtimePlacement says
    const deploysWith =
      project.cfConnectionId === null
        ? undefined
        : await db
            .select()
            .from(cfConnections)
            .where(and(eq(cfConnections.id, project.cfConnectionId), connectionsOf(owner)))
            .get();
    const connection = deploysWith ?? (await db.select().from(cfConnections).where(connectionsOf(owner)).get());
    if (connection === undefined) throw badRequest('Connect a Cloudflare account first.');
    const placement = await runtimePlacement(db, env, connection);
    if (placement === null) throw new HttpError(422, CONTAINERS_UNAVAILABLE, { code: 'containers_unavailable' });
    await createRuntime(db, env, projectId, project.name, placement.cfConnectionId, placement.accountId);
  }
  await audit(db, { actorUserId: userId, actor, action: 'runtime.enable', target: projectId });
}

/** Runs every stage; `step` checkpoints them when this runs inside a Workflow. */
export async function provisionRuntime(
  db: Db,
  env: Env,
  projectId: string,
  options: { locale?: string; step?: Step; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const step = options.step ?? runNow;
  // Updating a runtime that already runs: the previous version keeps serving, so the project stays usable
  // (bot, chat, settings) and a failed update leaves it running as it was
  const before = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
  const updating = before?.status === 'ready' && before.workerUrl !== null;
  if (!updating) {
    await db
      .update(runtimes)
      .set({ status: 'provisioning', error: null })
      .where(eq(runtimes.projectId, projectId))
      .run();
  }
  try {
    const subdomain = await step('workers.dev subdomain', async () => {
      const { cf, runtime } = await loadTarget(db, env, projectId);
      const found = await getWorkersSubdomain(cf, runtime.accountId);
      if (found === null) {
        throw new HttpError(
          409,
          'This Cloudflare account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once to create it, then try again.',
        );
      }
      return found;
    });

    const imageRef = await step('agent image', async () => {
      const { cf, runtime } = await loadTarget(db, env, projectId);
      const source = env.RUNTIME_IMAGE ?? DEFAULT_RUNTIME_IMAGE;
      const cacheKey = `runtime_image:${runtime.accountId}`;
      const cached = await readSetting<{ source: string; reference: string }>(db, cacheKey);
      if (cached?.source === source) return cached.reference;
      const tag = /:([\w][\w.-]{0,127})$/.exec(source)?.[1] ?? AGENT_IMAGE_VERSION;
      const { reference } = await copyImageToAccount({
        cf,
        accountId: runtime.accountId,
        source,
        repository: 'bohr-agent',
        tag,
        fetch: deps.fetch,
      });
      await prepareContainerImage(cf, runtime.accountId, reference, options.sleep ? { sleep: options.sleep } : {});
      await writeSetting(db, cacheKey, { source, reference });
      return reference;
    });

    const urls = await step('project worker', async () => {
      const { cf, runtime, project, owner } = await loadTarget(db, env, projectId);
      const workerUrl = workersDevUrl(runtime.script, subdomain);
      const previewUrl = workersDevUrl(runtime.previewScript, subdomain);
      const instance = await instanceUrl(db, env);
      if (instance === null) throw new HttpError(409, 'Finish /setup before creating projects.');
      const vars: Record<string, string> = {
        PROJECT_ID: project.id,
        PROJECT_NAME: project.name,
        REPO_OWNER: project.repoOwner,
        REPO_NAME: project.repoName,
        PRODUCTION_BRANCH: project.productionBranch,
        INSTANCE_URL: instance,
        INSTANCE_JWKS: JSON.stringify(await runtimeJwks(db, env)),
        PREVIEW_URL: previewUrl,
        PRODUCTION_URL: '',
        OWNER_KEY: await ownerMemberKey(db, owner.id),
        OWNER_NAME: owner.name ?? 'Owner',
        DEFAULT_LOCALE: options.locale ?? 'pt-BR',
        // Hosted by bohr only while a v1 project has not moved to its owner's account
        DEPLOY_TARGET: project.mode === 'managed' ? 'bohr-cloud' : 'wrangler',
        CONTAINER_INSTANCE_TYPE: 'standard-1',
      };
      const bindings: AccountScriptBinding[] = [
        { type: 'durable_object_namespace', name: 'PROJECT', class_name: 'Project' },
        ...Object.entries(vars).map(([name, text]): AccountScriptBinding => ({ type: 'plain_text', name, text })),
        {
          type: 'secret_text',
          name: 'PROJECT_SECRET',
          text: await vault(env).open(runtime.projectSecretSealed, projectSecretContext(projectId)),
        },
      ];
      const existing = await getAccountScriptSettings(cf, runtime.accountId, runtime.script);
      const result = await uploadAccountScript(
        cf,
        runtime.accountId,
        runtime.script,
        {
          main_module: MAIN_MODULE,
          compatibility_date: RUNTIME_COMPATIBILITY_DATE,
          compatibility_flags: ['nodejs_compat'],
          bindings,
          // Secrets set later (bot token, Anthropic key) survive updates
          keep_bindings: ['secret_text'],
          ...(existing?.migrationTag ? {} : { migrations: { new_tag: 'v1', new_sqlite_classes: ['Project'] } }),
          containers: [{ class_name: 'Project', images: { agent: imageRef } }],
          observability: { enabled: true },
          tags: ['bohr', `bohr-project:${projectId}`],
          annotations: BOHR_ANNOTATIONS,
        },
        [{ name: MAIN_MODULE, content: PROJECT_WORKER_SOURCE, type: 'application/javascript+module' }],
      );
      await db
        .update(runtimes)
        .set({ migrationTag: result.migrationTag ?? existing?.migrationTag ?? 'v1', imageRef })
        .where(eq(runtimes.projectId, projectId))
        .run();
      return { workerUrl, previewUrl };
    });

    await step('container application', async () => {
      const { cf, runtime } = await loadTarget(db, env, projectId);
      const namespaceId = await findDurableObjectNamespaceId(cf, runtime.accountId, runtime.script, 'Project');
      if (namespaceId === null) throw new Error('The Durable Object namespace for Project was not created.');
      await ensureContainerApplication(cf, runtime.accountId, { name: runtime.script, namespaceId });
      await enableWorkersDevForScript(cf, runtime.accountId, runtime.script);
      return namespaceId;
    });

    await step('preview worker', async () => {
      const { cf, runtime } = await loadTarget(db, env, projectId);
      await uploadAccountScript(
        cf,
        runtime.accountId,
        runtime.previewScript,
        {
          main_module: 'preview.mjs',
          compatibility_date: RUNTIME_COMPATIBILITY_DATE,
          bindings: [{ type: 'service', name: 'PROJECT', service: runtime.script, entrypoint: 'Preview' }],
          tags: ['bohr', `bohr-project:${projectId}`],
          annotations: BOHR_ANNOTATIONS,
        },
        [{ name: 'preview.mjs', content: PREVIEW_SOURCE, type: 'application/javascript+module' }],
      );
      await enableWorkersDevForScript(cf, runtime.accountId, runtime.previewScript);
      return true;
    });

    await step('deploy credentials', async () => {
      // The production deploy workflow of a project in its owner's account asks bohr for the Cloudflare
      // credentials with GitHub OIDC (POST /api/deploy/credentials); nothing goes to the repository's secrets.
      // Older versions kept a copy there: once the workflow on the production branch asks bohr instead, the
      // copy goes. A cleanup only: it never fails the provisioning.
      const { project } = await loadTarget(db, env, projectId);
      if (project.mode !== 'byo') return false;
      try {
        const contents = new GithubClient({
          token: (await repositoryToken(db, env, project, 'worker')).token,
          fetch: deps.fetch,
        });
        const workflow = await contents.getFile(
          project.repoOwner,
          project.repoName,
          DEPLOY_WORKFLOW_PATH,
          project.productionBranch,
        );
        if (workflow === null || !usesDeployCredentials(workflow.content)) return false;
        const secrets = new GithubClient({
          token: (await repositoryToken(db, env, project, 'secrets')).token,
          fetch: deps.fetch,
        });
        for (const name of LEGACY_CLOUDFLARE_SECRETS) {
          await secrets.deleteActionsSecret(project.repoOwner, project.repoName, name);
        }
        return true;
      } catch (error) {
        console.error('[provision] could not remove the old Cloudflare secrets', projectId, error);
        return false;
      }
    });

    await db
      .update(runtimes)
      .set({
        status: 'ready',
        error: null,
        workerUrl: urls.workerUrl,
        previewUrl: urls.previewUrl,
        version: PROJECT_WORKER_VERSION,
        updatedAt: new Date(),
      })
      .where(eq(runtimes.projectId, projectId))
      .run();
    await audit(db, { actor: 'provisioner', action: 'runtime.ready', target: projectId, metadata: { imageRef } });
    if (updating) {
      const restart = await restartRuntime(db, env, projectId).catch((error: unknown) => String(error));
      await audit(db, { actor: 'provisioner', action: 'runtime.restart', target: projectId, metadata: { restart } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(runtimes)
      .set({ status: updating ? 'ready' : 'error', error: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(runtimes.projectId, projectId))
      .run();
    await audit(db, {
      actor: 'provisioner',
      action: updating ? 'runtime.update_failed' : 'runtime.error',
      target: projectId,
      metadata: { message },
    });
    throw error;
  }
}

async function readyRuntime(db: Db, env: Env, projectId: string) {
  const target = await loadTarget(db, env, projectId);
  if (target.runtime.status !== 'ready' || target.runtime.workerUrl === null) {
    throw new HttpError(409, 'The project is still being set up.');
  }
  return { ...target, workerUrl: target.runtime.workerUrl };
}

/** Points a Telegram bot at the project Worker: token and webhook secret as secrets, then setWebhook. */
export async function connectProjectBot(
  db: Db,
  env: Env,
  projectId: string,
  token: string,
): Promise<{ id: number; username: string }> {
  const { cf, runtime, workerUrl } = await readyRuntime(db, env, projectId);
  const bot = new TelegramBot({ token, fetch: deps.fetch });
  const me = await bot.getMe().catch(() => null);
  if (me === null || !me.is_bot || !me.username) throw badRequest('Telegram did not accept this bot token.');
  const webhookSecret = newWebhookSecret();
  await putAccountScriptSecret(cf, runtime.accountId, runtime.script, 'TELEGRAM_BOT_TOKEN', token);
  await putAccountScriptSecret(cf, runtime.accountId, runtime.script, 'TELEGRAM_WEBHOOK_SECRET', webhookSecret);
  await bot.setWebhook({
    url: `${workerUrl}/__bohr/telegram`,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await db
    .update(runtimes)
    .set({ telegramBotId: me.id, telegramBotUsername: me.username, updatedAt: new Date() })
    .where(eq(runtimes.projectId, projectId))
    .run();
  await audit(db, { actor: 'provisioner', action: 'runtime.bot', target: projectId, metadata: { bot: me.username } });
  return { id: me.id, username: me.username };
}

/** Asks the project's agent to prepare the repository (the first request), as its owner. */
/**
 * After a runtime update: the project's Durable Object keeps its old code while its container runs, so it is
 * asked to stop the container and restart on the new version (after the request it may be running).
 * Runtimes older than this endpoint answer 404 and pick the code up when their container sleeps.
 */
export async function restartRuntime(db: Db, env: Env, projectId: string): Promise<string> {
  const { workerUrl, owner } = await readyRuntime(db, env, projectId);
  const token = await signRuntimeToken(db, env, {
    projectId,
    memberKey: await ownerMemberKey(db, owner.id),
    name: owner.name ?? 'Owner',
  });
  const response = await deps.fetch(`${workerUrl}${RUNTIME_API_PREFIX}/restart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return `not restarted (${response.status})`;
  return ((await response.json().catch(() => ({}))) as { result?: string }).result ?? 'restarting';
}

export async function startImport(db: Db, env: Env, projectId: string): Promise<void> {
  const { workerUrl, owner } = await readyRuntime(db, env, projectId);
  const token = await signRuntimeToken(db, env, {
    projectId,
    memberKey: await ownerMemberKey(db, owner.id),
    name: owner.name ?? 'Owner',
  });
  // Started by the instance, not by a person: the project Worker shows it as bohr's
  const response = await deps.fetch(`${workerUrl}${RUNTIME_API_PREFIX}/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ automatic: true }),
  });
  if (!response.ok && response.status !== 409) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new HttpError(502, `The project Worker did not start the import (${response.status}): ${detail}`);
  }
  await db.update(runtimes).set({ importStartedAt: new Date() }).where(eq(runtimes.projectId, projectId)).run();
}
