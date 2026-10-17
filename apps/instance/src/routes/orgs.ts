import { apiTokenTemplateUrl } from '@bohr/cloudflare';
import { AGENT_EFFORTS, claudeLoginCodeSchema, claudeLoginIdSchema } from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, type Db } from '../db/client';
import { cfConnections } from '../db/schema';
import type { AppEnv } from '../env';
import { appUrl } from '../lib/app-url';
import { badRequest, notFound } from '../lib/http';
import { connectionsOf, orgOwner } from '../lib/owner';
import { CLOUDFLARE_TOKEN_HINT, deleteConnection, projectsOfConnection } from '../services/accounts';
import { agentSettings, agentSettingsView, removeAgentSettings, saveAgentSettings } from '../services/agent-settings';
import { audit } from '../services/audit';
import { cancelSubscriptionLogin, finishSubscriptionLogin, startSubscriptionLogin } from '../services/claude-login';
import { chooseCloudflareAccount, connectCloudflare, installUrl } from '../services/onboarding';
import {
  deleteOrg,
  listMembers,
  orgAccess,
  orgActor,
  orgStatus,
  orgSummary,
  removeMember,
  setMemberRole,
  syncMembers,
  userOrgs,
} from '../services/orgs';
import { requireUser } from './api';
import { billingEnabled, billingPortal, createCheckout, hasActiveSubscription, requireBilling } from './billing';

// Organizations: a GitHub organization with the App installed, with its own subscription, Cloudflare account and
// agent settings. Members mirror GitHub; admins (GitHub owners, or promoted in bohr) manage the org.
export const orgRoutes = new Hono<AppEnv>();
orgRoutes.use('/orgs', requireUser);
orgRoutes.use('/orgs/*', requireUser);

const agentBody = z.object({
  provider: z.enum(['anthropic', 'compatible', 'subscription']),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).nullish(),
  model: z.string().max(100).regex(/^\S*$/, 'The model name has no spaces.').nullish(),
  effort: z.enum(AGENT_EFFORTS).nullish(),
});

const githubUserIdParam = z.coerce.number().int().positive();

/** The org's Cloudflare accounts, with how many projects run in each (like /api/me/connections). */
async function cloudflareView(db: Db, orgId: string) {
  const connections = await db
    .select({ id: cfConnections.id, accountId: cfConnections.accountId, accountName: cfConnections.accountName })
    .from(cfConnections)
    .where(connectionsOf(orgOwner(orgId)))
    .all();
  return {
    connections: await Promise.all(
      connections.map(async (connection) => ({
        ...connection,
        projects: (await projectsOfConnection(db, connection.id)).length,
      })),
    ),
    tokenTemplateUrl: apiTokenTemplateUrl({ name: 'bohr' }),
  };
}

// The orgs the user is an active member of
orgRoutes.get('/orgs', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await userOrgs(db, c.get('user').id);
  return c.json({ orgs: await Promise.all(rows.map(({ org, role }) => orgSummary(db, c.env, org, role))) });
});

// "+ org": the App's install page, where the user picks a GitHub organization; GitHub comes back to
// /setup/github/installed, which creates the org and redirects to /orgs/<slug>
orgRoutes.get('/orgs/install-url', async (c) => {
  return c.json({ url: await installUrl(createDb(c.env.DB), c.env, c.get('user').id, 'web', { org: true }) });
});

orgRoutes.get('/orgs/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const { org, role } = await orgAccess(db, c.req.param('slug'), c.get('user'));
  return c.json({
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      avatarUrl: org.avatarUrl,
      githubLogin: org.githubLogin,
      role,
      status: await orgStatus(db, c.env, org),
      membersPermission: org.membersPermission,
    },
    billing: { enabled: billingEnabled(c.env), subscribed: await hasActiveSubscription(db, orgOwner(org.id)) },
  });
});

// Deleting the org: its projects, subscription, Cloudflare connections, agent settings and the App's installation
orgRoutes.delete('/orgs/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org, access } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const input = z
    .object({ confirm: z.string(), deleteSites: z.boolean().default(false) })
    .parse(await c.req.json().catch(() => ({})));
  if (input.confirm.trim().toLowerCase() !== org.slug) throw badRequest('Type the organization slug to confirm.');
  return c.json(await deleteOrg(db, c.env, org, { deleteSites: input.deleteSites, actor: orgActor(user, access) }));
});

// Members

orgRoutes.get('/orgs/:slug/members', async (c) => {
  const db = createDb(c.env.DB);
  const { org } = await orgAccess(db, c.req.param('slug'), c.get('user'));
  return c.json({ members: await listMembers(db, org.id) });
});

orgRoutes.post('/orgs/:slug/members/sync', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org, access } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const { added, removed, updated, membersPermission } = await syncMembers(db, c.env, org);
  await audit(db, {
    ...orgActor(user, access),
    action: 'org.members.sync',
    target: `org:${org.id}`,
    metadata: { added, removed, updated, membersPermission },
  });
  return c.json({ members: await listMembers(db, org.id), added, removed, updated, membersPermission });
});

