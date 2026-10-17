import { apiTokenTemplateUrl } from '@bohr/cloudflare';
import { readWebhookUpdate } from '@bohr/telegram';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { createDb, type Db } from '../db/client';
import { cfConnections, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { AppEnv, User } from '../env';
import { auditActor, projectAccess } from '../lib/access';
import { bearerToken, isAdminToken } from '../lib/admin';
import { appUrl } from '../lib/app-url';
import { badRequest, notFound, unauthorized } from '../lib/http';
import { connectionsOf, orgOwner, projectOwner, userOwner } from '../lib/owner';
import { agentSettings } from '../services/agent-settings';
import { audit } from '../services/audit';
import { githubApp } from '../services/github-app';
import { completeMove, moveView, prepareMove } from '../services/move';
import {
  availableRepositories,
  checkSubscription,
  chooseCloudflareAccount,
  connectCloudflare,
  installUrl,
  nextStep,
  readOnboarding,
  writeOnboarding,
} from '../services/onboarding';
import { type Org, orgAccess } from '../services/orgs';
import {
  handlePlatformUpdate,
  platformBotInfo,
  platformWebhookSecret,
  setupPlatformBot,
  telegramLinkUrl,
} from '../services/platform-bot';
import { connectProjectBot, createProject, enableAgent, startImport } from '../services/provision';
import { updateOutdatedRuntimes } from '../services/runtime-updates';
import { requireUser } from './api';
import { billingEnabled, createCheckout, hasActiveSubscription } from './billing';

// Onboarding for the web wizard, the platform bot's webhook and its setup.
export const onboardingRoutes = new Hono<AppEnv>();
onboardingRoutes.use('/onboarding', requireUser);
onboardingRoutes.use('/onboarding/*', requireUser);
onboardingRoutes.use('/me/telegram-link', requireUser);
onboardingRoutes.use('/projects/:id/runtime', requireUser);
onboardingRoutes.use('/projects/:id/runtime/*', requireUser);
onboardingRoutes.use('/projects/:id/move', requireUser);
onboardingRoutes.use('/projects/:id/move/*', requireUser);

/**
 * A project the signed-in user owns (an org admin owns the org's projects), or any project for an admin.
 * `userId` is who acts for the owner (the owner, also when an admin acts on a personal project), `owner` whose
 * resources the action uses (the org's for an org project), `actor` what the audit log records.
 */
async function ownedProject(db: Db, projectId: string, user: User) {
  const { project, access } = await projectAccess(db, projectId, user, 'owner');
  return {
    project,
    userId: access === 'admin' && project.orgId === null ? project.ownerUserId : user.id,
    owner: projectOwner(project),
    actor: auditActor(user, access).actor,
  };
}

// Public: what the sign-in page and the setup notice need to know about this instance
onboardingRoutes.get('/instance', async (c) => {
  const db = createDb(c.env.DB);
  const [app, bot] = await Promise.all([githubApp(db, c.env), platformBotInfo(db)]);
  return c.json({
    setup: { githubApp: app !== null, platformBot: bot !== null },
    billing: billingEnabled(c.env),
    telegramBot: bot?.username ?? null,
    githubAppSlug: app?.slug ?? null,
  });
});

onboardingRoutes.get('/onboarding', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const state = await readOnboarding(db, user.id);
  const step = await nextStep(db, c.env, user.id, state);
  const connections = await db
    .select({ id: cfConnections.id, accountId: cfConnections.accountId, accountName: cfConnections.accountName })
    .from(cfConnections)
    .where(connectionsOf(userOwner(user.id)))
    .all();
  const bot = await platformBotInfo(db);
  return c.json({
    step,
    projectId: state.projectId ?? null,
    cloudflare: { connections, tokenTemplateUrl: apiTokenTemplateUrl({ name: 'bohr' }) },
    github: {
      installUrl: step === 'github' || step === 'repository' ? await installUrl(db, c.env, user.id, 'web') : null,
    },
    pendingAccounts: step === 'cloudflare_account' ? (state.pendingAccounts ?? []) : [],
    telegram: bot === null ? null : { username: bot.username, canManageBots: bot.canManageBots },
    // bohr.io Cloud charges for the instance; sites always deploy to the user's own Cloudflare account
    billing: { enabled: billingEnabled(c.env), subscribed: await hasActiveSubscription(db, user.id) },
    agent: { configured: (await agentSettings(db, c.env, user.id)) !== null },
  });
});

onboardingRoutes.post('/onboarding/subscription', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const result = await checkSubscription(db, c.env, user.id);
  if (result.status === 'payment_required') {
    return c.json({ status: result.status, checkoutUrl: await createCheckout(db, c.env, user, await appUrl(c)) });
  }
  return c.json(result);
});

