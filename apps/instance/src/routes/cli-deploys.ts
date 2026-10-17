import { Hono } from 'hono';
import { createDb } from '../db/client';
import type { AppEnv } from '../env';
import { projectAccess } from '../lib/access';
import { badRequest } from '../lib/http';
import { cliCredentials, listCliDeploys, recordCliDeploy } from '../services/cli-deploys';
import { requireUser } from './api';

// `bohr deploy` of a project in its owner's Cloudflare account (services/cli-deploys.ts). Mounted under /api/cli
// (routes/cli.ts), whose middleware authenticates the bohr API token on /projects/*.
export const cliDeployRoutes = new Hono<AppEnv>();

const json = (c: { req: { json: () => Promise<unknown> } }) =>
  c.req.json().catch(() => {
    throw badRequest('The body must be JSON.');
  });

// The owner's Cloudflare token and account, and the branch's build variables. Never cached.
cliDeployRoutes.post('/projects/:id/credentials', async (c) => {
  c.header('Cache-Control', 'no-store');
  const caller = { user: c.get('user'), token: c.get('apiToken') };
  return c.json(await cliCredentials(createDb(c.env.DB), c.env, caller, c.req.param('id'), await json(c)));
});

// What the CLI deployed with wrangler: the version and its address, for the project's history
cliDeployRoutes.post('/projects/:id/deploys', async (c) => {
  const caller = { user: c.get('user'), token: c.get('apiToken') };
  return c.json(await recordCliDeploy(createDb(c.env.DB), caller, c.req.param('id'), await json(c)));
});

// The panel: a project's deploys made with the CLI in its owner's account (signed in with the session cookie)
export const projectCliDeployRoutes = new Hono<AppEnv>();
projectCliDeployRoutes.use('/projects/:id/cli-deploys', requireUser);

projectCliDeployRoutes.get('/projects/:id/cli-deploys', async (c) => {
  const db = createDb(c.env.DB);
  const { project } = await projectAccess(db, c.req.param('id'), c.get('user'));
  return c.json({ deploys: await listCliDeploys(db, project.id) });
});
