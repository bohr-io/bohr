import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Timestamps are milliseconds since the epoch
const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now);

// "*" in a branch column means "every branch of the project"
export const ALL_BRANCHES = '*';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email'),
  // Admins manage the instance in the panel and may open any project; the first user of an instance is one
  role: text('role', { enum: ['user', 'admin'] })
    .notNull()
    .default('user'),
  createdAt: createdAt(),
});

export const identities = sqliteTable(
  'identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // github and email sign in; telegram is a connected service (the platform bot)
    // email: providerUserId and username are the normalized (lowercase) address
    provider: text('provider', { enum: ['github', 'email', 'telegram'] }).notNull(),
    providerUserId: text('provider_user_id').notNull(),
    username: text('username'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('identities_provider_user').on(t.provider, t.providerUserId),
    index('identities_user').on(t.userId),
  ],
);

// One-time codes sent by email: to sign in, or to link an address to the signed-in user. Rows stay until
// purged so the rate limits can count them; a code works once, for 10 minutes and 5 attempts.
export const emailCodes = sqliteTable(
  'email_codes',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    purpose: text('purpose', { enum: ['signin', 'link'] }).notNull(),
    // link: the user the address will be attached to
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // HMAC-SHA256 of the code, bound to the email, the purpose and the user
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    // sign-in: where the browser goes afterwards
    redirect: text('redirect'),
    // sha256 of the requester's IP, for the per-IP limit
    ipHash: text('ip_hash'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    // Used, or replaced by a newer code
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('email_codes_email').on(t.email, t.createdAt), index('email_codes_ip').on(t.ipHash, t.createdAt)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    // sha256 of the cookie value; the value itself is never stored
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    // Lowercase "owner/name", how GitHub OIDC claims are matched
    repoKey: text('repo_key').notNull(),
    // GitHub's id for the repository. A name can be taken again after a rename or delete; the id cannot.
    // Null for projects imported from v1 until their first deploy records it.
    repoId: integer('repo_id'),
    productionBranch: text('production_branch').notNull().default('main'),
    mode: text('mode', { enum: ['managed', 'byo'] }).notNull(),
    status: text('status', { enum: ['active', 'migrating', 'suspended'] })
      .notNull()
      .default('active'),
    // Organization projects: access comes from the org's members, resources (subscription, Cloudflare, agent)
    // from the org. ownerUserId stays the person who created it. null: a personal project.
    orgId: text('org_id').references(() => orgs.id),
    // The owner's Cloudflare connection the site deploys to (production, previews, routes, domains). It can differ
    // from where the runtime runs: on bohr.io Cloud, the runtime of an account that cannot run Containers runs in
    // bohr's. null for projects bohr hosts and for those created before it: their runtime's, or their move's.
    cfConnectionId: text('cf_connection_id').references((): AnySQLiteColumn => cfConnections.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('projects_repo').on(t.repoKey), index('projects_org').on(t.orgId)],
);

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user').on(t.userId)],
);

export type RouteChange = { zoneId: string; pattern: string; routeId: string; previousScript: string | null };

export const hostnames = sqliteTable(
  'hostnames',
  {
    hostname: text('hostname').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    isProduction: integer('is_production', { mode: 'boolean' }).notNull().default(false),
    zoneId: text('zone_id'),
    // pending: route record written, traffic still on the previous edge; live: Worker routes point at the dispatcher
    status: text('status', { enum: ['pending', 'live'] })
      .notNull()
      .default('pending'),
    // What the cutover changed, so it can be undone
    routes: text('routes', { mode: 'json' }).$type<RouteChange[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('hostnames_project_branch').on(t.projectId, t.branch)],
);

// DNS zones bohr hosts in its own Cloudflare account (bohr.io Cloud): bohr v1 kept its customers' domains there,
// and their owners manage the records in the panel (services/dns.ts). Cloudflare holds the records; this only says
// whose each zone is: a person (userId) or an organization (orgId), one of the two. Deleting either leaves the
// zone without an owner, for an admin to give it to someone again.
export const dnsZones = sqliteTable(
  'dns_zones',
  {
    id: text('id').primaryKey(),
    // Lowercase, without a final dot ("example.com")
    name: text('name').notNull().unique(),
    cloudflareZoneId: text('cloudflare_zone_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    orgId: text('org_id').references((): AnySQLiteColumn => orgs.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('dns_zones_user').on(t.userId), index('dns_zones_org').on(t.orgId)],
);

export const siteConfig = sqliteTable(
  'site_config',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    auth: text('auth', { mode: 'json' }).$type<SiteAuth>(),
    headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.branch] })],
);

