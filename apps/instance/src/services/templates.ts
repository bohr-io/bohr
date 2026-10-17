// New projects from a template (packages/shared/src/templates.ts): bohr generates the user's repository from one
// of bohr-io's template repositories, then sets it up like a project created from a repository of theirs.
//
// 1. startTemplateRequest (POST /api/templates/projects): checks what can be checked before anything exists (the
//    owner's subscription and Cloudflare connection, D1 permission, names already taken) and keeps the request,
//    bound to the user and the OAuth state, for 10 minutes. The browser goes through GitHub's user authorization.
// 2. createFromTemplate (/auth/github/callback, mode "template"), with the user's token, used in that request only:
//    generates the repository, waits for its default branch and adds it to the App's installation when that is
//    limited to selected repositories. Then the D1 database, the project, the admin password (a secret site variable
//    on a placeholder Worker) and the repository's setup commits: wrangler.jsonc with the Worker's name and the
//    database, .bohr/deploy.json when missing, and the deploy workflow. Its push deploys production, the database
//    migrated first. What fails after the repository exists is undone, except the repository, which the error names.
// 3. revealAdminPassword: the result screen shows the password once.
import {
  type CloudflareClient,
  createD1Database,
  type D1Database,
  deleteAccountScript,
  deleteD1Database,
  findD1Database,
  getAccountScriptSettings,
  isPermissionError,
} from '@bohr/cloudflare';
import { GithubClient, GithubError, type RepositorySummary } from '@bohr/github';
import {
  DEPLOY_CONFIG_PATH,
  DEPLOY_WORKFLOW_HEADER,
  DEPLOY_WORKFLOW_PATH,
  d1MigrationBindings,
  deployConfigSchema,
  findTemplate,
  normalizeLocale,
  type ProjectTemplate,
  renderDeployWorkflow,
  stripJsonComments,
  TEMPLATE_ADMIN_PASSWORD,
  TEMPLATE_DATABASE_PLACEHOLDER,
} from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Project } from '../db/client';
import { cfConnections, githubInstallations, identities, projects } from '../db/schema';
import { deps } from '../deps';
import type { Env, User } from '../env';
import { instanceUrl } from '../lib/app-url';
import { randomToken, sha256Hex } from '../lib/crypto';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http';
import { slugify } from '../lib/names';
import { connectionsOf, orgOwner, userOwner } from '../lib/owner';
import { vault } from '../lib/vault';
import { requireSubscription } from '../routes/billing';
import { audit } from './audit';
import { repositoryToken } from './github-app';
import { fetchInstallation } from './onboarding';
import { type Org, orgAccess } from './orgs';
import { accountClient, createProject } from './provision';
import { deleteSetting, readSetting, writeSetting } from './settings';
import { presetSiteSecret } from './variables';

const REQUEST_TTL_MS = 10 * 60_000;
const PASSWORD_TTL_MS = 60 * 60_000;
/** How long the new repository's default branch may take to appear (GitHub copies the template afterwards). */
const BRANCH_ATTEMPTS = 15;
const BRANCH_INTERVAL_MS = 1000;
const WRANGLER_FILES = ['wrangler.jsonc', 'wrangler.json'];

/** A GitHub repository name, which is also the project's name. */
const repositoryName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, ".", "-" and "_".')
  .refine((name) => name !== '.' && name !== '..' && slugify(name) !== '', 'Choose another name.');

export const templateRequestSchema = z.object({
  template: z.string().min(1).max(100),
  name: repositoryName,
  /** An organization's slug: the repository and the project are the organization's. */
  org: z.string().min(1).max(100).optional(),
  private: z.boolean(),
  locale: z.string().max(20).optional(),
});
export type TemplateInput = z.infer<typeof templateRequestSchema>;
type TemplateRequest = TemplateInput & { userId: string; expiresAt: number };

const requestKey = async (state: string) => `template_request:${await sha256Hex(state)}`;
const passwordKey = (projectId: string) => `template_password:${projectId}`;
const passwordContext = (projectId: string, userId: string) => `template_password:${projectId}:${userId}`;

/** The production Worker's name in the owner's account (wrangler.jsonc "name"): the project's slug. */
export function templateWorkerName(name: string): string {
  return slugify(name).slice(0, 54).replace(/-+$/, '') || 'project';
}
const databaseName = (script: string) => `${script}-db`;

