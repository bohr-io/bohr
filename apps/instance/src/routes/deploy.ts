import type { Context } from 'hono';
import { Hono } from 'hono';
import { createDb } from '../db/client';
import { deps } from '../deps';
import type { AppEnv } from '../env';
import { badRequest, inBackground } from '../lib/http';
import { verifyGithubOidc } from '../lib/oidc';
import { authenticateToken, TOKEN_PREFIX } from '../services/api-tokens';
import { buildPlanForRun } from '../services/build-plans';
import { createDeploySession, type DeployCaller, finalizeDeploy } from '../services/deploy';
import { deployCredentials } from '../services/deploy-credentials';

// Called by cloud/deploy-action with a GitHub Actions OIDC token (docs/managed-hosting.md, docs/architecture.md),
// and for the deploy itself also by the bohr CLI with an API token (packages/cli)
export const deployRoutes = new Hono<AppEnv>();

/** A bohr API token ("bohr_…"), else the run's GitHub OIDC token. */
async function deployCaller(c: Context<AppEnv>): Promise<DeployCaller> {
  const authorization = c.req.header('Authorization');
  if (authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]?.startsWith(TOKEN_PREFIX)) {
    return { kind: 'token', ...(await authenticateToken(createDb(c.env.DB), authorization)) };
  }
  return { kind: 'github', claims: await verifyGithubOidc(authorization, c.env.OIDC_AUDIENCE) };
}

deployRoutes.post('/sessions', async (c) => {
  const caller = await deployCaller(c);
  const body = await c.req.json().catch(() => {
    throw badRequest('The body must be JSON.');
  });
  return c.json(await createDeploySession(createDb(c.env.DB), c.env, deps.cloudflare(c.env), caller, body));
});

// The production deploy workflow of a project in its owner's account asks for its Cloudflare credentials and
// build variables (bohr-io/deploy-action with `credentials: 'true'`)
deployRoutes.post('/credentials', async (c) => {
  const claims = await verifyGithubOidc(c.req.header('Authorization'), c.env.OIDC_AUDIENCE);
  c.header('Cache-Control', 'no-store');
  return c.json(await deployCredentials(createDb(c.env.DB), c.env, claims));
});

// bohr v1's workflow (bohr-io/action) in a repository migrated to a project bohr hosts asks for the project's
// build plan; 404 { found: false } sends it back to bohr v1 (services/build-plans.ts)
deployRoutes.post('/build-plan', async (c) => {
  const claims = await verifyGithubOidc(c.req.header('Authorization'), c.env.OIDC_AUDIENCE);
  c.header('Cache-Control', 'no-store');
  const answer = await buildPlanForRun(createDb(c.env.DB), c.env, claims);
  return answer.found ? c.json(answer) : c.json(answer, 404);
});

deployRoutes.post('/sessions/:id/finalize', async (c) => {
  const caller = await deployCaller(c);
  const form = await c.req.formData().catch(() => {
    throw badRequest('The body must be multipart/form-data.');
  });
  return c.json(
    await finalizeDeploy(createDb(c.env.DB), c.env, deps.cloudflare(c.env), caller, c.req.param('id'), form, (task) =>
      inBackground(c, task),
    ),
  );
});