onboardingRoutes.post('/onboarding/cloudflare', async (c) => {
  const { token } = z.object({ token: z.string().min(1).max(200) }).parse(await c.req.json());
  return c.json(await connectCloudflare(createDb(c.env.DB), c.env, c.get('user').id, token));
});

onboardingRoutes.post('/onboarding/cloudflare/account', async (c) => {
  const { accountId } = z.object({ accountId: z.string().min(1).max(64) }).parse(await c.req.json());
  return c.json(await chooseCloudflareAccount(createDb(c.env.DB), c.env, c.get('user').id, accountId));
});

onboardingRoutes.use('/repositories', requireUser);
onboardingRoutes.use('/projects', requireUser);

/** An org's repositories: those its installation reaches (none while the App is not installed there). */
const orgRepositories = (db: Db, c: Context<AppEnv>, org: Org) =>
  org.installationId === null
    ? Promise.resolve([])
    : availableRepositories(db, c.env, c.get('user').id, [org.installationId]);

/**
 * Repositories the user's GitHub App installations reach, minus the ones that are already projects; with
 * ?org=<slug>, the organization's installation's (for any member).
 */
const listRepositories = async (c: Context<AppEnv>) => {
  const db = createDb(c.env.DB);
  const slug = c.req.query('org');
  const repositories =
    slug === undefined || slug === ''
      ? await availableRepositories(db, c.env, c.get('user').id)
      : await orgRepositories(db, c, (await orgAccess(db, slug, c.get('user'))).org);
  return c.json({
    repositories: repositories.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      private: repo.private,
    })),
  });
};
onboardingRoutes.get('/repositories', listRepositories);
onboardingRoutes.get('/onboarding/repositories', listRepositories);

/**
 * A new project from one of those repositories (after the onboarding): created and provisioned. With `org`
 * (a slug), an organization's project: any member may create one; it needs the org's subscription and
 * Cloudflare connection, and deploys to the org's account.
 */
const createFromRepository = async (c: Context<AppEnv>) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const input = z
    .object({
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      productionBranch: z.string().min(1).max(200).optional(),
      name: z.string().min(1).max(100).optional(),
      locale: z.string().max(20).optional(),
      org: z.string().min(1).max(100).optional(),
    })
    .parse(await c.req.json());
  const org = input.org === undefined ? undefined : (await orgAccess(db, input.org, user)).org;
  const repositories =
    org === undefined ? await availableRepositories(db, c.env, user.id) : await orgRepositories(db, c, org);
  const repo = repositories.find((candidate) => candidate.full_name.toLowerCase() === input.repository.toLowerCase());
  if (repo === undefined) throw notFound('The GitHub App cannot reach that repository.');
  const connection = await db
    .select()
    .from(cfConnections)
    .where(connectionsOf(org === undefined ? userOwner(user.id) : orgOwner(org.id)))
    .get();
  if (connection === undefined) {
    throw badRequest(
      org === undefined
        ? 'Connect a Cloudflare account first.'
        : 'Connect a Cloudflare account to the organization first.',
    );
  }
  const { projectId, runtime } = await createProject(db, c.env, user.id, {
    repoOwner: repo.owner.login,
    repoName: repo.name,
    repoId: repo.id,
    productionBranch: input.productionBranch ?? repo.default_branch,
    name: input.name ?? repo.name,
    cfConnectionId: connection.id,
    ...(org === undefined ? {} : { orgId: org.id }),
  });
  // runtime: false when the agent cannot run anywhere yet (a self-hosted instance whose account has no Containers)
  if (runtime) await deps.startProvisioning(c.env, { projectId, userId: user.id, locale: input.locale });
  return c.json({ projectId, runtime }, 201);
};
onboardingRoutes.post('/projects', createFromRepository);
onboardingRoutes.post('/onboarding/projects', createFromRepository);

// Readable by every member: an organization's member who created a project follows its setup (the new project
// page polls this); changing the runtime stays with its owners
onboardingRoutes.get('/projects/:id/runtime', async (c) => {
  const db = createDb(c.env.DB);
  const { project } = await projectAccess(db, c.req.param('id'), c.get('user'));
  const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, project.id)).get();
  if (runtime === undefined) throw notFound('This project has no runtime.');
  return c.json({
    status: runtime.status,
    error: runtime.error,
    previewUrl: runtime.previewUrl,
    botUsername: runtime.telegramBotUsername,
    version: runtime.version,
  });
});