/** The token cannot create D1 databases: the panel links to the token's page on Cloudflare. */
const d1PermissionError = () =>
  new HttpError(
    403,
    'The Cloudflare token cannot create D1 databases. Edit the token in the Cloudflare dashboard (My Profile › API Tokens), add the "D1: Edit" permission and try again.',
    { code: 'd1_permission' },
  );

type Target = {
  template: ProjectTemplate;
  org: Org | undefined;
  connection: typeof cfConnections.$inferSelect;
  cf: CloudflareClient;
  script: string;
};

/**
 * What can be checked before anything is created: the template, the owner (an organization the user is a member
 * of), its subscription and Cloudflare connection, the D1 permission, and the names the project would take in the
 * owner's account. Runs when the request starts and again with the user's token, before the repository exists.
 */
async function prepare(db: Db, env: Env, user: User, input: TemplateInput): Promise<Target> {
  const template = findTemplate(input.template);
  if (template === undefined) throw notFound('Template not found.');
  const org = input.org === undefined ? undefined : (await orgAccess(db, input.org, user)).org;
  const owner = org === undefined ? userOwner(user.id) : orgOwner(org.id);
  await requireSubscription(db, env, owner);
  const connection = await db.select().from(cfConnections).where(connectionsOf(owner)).get();
  if (connection === undefined) {
    throw badRequest(
      org === undefined
        ? 'Connect a Cloudflare account first.'
        : 'Connect a Cloudflare account to the organization first.',
    );
  }
  if (org !== undefined) {
    if (org.installationId === null) throw badRequest('Install the GitHub App on the organization first.');
    await ensureFreeRepository(db, org.githubLogin, input.name);
  }
  const cf = await accountClient(db, env, connection.id, connection.accountId);
  const script = templateWorkerName(input.name);
  if (template.database) {
    let existing: D1Database | null;
    try {
      existing = await findD1Database(cf, connection.accountId, databaseName(script));
    } catch (error) {
      if (isPermissionError(error)) throw d1PermissionError();
      throw error;
    }
    if (existing !== null) {
      throw conflict(
        `The Cloudflare account already has a D1 database named ${databaseName(script)}. Choose another project name.`,
      );
    }
  }
  if ((await getAccountScriptSettings(cf, connection.accountId, script)) !== null) {
    throw conflict(`The Cloudflare account already has a Worker named ${script}. Choose another project name.`);
  }
  return { template, org, connection, cf, script };
}

async function ensureFreeRepository(db: Db, owner: string, name: string): Promise<void> {
  const repoKey = `${owner}/${name}`.toLowerCase();
  if ((await db.select().from(projects).where(eq(projects.repoKey, repoKey)).get()) !== undefined) {
    throw conflict(`${owner}/${name} is already a bohr project.`);
  }
}

/** Step 1: checks the request and keeps it for the authorization that comes back with `state`. */
export async function startTemplateRequest(
  db: Db,
  env: Env,
  user: User,
  input: TemplateInput,
  state: string,
): Promise<void> {
  await prepare(db, env, user, input);
  const request: TemplateRequest = { ...input, userId: user.id, expiresAt: Date.now() + REQUEST_TTL_MS };
  await writeSetting(db, await requestKey(state), request);
}

/** The request kept for `state`, once: only for the user who made it, and only before it expires. */
export async function takeTemplateRequest(db: Db, state: string, userId: string): Promise<TemplateInput> {
  const key = await requestKey(state);
  const request = await readSetting<TemplateRequest>(db, key);
  if (request === null || request.expiresAt < Date.now() || request.userId !== userId) {
    throw badRequest('The request expired; please try again.');
  }
  await deleteSetting(db, key);
  const { userId: _user, expiresAt: _expires, ...input } = request;
  return input;
}

/** A failure after the repository was created: it stays on GitHub, and the message says so. */
function keepingRepository(error: unknown, repository: string): HttpError {
  const kept = `The repository ${repository} was created on GitHub and stays there: delete it, or create the project from it as one of your repositories.`;
  if (error instanceof HttpError) return new HttpError(error.status, `${error.message} ${kept}`, error.details);
  console.error('[templates]', error);
  const message = error instanceof Error ? error.message : String(error);
  return new HttpError(502, `Could not set up the project (${message}). ${kept}`);
}