export type BasicAuthUser = { username: string; salt: string; hash: string; iterations: number };
export type SiteAuth = { type: 'none' } | { type: 'basic'; users: BasicAuthUser[]; bypassPaths?: string[] };

export const envVars = sqliteTable(
  'env_vars',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull().default(ALL_BRANCHES),
    key: text('key').notNull(),
    target: text('target', { enum: ['runtime', 'build'] }).notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull(),
    // Plain values only; secrets live in the script's secrets or the repository's Actions secrets
    value: text('value'),
    // Build variables, plain and secret, sealed with the vault (buildVariableContext): handed to the deploy
    // workflow of a project in its owner's account by POST /api/deploy/credentials, and to the build of a
    // project bohr hosts by POST /api/deploy/build-plan
    valueSealed: text('value_sealed'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('env_vars_unique').on(t.projectId, t.branch, t.key, t.target)],
);

// How a project bohr hosts (migrated from v1) is built when its repository keeps bohr v1's workflow
// (bohr-io/action asks for it with the run's GitHub OIDC token, POST /api/deploy/build-plan): the Node.js
// version, the install and build commands, and the files the build needs that the repository does not have
// (wrangler.jsonc, .bohr/worker.mjs…), written into the workspace before the build. No secrets: build
// variables stay in env_vars, sealed.
export const buildPlans = sqliteTable('build_plans', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  nodeVersion: text('node_version').notNull(),
  // null: the step is skipped
  install: text('install'),
  build: text('build'),
  // { "<path relative to the repository root>": "<contents>" }
  files: text('files', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  updatedAt: updatedAt(),
});

// Runtime secrets, encrypted with ENCRYPTION_KEY (AES-GCM). Cloudflare cannot return secret values, so the
// instance keeps them to bind every deploy, including the first deploy of a new branch
export const runtimeSecrets = sqliteTable(
  'runtime_secrets',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    key: text('key').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.branch, t.key] })],
);

export const deploySessions = sqliteTable('deploy_sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  branch: text('branch').notNull(),
  script: text('script').notNull(),
  repoKey: text('repo_key').notNull(),
  assetsConfig: text('assets_config', { mode: 'json' }).$type<AssetsSessionConfig>(),
  hasAssets: integer('has_assets', { mode: 'boolean' }).notNull(),
  // Opened with an API token (the CLI): only that token finalizes it, while it is valid. null: a GitHub Actions
  // run (OIDC). No foreign key: revoking a token leaves its sessions to expire.
  tokenId: text('token_id'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: createdAt(),
});

// API tokens ("bohr_…"): created in the panel for scripts and AI agents (Account › Tokens), or by `bohr login`
// on a computer (named "CLI on <hostname>"). They act as their user on the CLI's routes (/api/cli and the deploy
// API), only on the user's projects (never with the instance admin role) and only on the projects they list.
// Only the sha256 of the token is stored: it is shown once.
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    // The first characters ("bohr_k3x9…"), so people can tell their tokens apart
    hint: text('hint').notNull(),
    // null: every project the user can reach; otherwise only these project ids
    projectIds: text('project_ids', { mode: 'json' }).$type<string[]>(),
    source: text('source', { enum: ['panel', 'cli'] }).notNull(),
    // null: never expires
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_tokens_hash').on(t.tokenHash), index('api_tokens_user').on(t.userId)],
);