// "Already on bohr? Turn the agent on": a migrated project gets its runtime
// Projects migrated from v1 are hosted by bohr until their owner moves them to their own Cloudflare account
onboardingRoutes.get('/projects/:id/move', async (c) => {
  const db = createDb(c.env.DB);
  const { project, owner } = await ownedProject(db, c.req.param('id'), c.get('user'));
  const connections = await db
    .select({ id: cfConnections.id, accountId: cfConnections.accountId, accountName: cfConnections.accountName })
    .from(cfConnections)
    .where(connectionsOf(owner))
    .all();
  return c.json({ move: await moveView(db, project), connections });
});

onboardingRoutes.post('/projects/:id/move', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, userId, actor } = await ownedProject(db, c.req.param('id'), user);
  const { connectionId } = z.object({ connectionId: z.string().min(1).max(100) }).parse(await c.req.json());
  const move = await prepareMove(db, c.env, project, userId, connectionId);
  if (actor.startsWith('admin:')) {
    await audit(db, {
      actor,
      actorUserId: user.id,
      action: 'project.move',
      target: project.id,
      metadata: { connectionId },
    });
  }
  return c.json({ move });
});

onboardingRoutes.post('/projects/:id/move/complete', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, userId, actor } = await ownedProject(db, c.req.param('id'), user);
  const move = await completeMove(db, c.env, project, userId);
  if (actor.startsWith('admin:')) {
    await audit(db, { actor, actorUserId: user.id, action: 'project.move.complete', target: project.id });
  }
  return c.json({ move });
});

onboardingRoutes.post('/projects/:id/runtime/enable', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, userId, actor } = await ownedProject(db, c.req.param('id'), user);
  await enableAgent(db, c.env, project.id, user.id, actor);
  await deps.startProvisioning(c.env, { projectId: project.id, userId });
  return c.json({ started: true }, 201);
});

onboardingRoutes.post('/projects/:id/runtime/retry', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, userId, actor } = await ownedProject(db, c.req.param('id'), user);
  await deps.startProvisioning(c.env, { projectId: project.id, userId });
  if (actor.startsWith('admin:')) {
    await audit(db, { actor, actorUserId: user.id, action: 'runtime.retry', target: project.id });
  }
  return c.json({ started: true });
});

onboardingRoutes.post('/projects/:id/runtime/telegram-bot', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, userId, actor } = await ownedProject(db, c.req.param('id'), user);
  const { token } = z.object({ token: z.string().regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/) }).parse(await c.req.json());
  const bot = await connectProjectBot(db, c.env, project.id, token);
  const state = await readOnboarding(db, userId);
  if (state.projectId === project.id) await writeOnboarding(db, userId, { ...state, step: 'done' });
  if (actor.startsWith('admin:')) {
    await audit(db, { actor, actorUserId: user.id, action: 'runtime.telegram_bot', target: project.id });
  }
  return c.json({ username: bot.username });
});

onboardingRoutes.post('/projects/:id/runtime/import', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { project, actor } = await ownedProject(db, c.req.param('id'), user);
  await startImport(db, c.env, project.id);
  if (actor.startsWith('admin:')) {
    await audit(db, { actor, actorUserId: user.id, action: 'runtime.import', target: project.id });
  }
  return c.json({ started: true });
});

onboardingRoutes.post('/me/telegram-link', async (c) => {
  const url = await telegramLinkUrl(createDb(c.env.DB), c.get('user').id);
  if (url === null) throw notFound('This instance has no platform bot.');
  return c.json({ url });
});

// The platform bot's webhook
onboardingRoutes.post('/telegram/platform', async (c) => {
  const db = createDb(c.env.DB);
  const secret = await platformWebhookSecret(db, c.env);
  if (secret === null) return c.body(null, 404);
  const update = await readWebhookUpdate(c.req.raw, secret);
  if (update === null) throw unauthorized('Invalid webhook secret.');
  try {
    await handlePlatformUpdate(db, c.env, update, (params) => deps.startProvisioning(c.env, params));
  } catch (error) {
    // Telegram would resend the update; answering 200 avoids handling it twice
    console.error('[platform-bot]', error instanceof Error ? error.message : error);
  }
  return c.body(null, 200);
});

// The admin connects the platform bot (TELEGRAM_BOT_TOKEN) to this instance
onboardingRoutes.post('/admin/platform-bot', async (c) => {
  if (!(await isAdminToken(c.env, bearerToken(c.req.header('Authorization'))))) throw unauthorized();
  return c.json(await setupPlatformBot(createDb(c.env.DB), c.env));
});

// Moves every project runtime to the project Worker version this instance carries
onboardingRoutes.post('/admin/runtimes/update', async (c) => {
  if (!(await isAdminToken(c.env, bearerToken(c.req.header('Authorization'))))) throw unauthorized();
  return c.json(await updateOutdatedRuntimes(createDb(c.env.DB), c.env));
});