/** The installation of the App on the user's own GitHub account, as bohr recorded it for them. */
async function personalInstallation(db: Db, github: GithubClient, userId: string, login: string): Promise<number> {
  const recorded = await db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)).all();
  const byLogin = recorded.find((row) => row.accountLogin.toLowerCase() === login.toLowerCase());
  if (byLogin !== undefined) return byLogin.id;
  // Recorded before the webhook told its account: ask GitHub which of them is on this account
  const ids = new Set(recorded.map((row) => row.id));
  const found = (await github.listUserInstallations()).find(
    (installation) => ids.has(installation.id) && installation.account.login.toLowerCase() === login.toLowerCase(),
  );
  if (found === undefined) {
    throw badRequest(`Install the GitHub App on your GitHub account (${login}) first, then try again.`);
  }
  return found.id;
}

/** Generates the repository and waits until GitHub copied the template into its default branch. */
async function generateRepository(
  github: GithubClient,
  template: ProjectTemplate,
  input: { owner: string; name: string; private: boolean; description: string },
): Promise<RepositorySummary> {
  const [templateOwner = '', templateRepo = ''] = template.repository.split('/');
  let repository: RepositorySummary;
  try {
    repository = await github.generateRepository(templateOwner, templateRepo, input);
  } catch (error) {
    if (!(error instanceof GithubError)) throw error;
    if (error.status === 422) {
      throw conflict(
        `GitHub did not create ${input.owner}/${input.name} (${error.message}). A repository with this name may already exist: choose another name.`,
      );
    }
    if (error.status === 403 || error.status === 404) {
      throw forbidden(
        `GitHub did not let bohr create a repository in ${input.owner} (${error.message}). You need to be able to create repositories there, and the GitHub App needs the Administration permission (accept it in the App's installation settings on GitHub).`,
      );
    }
    throw error;
  }
  for (let attempt = 0; attempt < BRANCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await deps.sleep(BRANCH_INTERVAL_MS);
    // While GitHub still copies the template the repository is empty, which it answers with 409
    const head = await github
      .getBranchSha(repository.owner.login, repository.name, repository.default_branch)
      .catch((error: unknown) => {
        if (error instanceof GithubError && error.status === 409) return null;
        throw error;
      });
    if (head !== null) return repository;
  }
  throw keepingRepository(new HttpError(504, 'GitHub is taking too long to copy the template.'), repository.full_name);
}

/**
 * Rewrites the template's wrangler config for the project: the Worker's name and, when the template has a
 * database, the first D1 binding's database (the template commits TEMPLATE_DATABASE_PLACEHOLDER as its id).
 * Targeted replacements keep the template's comments; when they would not give exactly the expected config, the
 * config is written again as JSON (after its leading comments).
 */
export function rewriteWranglerConfig(text: string, values: { name: string; database: D1Database | null }): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  } catch {
    throw conflict("The template's wrangler config could not be read.");
  }
  const databases = Array.isArray(config.d1_databases) ? (config.d1_databases as Record<string, unknown>[]) : [];
  const [first, ...others] = databases;
  if (values.database !== null && first === undefined) {
    throw conflict("The template's wrangler config has no D1 database to connect.");
  }
  const expected: Record<string, unknown> = {
    ...config,
    name: values.name,
    ...(values.database === null || first === undefined
      ? {}
      : {
          d1_databases: [
            { ...first, database_name: values.database.name, database_id: values.database.uuid },
            ...others,
          ],
        }),
  };
  const literal = (value: unknown) => JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = text;
  if (typeof config.name === 'string') {
    out = out.replace(new RegExp(`("name"\\s*:\\s*)${literal(config.name)}`), (_, key: string) => {
      return `${key}${JSON.stringify(values.name)}`;
    });
  }
  if (values.database !== null && first !== undefined) {
    const database = values.database;
    if (typeof first.database_name === 'string') {
      out = out.replace(new RegExp(`("database_name"\\s*:\\s*)${literal(first.database_name)}`), (_, key: string) => {
        return `${key}${JSON.stringify(database.name)}`;
      });
    }
    const id = typeof first.database_id === 'string' ? first.database_id : TEMPLATE_DATABASE_PLACEHOLDER;
    out = out.replace(new RegExp(`("database_id"\\s*:\\s*)${literal(id)}`), (_, key: string) => {
      return `${key}${JSON.stringify(database.uuid)}`;
    });
  }
  try {
    if (JSON.stringify(JSON.parse(stripJsonComments(out))) === JSON.stringify(expected)) return out;
  } catch {
    // Written again below
  }
  const header = text.match(/^(\s*\/\/[^\n]*\n)*/)?.[0] ?? '';
  return `${header}${JSON.stringify(expected, null, 2)}\n`;
}