// `bohr login`: the CLI asks for a device code and polls while its person approves the user code in the panel
// (/cli?code=…); approved, the next poll gets a new API token, once. Rows are purged once expired.
export const cliLogins = sqliteTable(
  'cli_logins',
  {
    id: text('id').primaryKey(),
    // sha256 of the device code only the CLI knows
    deviceCodeHash: text('device_code_hash').notNull(),
    // What the person compares with their terminal, e.g. "BCDF-GHJK"
    userCode: text('user_code').notNull(),
    // "CLI on <hostname>", the name of the token it gets
    clientName: text('client_name').notNull(),
    // done: the token was handed to the CLI
    status: text('status', { enum: ['pending', 'approved', 'denied', 'done'] })
      .notNull()
      .default('pending'),
    // Who approved or denied it
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // sha256 of the requester's IP, for the per-IP limit
    ipHash: text('ip_hash'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cli_logins_device').on(t.deviceCodeHash),
    uniqueIndex('cli_logins_user_code').on(t.userCode),
    index('cli_logins_ip').on(t.ipHash, t.createdAt),
  ],
);

export type AssetsSessionConfig = {
  notFoundHandling?: 'single-page-application' | '404-page' | 'none';
  htmlHandling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
  runWorkerFirst?: boolean | string[];
  redirects?: string;
  headers?: string;
};

export const deployments = sqliteTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    script: text('script').notNull(),
    commitSha: text('commit_sha'),
    status: text('status', { enum: ['building', 'success', 'error'] }).notNull(),
    error: text('error'),
    // R2 prefix holding metadata.json, the modules and the assets manifest
    bundleKey: text('bundle_key'),
    actor: text('actor'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('deployments_project').on(t.projectId, t.createdAt)],
);

// Deploys of a project in its owner's Cloudflare account made with the bohr CLI (`bohr deploy` runs wrangler
// where the CLI runs, with the owner's Cloudflare token: POST /api/cli/projects/:id/credentials), as the CLI
// reports them: the Worker version wrangler uploaded and its address. Not in `deployments`, which are bohr's
// own copies in its dispatch namespace (secrets, moves and deletions act on their scripts). Nothing here can be
// published again from bohr: wrangler keeps the versions in the owner's account.
export const cliDeploys = sqliteTable(
  'cli_deploys',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    // true: `wrangler deploy` (production); false: `wrangler versions upload` (a preview, production untouched)
    production: integer('production', { mode: 'boolean' }).notNull(),
    workerName: text('worker_name'),
    // Cloudflare's version id of the Worker
    versionId: text('version_id'),
    // The preview's address (its alias, else the version's), or production's
    url: text('url'),
    // Only when the working tree had no uncommitted changes
    commitSha: text('commit_sha'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    // The API token that reported it. No foreign key: revoking a token keeps its history.
    tokenId: text('token_id'),
    createdAt: createdAt(),
  },
  (t) => [index('cli_deploys_project').on(t.projectId, t.createdAt)],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    priceId: text('price_id'),
    status: text('status').notNull(),
    // Customers from bohr v1 keep their price forever
    legacy: integer('legacy', { mode: 'boolean' }).notNull().default(false),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
    // An organization's subscription (userId is the admin who pays); null: the user's own
    orgId: text('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subscriptions_user').on(t.userId),
    uniqueIndex('subscriptions_customer').on(t.stripeCustomerId),
    index('subscriptions_org').on(t.orgId),
  ],
);

export const v1Migrations = sqliteTable('v1_migrations', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  v1SiteId: text('v1_site_id'),
  status: text('status', { enum: ['imported', 'deployed', 'live', 'rolled_back'] }).notNull(),
  notes: text('notes'),
  updatedAt: updatedAt(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    // null when the action came from the admin API or the deploy pipeline
    actorUserId: text('actor_user_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_target').on(t.target, t.createdAt)],
);

