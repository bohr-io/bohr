import type { apiTokens, users } from './db/schema';
import type { ProvisionParams } from './workflows/provision';

export type Env = {
  DB: D1Database;
  // A local instance on the production database (wrangler.prod-db.jsonc): never migrates it; read-only unless
  // LOCAL_ALLOW_WRITES is "1"
  LOCAL_PRODUCTION_DB?: string;
  LOCAL_ALLOW_WRITES?: string;
  // With LOCAL_PRODUCTION_DB: the GitHub login that GET /auth/local signs in (GitHub cannot call back to localhost)
  LOCAL_SIGN_IN_AS?: string;
  // Managed hosting only (route records for the dispatcher, deployed bundles)
  ROUTES?: KVNamespace;
  BUNDLES?: R2Bucket;
  // Provisions project runtimes (workflows/provision.ts)
  PROVISION: Workflow<ProvisionParams>;
  // Cloudflare Browser Rendering: screenshots of the projects' sites for the panel's cards (services/screenshots.ts),
  // stored in BUNDLES; optional, without it the cards have no picture
  BROWSER?: Fetcher;

  // Public URL of the instance; self-hosted instances may leave it empty (see lib/app-url.ts)
  APP_URL?: string;
  /** "off" turns the opt-in telemetry off whatever the admin chose (services/telemetry.ts). */
  BOHR_TELEMETRY?: string;
  OIDC_AUDIENCE: string;

  // Managed hosting (bohr.io Cloud); self-hosted instances leave these unset (see lib/cloud.ts)
  CF_ACCOUNT_ID?: string;
  DISPATCH_NAMESPACE?: string;
  DISPATCHER_SCRIPT?: string;
  // The v1 edge Worker; cutover rollback points routes back at it
  LEGACY_EDGE_SCRIPT?: string;
  BOHR_DOMAIN?: string;
  BOHR_ZONE_ID?: string;
  CF_API_TOKEN?: string;

  // Sign-in with a one-time code by email (Cloudflare Email Service); off when the binding is absent
  EMAIL?: SendEmail;
  // The sender, e.g. "bohr <login@bohr.io>"; defaults to bohr <noreply@HOST> of the instance URL
  EMAIL_FROM?: string;

  // Project runtimes: the agent image copied into each account that runs projects
  RUNTIME_IMAGE?: string;
  // The dedicated sign-in container for connecting Claude subscriptions (containers/claude-login.ts); optional:
  // without it the sign-in runs in one of the owner's project containers
  CLAUDE_LOGIN?: DurableObjectNamespace;

  // Secrets
  // Protects /setup and the admin API
  ADMIN_TOKEN: string;
  // Vault master keys: base64 of 32 random bytes, or "id:key,id:key" (current first) when rotating
  ENCRYPTION_KEY: string;
  // The platform bot (onboarding); optional, the web wizard works without it
  TELEGRAM_BOT_TOKEN?: string;

  // A GitHub App configured by secrets instead of /setup (bohr.io Cloud's existing App)
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;

  // bohr.io Cloud only: billing is off when these are not set
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // The US$20/month managed hosting price
  STRIPE_PRICE_ID?: string;
};

export type User = typeof users.$inferSelect;

export type AppEnv = {
  Bindings: Env;
  // apiToken: set on the routes a bohr API token calls (routes/cli.ts)
  Variables: { user: User; apiToken: typeof apiTokens.$inferSelect };
};