/**
 * The repository's setup, on the production branch with the installation's token: wrangler.jsonc (one commit,
 * "bohr: set up the project"), .bohr/deploy.json when the template has none, and the deploy workflow last, so
 * its push deploys the configured project. A workflow the template brings that bohr did not write stays.
 */
async function setUpRepository(
  db: Db,
  env: Env,
  project: Project,
  values: { script: string; database: D1Database | null },
): Promise<void> {
  const github = new GithubClient({
    token: (await repositoryToken(db, env, project, 'worker')).token,
    fetch: deps.fetch,
  });
  const { repoOwner: owner, repoName: repo, productionBranch: branch } = project;
  const read = (path: string) => github.getFile(owner, repo, path, branch);

  const deployFile = await read(DEPLOY_CONFIG_PATH);
  let raw: unknown = {};
  if (deployFile !== null) {
    try {
      raw = JSON.parse(deployFile.content);
    } catch {
      throw conflict(`The template's ${DEPLOY_CONFIG_PATH} is not valid JSON.`);
    }
  } else {
    // No deploy config: npm, with the install and build the package declares
    const lockfile = await read('package-lock.json');
    const manifest = await read('package.json');
    let scripts: Record<string, unknown> = {};
    try {
      scripts = (JSON.parse(manifest?.content ?? '{}') as { scripts?: Record<string, unknown> }).scripts ?? {};
    } catch {
      // The build step is left out
    }
    raw = {
      ...(manifest === null ? {} : { install: lockfile === null ? 'npm install' : 'npm ci' }),
      ...(typeof scripts.build === 'string' ? { build: 'npm run build' } : {}),
    };
  }
  const parsed = deployConfigSchema.safeParse(raw);
  if (!parsed.success) throw conflict(`The template's ${DEPLOY_CONFIG_PATH} is not valid.`);
  const config = parsed.data;
  const prefix = config.directory === '.' ? '' : `${config.directory.replace(/\/+$/, '')}/`;

  let wrangler: { path: string; content: string; sha: string } | null = null;
  for (const file of WRANGLER_FILES) {
    const found = await read(`${prefix}${file}`);
    if (found !== null) {
      wrangler = { path: `${prefix}${file}`, ...found };
      break;
    }
  }
  if (wrangler === null) throw conflict(`The template has no wrangler.jsonc in ${prefix || 'its root'}.`);
  const content = rewriteWranglerConfig(wrangler.content, { name: values.script, database: values.database });
  if (content !== wrangler.content) {
    await github.putFile(owner, repo, wrangler.path, {
      content,
      message: 'bohr: set up the project',
      branch,
      sha: wrangler.sha,
    });
  }
  if (deployFile === null) {
    await github.putFile(owner, repo, DEPLOY_CONFIG_PATH, {
      content: `${JSON.stringify(raw, null, 2)}\n`,
      message: `bohr: ${DEPLOY_CONFIG_PATH}`,
      branch,
    });
  }

  const workflow = renderDeployWorkflow(config, {
    productionBranch: branch,
    target: 'wrangler',
    instanceUrl: (await instanceUrl(db, env)) ?? undefined,
    d1Migrations: d1MigrationBindings(JSON.parse(stripJsonComments(content))).length > 0,
  });
  const current = await read(DEPLOY_WORKFLOW_PATH);
  if (current !== null && (current.content === workflow || !current.content.startsWith(DEPLOY_WORKFLOW_HEADER))) {
    return;
  }
  await github.putFile(owner, repo, DEPLOY_WORKFLOW_PATH, {
    content: workflow,
    message: `bohr: deploy workflow from ${DEPLOY_CONFIG_PATH}`,
    branch,
    ...(current !== null ? { sha: current.sha } : {}),
  });
}

/**
 * Step 2, with the user's GitHub token (never stored): the repository, then everything a project from a
 * repository has, plus its database and admin password. Returns the project; provisioning starts afterwards.
 */