// Self-hosted instance: settings, user connections and the project runtimes the instance provisions

// Instance-wide settings. Sealed values (GitHub App keys, signing keys) are envelope-encrypted with the vault
export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  sealed: integer('sealed', { mode: 'boolean' }).notNull().default(false),
  updatedAt: updatedAt(),
});

// A Cloudflare API token for one account, a user's or an organization's (orgId set; userId is the admin who
// connected it); projects in "byo" mode run there
export const cfConnections = sqliteTable(
  'cf_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    accountName: text('account_name'),
    tokenSealed: text('token_sealed').notNull(),
    capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, boolean>>(),
    workersSubdomain: text('workers_subdomain'),
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    orgId: text('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cf_connections_user_account').on(t.userId, t.accountId).where(sql`${t.orgId} IS NULL`),
    uniqueIndex('cf_connections_org_account').on(t.orgId, t.accountId).where(sql`${t.orgId} IS NOT NULL`),
  ],
);

export const githubInstallations = sqliteTable(
  'github_installations',
  {
    // GitHub's installation id
    id: integer('id').primaryKey(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('github_installations_user').on(t.userId)],
);

// Organizations: a GitHub organization where the App is installed. Each one has its own subscription,
// Cloudflare connection and agent settings; its members mirror the GitHub organization's.
export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  // The GitHub login in lowercase, as the panel's URLs use it
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  githubAccountId: integer('github_account_id').notNull().unique(),
  githubLogin: text('github_login').notNull(),
  avatarUrl: text('avatar_url'),
  // null once the App is uninstalled on GitHub: the org and its projects stay
  installationId: integer('installation_id').references(() => githubInstallations.id, { onDelete: 'set null' }),
  // false while the App lacks Organization › Members: read (only the installer could be added)
  membersPermission: integer('members_permission', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orgMembers = sqliteTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    githubUserId: integer('github_user_id').notNull(),
    githubLogin: text('github_login').notNull(),
    // null until the person signs in to bohr with that GitHub account (pending)
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    // removed: an admin took the access away in bohr; syncs from GitHub honour it
    status: text('status', { enum: ['active', 'pending', 'removed'] }).notNull(),
    // github: the role follows GitHub; bohr: an admin set it in bohr, kept until GitHub changes the member's role
    source: text('source', { enum: ['github', 'bohr'] }).notNull(),
    // The role GitHub last reported (owner → admin), to tell when GitHub changed it
    githubRole: text('github_role', { enum: ['admin', 'member'] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.githubUserId] }), index('org_members_user').on(t.userId)],
);

// The project Worker (bot, queue, agent sandbox, preview) the instance provisioned for a project
export const runtimes = sqliteTable('runtimes', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // null: the instance's own Cloudflare account (bohr.io Cloud)
  cfConnectionId: text('cf_connection_id').references(() => cfConnections.id, { onDelete: 'set null' }),
  accountId: text('account_id').notNull(),
  script: text('script').notNull(),
  previewScript: text('preview_script').notNull(),
  workerUrl: text('worker_url'),
  previewUrl: text('preview_url'),
  // Shared with the project Worker; signs its broker calls
  projectSecretSealed: text('project_secret_sealed').notNull(),
  telegramBotId: integer('telegram_bot_id'),
  telegramBotUsername: text('telegram_bot_username'),
  imageRef: text('image_ref'),
  version: text('version'),
  migrationTag: text('migration_tag'),
  // When the agent was first asked to prepare the repository; null until the owner sets up the agent
  importStartedAt: integer('import_started_at', { mode: 'timestamp_ms' }),
  status: text('status', { enum: ['pending', 'provisioning', 'ready', 'error'] })
    .notNull()
    .default('pending'),
  error: text('error'),
  updatedAt: updatedAt(),
});

// Where a user is in the onboarding conversation (platform bot or web wizard)
export const onboarding = sqliteTable('onboarding', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  step: text('step').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
});