orgRoutes.put('/orgs/:slug/members/:githubUserId', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org, access } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const githubUserId = githubUserIdParam.parse(c.req.param('githubUserId'));
  const { role } = z.object({ role: z.enum(['admin', 'member']) }).parse(await c.req.json());
  await setMemberRole(db, org, githubUserId, role, orgActor(user, access));
  return c.json({ members: await listMembers(db, org.id) });
});

orgRoutes.delete('/orgs/:slug/members/:githubUserId', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org, access } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const githubUserId = githubUserIdParam.parse(c.req.param('githubUserId'));
  await removeMember(db, org, githubUserId, orgActor(user, access));
  return c.json({ members: await listMembers(db, org.id) });
});

// The org's agent: same shapes as /api/me/agent; applied to every project of the org

orgRoutes.get('/orgs/:slug/agent', async (c) => {
  const db = createDb(c.env.DB);
  const { org } = await orgAccess(db, c.req.param('slug'), c.get('user'));
  return c.json({ agent: agentSettingsView(await agentSettings(db, c.env, orgOwner(org.id))) });
});

orgRoutes.put('/orgs/:slug/agent', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const input = agentBody.parse(await c.req.json());
  const { settings, applied, failed } = await saveAgentSettings(db, c.env, orgOwner(org.id), input, user.id);
  return c.json({ agent: agentSettingsView(settings), projects: { applied, failed } });
});

orgRoutes.delete('/orgs/:slug/agent', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  await removeAgentSettings(db, c.env, orgOwner(org.id), user.id);
  return c.json({ agent: agentSettingsView(null) });
});

// The Claude subscription for the org's agent, through `claude setup-token` in the instance's sign-in container
// (or, without one, in a ready project of the org)
orgRoutes.post('/orgs/:slug/agent/subscription/start', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  return c.json(await startSubscriptionLogin(db, c.env, user, orgOwner(org.id)));
});

orgRoutes.post('/orgs/:slug/agent/subscription/finish', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const input = z
    .object({
      // The project container the sign-in runs in; null with the dedicated sign-in container
      projectId: z.string().min(1).max(100).nullish(),
      loginId: claudeLoginIdSchema,
      code: claudeLoginCodeSchema,
      model: z.string().max(100).regex(/^\S*$/, 'The model name has no spaces.').nullish(),
      effort: z.enum(AGENT_EFFORTS).nullish(),
    })
    .parse(await c.req.json());
  const { settings, applied, failed } = await finishSubscriptionLogin(db, c.env, user, input, orgOwner(org.id));
  return c.json({ agent: agentSettingsView(settings), projects: { applied, failed } });
});

orgRoutes.post('/orgs/:slug/agent/subscription/cancel', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const input = z
    .object({ projectId: z.string().min(1).max(100).nullish(), loginId: claudeLoginIdSchema })
    .parse(await c.req.json());
  await cancelSubscriptionLogin(db, c.env, user, input, orgOwner(org.id));
  return c.json({ cancelled: true });
});

// The org's Cloudflare account: every project of the org runs there (same flow as the personal onboarding)

orgRoutes.get('/orgs/:slug/cloudflare', async (c) => {
  const db = createDb(c.env.DB);
  const { org } = await orgAccess(db, c.req.param('slug'), c.get('user'), 'admin');
  return c.json(await cloudflareView(db, org.id));
});

orgRoutes.post('/orgs/:slug/cloudflare', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const { token } = z.object({ token: z.string().min(1).max(200) }).parse(await c.req.json());
  return c.json(await connectCloudflare(db, c.env, orgOwner(org.id), token, user.id));
});

orgRoutes.post('/orgs/:slug/cloudflare/account', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const { accountId } = z.object({ accountId: z.string().min(1).max(64) }).parse(await c.req.json());
  return c.json(await chooseCloudflareAccount(db, c.env, orgOwner(org.id), accountId, user.id));
});

orgRoutes.delete('/orgs/:slug/cloudflare/:id', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org, access } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const connection = await db
    .select()
    .from(cfConnections)
    .where(and(eq(cfConnections.id, c.req.param('id')), connectionsOf(orgOwner(org.id))))
    .get();
  if (connection === undefined) throw notFound('Cloudflare connection not found.');
  await deleteConnection(db, connection, orgActor(user, access));
  return c.json({ ...(await cloudflareView(db, org.id)), hint: CLOUDFLARE_TOKEN_HINT });
});

// The org's bohr.io Cloud subscription, paid by an admin

orgRoutes.post('/orgs/:slug/billing/checkout', requireBilling, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const { org } = await orgAccess(db, c.req.param('slug'), user, 'admin');
  const url = await createCheckout(db, c.env, user, await appUrl(c), `/orgs/${org.slug}`, org.id);
  return c.json({ url });
});

orgRoutes.post('/orgs/:slug/billing/portal', requireBilling, async (c) => {
  const db = createDb(c.env.DB);
  const { org } = await orgAccess(db, c.req.param('slug'), c.get('user'), 'admin');
  return c.json({
    url: await billingPortal(db, c.env, orgOwner(org.id), `${await appUrl(c)}/orgs/${org.slug}/configuracoes`),
  });
});
