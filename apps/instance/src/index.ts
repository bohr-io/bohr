import { Hono } from 'hono';
import { ZodError } from 'zod';
import { createDb } from './db/client';
import type { AppEnv, Env } from './env';
import { HttpError } from './lib/http';
import { ensureMigrated, pendingMigrations } from './lib/migrate';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agent';
import { apiRoutes } from './routes/api';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
import { cliRoutes } from './routes/cli';
import { projectCliDeployRoutes } from './routes/cli-deploys';
import { deployRoutes } from './routes/deploy';
import { dnsRoutes } from './routes/dns';
import { manageRoutes } from './routes/manage';
import { onboardingRoutes } from './routes/onboarding';
import { orgRoutes } from './routes/orgs';
import { runtimeRoutes } from './routes/runtime';
import { setupRoutes } from './routes/setup';
import { telemetryRoutes } from './routes/telemetry';
import { templateRoutes } from './routes/templates';
import { purgeCliLogins } from './services/cli-login';
import { deleteExpiredSessions } from './services/deploy';
import { purgeEmailCodes } from './services/email-codes';
import { purgeExpiredCodes } from './services/housekeeping';
import { sendTelemetry } from './services/telemetry';

export { ClaudeLoginContainer } from './containers/claude-login';
export { ProvisionWorkflow } from './workflows/provision';

export const app = new Hono<AppEnv>();

// A deploy without `wrangler d1 migrations apply` still gets its schema
app.use('*', async (c, next) => {
  if (c.env.LOCAL_PRODUCTION_DB === '1') {
    const blocked = await localProductionGuard(c.env, c.req.method, c.req.path);
    if (blocked !== null) return c.json({ error: blocked }, 503);
  } else {
    await ensureMigrated(c.env);
  }
  await next();
});

/** Sign-in and sign-out, the only writes a read-only local instance on the production database makes. */
const LOCAL_SIGN_IN_PATHS = ['/auth/email/start', '/auth/email/verify', '/auth/logout'];

/**
 * A local instance on the production database (apps/instance/wrangler.prod-db.jsonc): it never migrates that
 * database (a migration this code has and production lacks stops it instead), and it only signs people in
 * unless LOCAL_ALLOW_WRITES is "1", since its writes would be real (rows, Cloudflare, GitHub).
 */
async function localProductionGuard(env: Env, method: string, path: string): Promise<string | null> {
  const pending = await pendingMigrations(env);
  if (pending.length > 0) {
    return `This local instance expects migrations the production database does not have (${pending.join(', ')}); it never migrates production. Deploy them first, or run without the production database.`;
  }
  const reads = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (!reads && env.LOCAL_ALLOW_WRITES !== '1' && !LOCAL_SIGN_IN_PATHS.includes(path)) {
    return 'Read-only: this local instance runs on the production database. Set LOCAL_ALLOW_WRITES=1 to allow changes.';
  }
  return null;
}

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ ...error.details, error: error.message }, error.status);
  if (error instanceof ZodError) {
    return c.json(
      {
        error: 'Invalid request.',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
      400,
    );
  }
  console.error(error);
  return c.json({ error: 'Internal error.' }, 500);
});

app.get('/health', (c) => c.json({ ok: true }));
app.route('/', setupRoutes);
app.route('/', runtimeRoutes);
app.route('/auth', authRoutes);
app.route('/api/deploy', deployRoutes);
app.route('/api/cli', cliRoutes);
app.route('/api', telemetryRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/manage', manageRoutes);
app.route('/api', billingRoutes);
app.route('/api', onboardingRoutes);
app.route('/api', templateRoutes);
app.route('/api', agentRoutes);
app.route('/api', orgRoutes);
app.route('/api', dnsRoutes);
app.route('/api', accountRoutes);
app.route('/api', projectCliDeployRoutes);
app.route('/api', apiRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      ensureMigrated(env).then(async () => {
        await deleteExpiredSessions(createDb(env.DB), env);
        await purgeExpiredCodes(createDb(env.DB));
        await purgeEmailCodes(createDb(env.DB));
        await purgeCliLogins(createDb(env.DB));
        await sendTelemetry(createDb(env.DB), env);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
