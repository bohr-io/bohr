import { PROJECT_TEMPLATES } from '@bohr/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../db/client';
import { deps } from '../deps';
import type { AppEnv } from '../env';
import { randomToken } from '../lib/crypto';
import { startGithubAuthorization, withError } from '../lib/github-authorize';
import { HttpError, notFound, unauthorized } from '../lib/http';
import { sessionUser } from '../lib/session';
import { requireGithubApp } from '../services/github-app';
import {
  createFromTemplate,
  revealAdminPassword,
  startTemplateRequest,
  takeTemplateRequest,
  templateRequestSchema,
} from '../services/templates';
import { requireUser } from './api';

// New projects from a template (services/templates.ts): the catalog, the request that sends the browser through
// GitHub's user authorization, the callback's work and the admin password shown once.
export const templateRoutes = new Hono<AppEnv>();
templateRoutes.use('/templates', requireUser);
templateRoutes.use('/templates/*', requireUser);

templateRoutes.get('/templates', (c) => c.json({ templates: PROJECT_TEMPLATES }));

/** Where the new project page shows a template's form again (with ?error= when it failed). */
const formPath = (template: string, org: string | undefined) =>
  `/projects/new?template=${encodeURIComponent(template)}${org === undefined ? '' : `&org=${encodeURIComponent(org)}`}`;

// Checks the request and keeps it server-side; the browser then goes to `url` (GitHub's authorization)
templateRoutes.post('/templates/projects', async (c) => {
  const db = createDb(c.env.DB);
  const input = templateRequestSchema.parse(await c.req.json());
  const app = await requireGithubApp(db, c.env);
  const state = randomToken(16);
  await startTemplateRequest(db, c.env, c.get('user'), input, state);
  const url = await startGithubAuthorization(c, app, {
    state,
    redirect: formPath(input.template, input.org),
    mode: 'template',
  });
  return c.json({ url });
});

// The admin password of a project just created from a template: answered once, to who created it
templateRoutes.post('/templates/password', async (c) => {
  const { projectId } = z.object({ projectId: z.string().min(1).max(100) }).parse(await c.req.json());
  c.header('Cache-Control', 'no-store');
  const revealed = await revealAdminPassword(createDb(c.env.DB), c.env, c.get('user').id, projectId);
  if (revealed === null) throw notFound('The password was already shown.');
  return c.json(revealed);
});

/**
 * /auth/github/callback in "template" mode, with the user's token: creates the project and goes to its setup on
 * the new project page, or back to the template's form with ?error= (and &code= for errors the page explains).
 */
export async function templateCallback(c: Context<AppEnv>, state: string, redirect: string, userToken: string) {
  const db = createDb(c.env.DB);
  try {
    const user = await sessionUser(c, db);
    if (user === null) throw unauthorized('Sign in again, then create the project.');
    const input = await takeTemplateRequest(db, state, user.id);
    const { projectId, org, runtime } = await createFromTemplate(db, c.env, user, input, userToken);
    if (runtime) await deps.startProvisioning(c.env, { projectId, userId: user.id, locale: input.locale });
    const query = new URLSearchParams({
      ...(org === null ? {} : { org }),
      project: projectId,
      template: input.template,
      // No runtime: the account cannot run the agent's sandbox (a self-hosted instance without Containers)
      ...(runtime ? {} : { agent: 'unavailable' }),
    });
    return c.redirect(`/projects/new?${query}`);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error('[templates]', error);
      return c.redirect(withError(redirect, 'Could not create the project. Please try again.'));
    }
    const code = typeof error.details.code === 'string' ? error.details.code : undefined;
    return c.redirect(withError(redirect, error.message, code));
  }
}
