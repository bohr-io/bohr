import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb } from '../db/client';
import { buildPlans } from '../db/schema';
import type { AppEnv } from '../env';
import { appUrl } from '../lib/app-url';
import { notFound } from '../lib/http';
import {
  authenticateToken,
  cliProjectViews,
  memberProjects,
  revokeToken,
  tokenAllows,
  tokenProjectAccess,
} from '../services/api-tokens';
import {
  clientNameSchema,
  cliLoginView,
  decideCliLogin,
  findCliLogin,
  pollCliLogin,
  startCliLogin,
} from '../services/cli-login';
import { requireUser } from './api';
import { cliDeployRoutes } from './cli-deploys';

// The bohr CLI (packages/cli, npm "bohr"): `bohr login`'s device flow, which the panel approves at /cli, and the
// calls the CLI makes with a bohr API token. Deploys go through /api/deploy with the same token (routes/deploy.ts).
export const cliRoutes = new Hono<AppEnv>();

/** `Authorization: Bearer bohr_…`: the token's user, limited to the token's projects. */
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const { user, token } = await authenticateToken(createDb(c.env.DB), c.req.header('Authorization'));
  c.set('user', user);
  c.set('apiToken', token);
  await next();
});

cliRoutes.use('/me', requireToken);
cliRoutes.use('/token', requireToken);
cliRoutes.use('/projects', requireToken);
cliRoutes.use('/projects/*', requireToken);
// The panel's page that approves a sign-in (signed in with the session cookie)
cliRoutes.use('/logins/*', requireUser);

// No session: the CLI starts here
cliRoutes.post('/login', async (c) => {
  const body = z.object({ clientName: clientNameSchema.default('CLI') }).parse(await c.req.json().catch(() => ({})));
  c.header('Cache-Control', 'no-store');
  return c.json(
    await startCliLogin(createDb(c.env.DB), {
      clientName: body.clientName,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      appUrl: await appUrl(c),
    }),
  );
});

cliRoutes.post('/login/poll', async (c) => {
  const { deviceCode } = z.object({ deviceCode: z.string().min(1).max(200) }).parse(await c.req.json());
  const db = createDb(c.env.DB);
  const answer = await pollCliLogin(db, deviceCode);
  c.header('Cache-Control', 'no-store');
  if (answer.status !== 'approved') return c.json({ status: answer.status });
  return c.json({ status: 'approved', token: answer.token, user: answer.user });
});

cliRoutes.get('/logins/:code', async (c) => {
  return c.json({ login: cliLoginView(await findCliLogin(createDb(c.env.DB), c.req.param('code'))) });
});

cliRoutes.post('/logins/:code/approve', async (c) => {
  return c.json({ login: await decideCliLogin(createDb(c.env.DB), c.get('user'), c.req.param('code'), true) });
});

cliRoutes.post('/logins/:code/deny', async (c) => {
  return c.json({ login: await decideCliLogin(createDb(c.env.DB), c.get('user'), c.req.param('code'), false) });
});

// `bohr whoami`
cliRoutes.get('/me', (c) => {
  const user = c.get('user');
  const token = c.get('apiToken');
  return c.json({
    user: { id: user.id, name: user.name, email: user.email },
    token: { id: token.id, name: token.name, projects: token.projectIds, expiresAt: token.expiresAt },
  });
});

// `bohr logout`: the CLI revokes its own token
cliRoutes.delete('/token', async (c) => {
  const user = c.get('user');
  await revokeToken(createDb(c.env.DB), user.id, c.get('apiToken').id, `token:${c.get('apiToken').id}`);
  return c.json({ revoked: true });
});

// The projects the token reaches; ?repository=owner/name finds the one of a git remote
cliRoutes.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  const token = c.get('apiToken');
  const repository = c.req.query('repository')?.toLowerCase();
  const rows = (await memberProjects(db, c.get('user').id)).filter(
    ({ project }) => tokenAllows(token, project.id) && (repository === undefined || project.repoKey === repository),
  );
  return c.json({ projects: await cliProjectViews(db, rows) });
});

cliRoutes.get('/projects/:id', async (c) => {
  const db = createDb(c.env.DB);
  const access = await tokenProjectAccess(db, { user: c.get('user'), token: c.get('apiToken') }, c.req.param('id'));
  const [view] = await cliProjectViews(db, [access]);
  if (view === undefined) throw notFound('Project not found.');
  const plan = await db
    .select({ projectId: buildPlans.projectId })
    .from(buildPlans)
    .where(eq(buildPlans.projectId, access.project.id))
    .get();
  return c.json({ project: { ...view, buildPlan: plan !== undefined } });
});

// `bohr deploy` of projects in their owner's Cloudflare account: credentials and deploy reports (token, above)
cliRoutes.route('/', cliDeployRoutes);