export async function createFromTemplate(
  db: Db,
  env: Env,
  user: User,
  input: TemplateInput,
  userToken: string,
): Promise<{ projectId: string; org: string | null; runtime: boolean }> {
  const { template, org, connection, cf, script } = await prepare(db, env, user, input);
  const github = new GithubClient({ token: userToken, fetch: deps.fetch });
  const profile = await github.getAuthenticatedUser();
  // The GitHub account behind the token must be the one linked to this bohr account, when there is one
  const linked = await db
    .select()
    .from(identities)
    .where(and(eq(identities.userId, user.id), eq(identities.provider, 'github')))
    .get();
  if (linked !== undefined && linked.providerUserId !== String(profile.id)) {
    throw forbidden(
      `GitHub authorized ${profile.login}, but this bohr account uses ${linked.username ?? 'another GitHub account'}. Sign in to GitHub with that account and try again.`,
    );
  }
  const owner = org?.githubLogin ?? profile.login;
  const installationId = org?.installationId ?? (await personalInstallation(db, github, user.id, profile.login));
  await ensureFreeRepository(db, owner, input.name);

  const repository = await generateRepository(github, template, {
    owner,
    name: input.name,
    private: input.private,
    description: template.locales[normalizeLocale(input.locale)].description,
  });
  let database: D1Database | null = null;
  let projectId: string | null = null;
  let runtime = false;
  let placeholder = false;
  try {
    // The App reaches new repositories by itself only when it was given every repository of the account
    const installation = await fetchInstallation(db, env, installationId);
    if (installation?.repository_selection !== 'all') {
      await github.addRepositoryToInstallation(installationId, repository.id).catch((error: unknown) => {
        throw new HttpError(
          403,
          `GitHub did not give the GitHub App access to the new repository (${error instanceof Error ? error.message : String(error)}). Add it to the App's repositories on GitHub.`,
        );
      });
    }
    if (template.database) {
      try {
        database = await createD1Database(cf, connection.accountId, databaseName(script));
      } catch (error) {
        if (isPermissionError(error)) throw d1PermissionError();
        throw error;
      }
    }
    ({ projectId, runtime } = await createProject(db, env, user.id, {
      repoOwner: repository.owner.login,
      repoName: repository.name,
      repoId: repository.id,
      productionBranch: repository.default_branch,
      name: input.name,
      cfConnectionId: connection.id,
      ...(org === undefined ? {} : { orgId: org.id }),
    }));
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (project === undefined) throw notFound('Project not found.');
    const password = randomToken(18);
    ({ placeholder } = await presetSiteSecret(db, env, project, {
      script,
      key: TEMPLATE_ADMIN_PASSWORD,
      value: password,
    }));
    await setUpRepository(db, env, project, { script, database });

    const subdomain = connection.workersSubdomain;
    await writeSetting(db, passwordKey(projectId), {
      userId: user.id,
      password: await vault(env).seal(password, passwordContext(projectId, user.id)),
      url: subdomain ? `https://${script}.${subdomain}.workers.dev` : null,
      expiresAt: Date.now() + PASSWORD_TTL_MS,
    });
    await audit(db, {
      actorUserId: user.id,
      actor: `user:${user.id}`,
      action: 'project.template',
      target: projectId,
      metadata: { template: template.slug, repository: repository.full_name, database: database?.uuid ?? null },
    });
    return { projectId, org: org?.slug ?? null, runtime };
  } catch (error) {
    // Undone in reverse; the repository stays
    if (placeholder) {
      await deleteAccountScript(cf, connection.accountId, script).catch((cleanup: unknown) =>
        console.error('[templates] could not remove the placeholder Worker', script, cleanup),
      );
    }
    if (projectId !== null) await db.delete(projects).where(eq(projects.id, projectId)).run();
    if (database !== null) {
      const id = database.uuid;
      await deleteD1Database(cf, connection.accountId, id).catch((cleanup: unknown) =>
        console.error('[templates] could not remove the database', id, cleanup),
      );
    }
    throw keepingRepository(error, repository.full_name);
  }
}

type StoredPassword = { userId: string; password: string; url: string | null; expiresAt: number };

/** Step 3: the admin password of a project just created from a template, once, for who created it. */
export async function revealAdminPassword(
  db: Db,
  env: Env,
  userId: string,
  projectId: string,
): Promise<{ password: string; url: string | null } | null> {
  const stored = await readSetting<StoredPassword>(db, passwordKey(projectId));
  if (stored === null || stored.userId !== userId) return null;
  await deleteSetting(db, passwordKey(projectId));
  if (stored.expiresAt < Date.now()) return null;
  return {
    password: await vault(env).open(stored.password, passwordContext(projectId, userId)),
    url: stored.url,
  };
}
