import {
  type AssetsConfig,
  type CloudflareClient,
  CloudflareError,
  createDispatchAssetsUploadSession,
  putDispatchScript,
  type ScriptBinding,
  type ScriptModule,
} from '@bohr/cloudflare';
import { and, countDistinct, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Deployment, Hostname, Project } from '../db/client';
import {
  ALL_BRANCHES,
  type AssetsSessionConfig,
  buildPlans,
  deployments,
  deploySessions,
  envVars,
  hostnames,
  projects,
  v1Migrations,
} from '../db/schema';
import type { Env, User } from '../env';
import { cloudEnv } from '../lib/cloud';
import { randomId } from '../lib/crypto';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http';
import { scriptName, slugify } from '../lib/names';
import { branchFromRef, type GithubActionsClaims } from '../lib/oidc';
import { type ApiToken, tokenProjectAccess } from './api-tokens';
import { audit } from './audit';
import { cutoverHostname, ensureBranchHostnames, writeBranchRoutes, writeProjectRoutes } from './routing';
import { refreshScreenshot } from './screenshots';
import { runtimeSecretsFor } from './secrets';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/**
 * Preview branches an API token may bring a project to: a deploy of a branch without an address yet is refused
 * once the project has this many preview branches (with an address), so a script or an agent that deploys a
 * branch per change cannot fill bohr with Workers and hostnames. The repository's workflow is not limited.
 */
export const MAX_TOKEN_PREVIEW_BRANCHES = 20;
const ASSETS_ONLY_MODULE = 'bohr-assets-only.js';
const ASSETS_ONLY_SOURCE = 'export default { fetch(request, env) { return env.ASSETS.fetch(request); } };\n';
const MODULE_TYPES = new Set([
  'application/javascript+module',
  'application/javascript',
  'text/javascript',
  'application/source-map',
  'application/wasm',
  'application/json',
  'application/octet-stream',
  'text/plain',
]);

const routingFileSchema = z
  .string()
  .max(256 * 1024)
  .optional();

const assetsConfigSchema = z
  .object({
    notFoundHandling: z.enum(['single-page-application', '404-page', 'none']).optional(),
    htmlHandling: z.enum(['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none']).optional(),
    runWorkerFirst: z.union([z.boolean(), z.array(z.string().max(256)).max(100)]).optional(),
    // Contents of the _redirects and _headers files at the root of the assets directory
    redirects: routingFileSchema,
    headers: routingFileSchema,
  })
  .default({});

const sessionBodySchema = z.object({
  manifest: z
    .record(
      z.string().regex(/^\/[^\0]{0,1023}$/),
      z.object({ hash: z.string().regex(/^[0-9a-f]{32}$/), size: z.number().int().nonnegative() }),
    )
    .default({}),
  assetsConfig: assetsConfigSchema,
});

const metadataSchema = z.object({
  mainModule: z.string().min(1).max(256).nullable(),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibilityFlags: z.array(z.string().max(100)).max(32).default([]),
  vars: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
  assetsBinding: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .nullable()
    .default(null),
  assetsCompletionToken: z.string().min(1).nullable().default(null),
  commitSha: z.string().max(64).optional(),
});

type DeployMetadata = z.infer<typeof metadataSchema>;

/** A git branch name, as `git check-ref-format --branch` would accept it (ASCII control characters excluded). */
export const branchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) => !/[\p{Cc}\s~^:?*[\\]/u.test(name) && !/\.\.|@\{|\/\/|^[/.-]|[/.]$|\.lock$/.test(name) && name !== '@',
    'Not a valid branch name.',
  );

// What a deploy with an API token (the CLI) names; a GitHub OIDC token says it with its repository and ref
const tokenTargetSchema = z.object({
  projectId: z.string().min(1).max(100),
  branch: branchSchema,
  // Must say so to publish the production branch, so a preview never becomes production by mistake
  production: z.boolean().default(false),
});

/** Who calls the deploy API: a GitHub Actions run (its OIDC claims) or an API token (the CLI, an agent). */
export type DeployCaller =
  | { kind: 'github'; claims: GithubActionsClaims }
  | { kind: 'token'; user: User; token: ApiToken };

export const OWN_ACCOUNT_MESSAGE =
  "This project runs in its owner's Cloudflare account: bohr does not host it, so the deploy API does not publish it. The bohr CLI (4.1 or later) deploys it with wrangler in that account; or push to its production branch to deploy it with its workflow.";

const toCloudflareAssetsConfig = (config: AssetsSessionConfig | null): AssetsConfig => ({
  ...(config?.notFoundHandling ? { not_found_handling: config.notFoundHandling } : {}),
  ...(config?.htmlHandling ? { html_handling: config.htmlHandling } : {}),
  ...(config?.runWorkerFirst !== undefined ? { run_worker_first: config.runWorkerFirst } : {}),
  ...(config?.redirects !== undefined ? { _redirects: config.redirects } : {}),
  ...(config?.headers !== undefined ? { _headers: config.headers } : {}),
});

// The managed project a GitHub Actions run deploys, from its OIDC claims
export async function projectForClaims(db: Db, claims: GithubActionsClaims) {
  const project = await db.select().from(projects).where(eq(projects.repoKey, claims.repository.toLowerCase())).get();
  if (project === undefined || project.mode !== 'managed') {
    throw notFound(`No bohr.io Cloud project is linked to ${claims.repository}.`);
  }
  if (project.status === 'suspended') throw forbidden('This project is suspended.');
  if (project.repoId !== null) {
    // Same name, different repository: it was deleted or renamed and the name taken by someone else
    if (claims.repository_id !== String(project.repoId)) {
      throw forbidden(`${claims.repository} is not the repository this project was created from.`);
    }
  } else if (claims.repository_id !== undefined && /^\d+$/.test(claims.repository_id)) {
    // Imported from v1 without an id: the first deploy records it
    await db
      .update(projects)
      .set({ repoId: Number(claims.repository_id) })
      .where(eq(projects.id, project.id))
      .run();
    project.repoId = Number(claims.repository_id);
  }
  const branch = branchFromRef(claims.ref);
  if (branch === null)
    throw badRequest('Only pushes to branches deploy; tags and pull requests are not supported yet.');
  return { project, branch };
}

/**
 * The project and branch an API token deploys: one the token reaches, that bohr hosts and is not suspended. A
 * preview (any branch but production) needs a member; production needs `production: true` and an owner (an admin
 * of the project's organization), and a project whose production address bohr v1 still serves is left to its
 * workflow, whose first production deploy moves it (followProduction). The error codes are the CLI's (its
 * "not allowed" exit code).
 */
export async function projectForToken(db: Db, caller: Extract<DeployCaller, { kind: 'token' }>, body: unknown) {
  const target = tokenTargetSchema.parse(body);
  const { project, role } = await tokenProjectAccess(db, caller, target.projectId);
  await assertTokenMayDeploy(db, project, role, target.branch, target.production);
  return { project, branch: target.branch };
}

async function assertTokenMayDeploy(
  db: Db,
  project: Project,
  role: 'owner' | 'member',
  branch: string,
  production: boolean,
) {
  if (project.mode !== 'managed') throw conflict(OWN_ACCOUNT_MESSAGE, { code: 'own_account' });
  if (project.status === 'suspended') throw forbidden('This project is suspended.');
  const isProduction = branch === project.productionBranch;
  if (isProduction && !production) {
    throw conflict(
      `${branch} is the production branch of this project: deploy it with --prod (production: true), or deploy a preview on another branch.`,
      { code: 'production_branch' },
    );
  }
  if (!isProduction && production) {
    throw badRequest(`production: true deploys the production branch (${project.productionBranch}), not ${branch}.`);
  }
  if (!isProduction) return assertPreviewBranchAllowed(db, project, branch);
  if (role !== 'owner') {
    throw new HttpError(403, 'Only owners of the project (admins of its organization) can deploy production.', {
      code: 'production_not_allowed',
    });
  }
  const onV1 = await db
    .select({ hostname: hostnames.hostname })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.isProduction, true), eq(hostnames.status, 'pending')))
    .get();
  if (onV1 !== undefined) {
    throw conflict(
      `${onV1.hostname} is still served by bohr v1: the first production deploy on bohr v2 comes from the repository's workflow, which moves the address. Deploy previews until then.`,
      { code: 'production_on_v1' },
    );
  }
}

/** A preview branch a token deploys: one that has an address already, or a new one under the project's cap. */
async function assertPreviewBranchAllowed(db: Db, project: Project, branch: string) {
  const existing = await db
    .select({ hostname: hostnames.hostname })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.branch, branch)))
    .get();
  if (existing !== undefined) return;
  const counted = await db
    .select({ branches: countDistinct(hostnames.branch) })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.isProduction, false)))
    .get();
  const branches = counted?.branches ?? 0;
  if (branches >= MAX_TOKEN_PREVIEW_BRANCHES) {
    throw conflict(
      `This project already has ${branches} preview branches, the most a token can create (${MAX_TOKEN_PREVIEW_BRANCHES}). Delete old previews before deploying a new branch, or deploy to one of the existing preview branches.`,
      { code: 'too_many_previews' },
    );
  }
}

export async function createDeploySession(db: Db, env: Env, cf: CloudflareClient, caller: DeployCaller, body: unknown) {
  const { project, branch } =
    caller.kind === 'github' ? await projectForClaims(db, caller.claims) : await projectForToken(db, caller, body);
  const { manifest, assetsConfig } = sessionBodySchema.parse(body);
  const script = await scriptName(project.id, branch);
  const hasAssets = Object.keys(manifest).length > 0;

  const upload = hasAssets
    ? await createDispatchAssetsUploadSession(cf, cloudEnv(env).DISPATCH_NAMESPACE, script, manifest)
    : null;
  const id = randomId('ds_', 20);
  await db
    .insert(deploySessions)
    .values({
      id,
      projectId: project.id,
      branch,
      script,
      repoKey: project.repoKey,
      assetsConfig,
      hasAssets,
      tokenId: caller.kind === 'token' ? caller.token.id : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .run();
  if (hasAssets) await cloudEnv(env).BUNDLES.put(`sessions/${id}/manifest.json`, JSON.stringify(manifest));

  return {
    sessionId: id,
    accountId: cloudEnv(env).CF_ACCOUNT_ID,
    uploadToken: upload?.jwt ?? null,
    buckets: upload?.buckets ?? [],
  };
}

// Plain vars for a branch: the wrangler config's, overridden by the project's (project-wide, then branch)
async function plainVarsFor(db: Db, projectId: string, branch: string, fromConfig: Record<string, string>) {
  const rows = await db
    .select()
    .from(envVars)
    .where(
      and(
        eq(envVars.projectId, projectId),
        eq(envVars.target, 'runtime'),
        eq(envVars.isSecret, false),
        inArray(envVars.branch, [ALL_BRANCHES, branch]),
      ),
    )
    .all();
  const vars = { ...fromConfig };
  for (const row of rows.filter((r) => r.branch === ALL_BRANCHES)) vars[row.key] = row.value ?? '';
  for (const row of rows.filter((r) => r.branch !== ALL_BRANCHES)) vars[row.key] = row.value ?? '';
  return vars;
}

async function readModules(form: FormData): Promise<ScriptModule[]> {
  const modules: ScriptModule[] = [];
  for (const [name, value] of form.entries()) {
    if (name === 'metadata') continue;
    if (typeof value === 'string') throw badRequest(`Module ${name} must be sent as a file.`);
    if (name.length > 256 || name.startsWith('/') || name.split('/').includes('..') || name === ASSETS_ONLY_MODULE) {
      throw badRequest(`Invalid module name: ${name}`);
    }
    const type = value.type.split(';')[0]?.trim() || 'application/octet-stream';
    if (!MODULE_TYPES.has(type)) throw badRequest(`Unsupported module type ${type} for ${name}.`);
    modules.push({ name, content: await value.arrayBuffer(), type });
  }
  return modules;
}

async function readMetadata(form: FormData) {
  const raw = form.get('metadata');
  const text = typeof raw === 'string' ? raw : raw instanceof File ? await raw.text() : null;
  if (text === null) throw badRequest('Missing metadata.');
  try {
    return metadataSchema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw badRequest('metadata is not valid JSON.');
    throw error;
  }
}

type UploadInput = {
  project: Project;
  branch: string;
  script: string;
  metadata: DeployMetadata;
  modules: ScriptModule[];
  assets: { completionToken: string; config: AssetsSessionConfig | null; manifestKey: string } | null;
  actor: string;
  actorUserId?: string | null;
  /** Runs work after the response (the route's waitUntil): the production site's new picture. */
  background?: (task: Promise<unknown>) => void;
};

// Uploads a script version (vars and secrets bound from the project's current settings) and records the deployment
async function uploadAndRecord(db: Db, env: Env, cf: CloudflareClient, input: UploadInput) {
  const { project, branch, script, metadata } = input;
  let modules = input.modules;
  let mainModule = metadata.mainModule;
  let assetsBinding = metadata.assetsBinding;

  if (mainModule === null) {
    if (input.assets === null) throw badRequest('Nothing to deploy: no Worker module and no assets.');
    modules = [{ name: ASSETS_ONLY_MODULE, content: ASSETS_ONLY_SOURCE, type: 'application/javascript+module' }];
    mainModule = ASSETS_ONLY_MODULE;
    assetsBinding = 'ASSETS';
  } else if (!modules.some((module) => module.name === mainModule)) {
    throw badRequest(`The main module ${mainModule} was not uploaded.`);
  }

  const secrets = await runtimeSecretsFor(db, env, project.id, branch);
  const vars = await plainVarsFor(db, project.id, branch, metadata.vars);
  const bindings: ScriptBinding[] = [
    ...Object.entries(vars)
      .filter(([name]) => !secrets.has(name))
      .map(([name, text]): ScriptBinding => ({ type: 'plain_text', name, text })),
    ...[...secrets].map(([name, text]): ScriptBinding => ({ type: 'secret_text', name, text })),
  ];
  if (input.assets !== null) bindings.push({ type: 'assets', name: assetsBinding ?? 'ASSETS' });

  const deploymentId = randomId('d_', 16);
  const bundleKey = `deploys/${project.id}/${deploymentId}`;
  await db
    .insert(deployments)
    .values({
      id: deploymentId,
      projectId: project.id,
      branch,
      script,
      commitSha: metadata.commitSha ?? null,
      status: 'building',
      actor: input.actor,
    })
    .run();

  try {
    await putDispatchScript(
      cf,
      cloudEnv(env).DISPATCH_NAMESPACE,
      script,
      {
        main_module: mainModule,
        compatibility_date: metadata.compatibilityDate,
        compatibility_flags: metadata.compatibilityFlags,
        bindings,
        ...(input.assets !== null
          ? { assets: { jwt: input.assets.completionToken, config: toCloudflareAssetsConfig(input.assets.config) } }
          : {}),
        tags: ['bohr', `project:${project.id}`, `branch:${slugify(branch).slice(0, 60)}`],
        annotations: {
          'workers/message': 'bohr',
          ...(metadata.commitSha ? { 'workers/tag': metadata.commitSha.slice(0, 12) } : {}),
        },
        observability: { enabled: true },
      },
      modules,
    );
  } catch (error) {
    const message = error instanceof CloudflareError ? error.message : 'Upload failed.';
    await db
      .update(deployments)
      .set({ status: 'error', error: message, finishedAt: new Date() })
      .where(eq(deployments.id, deploymentId))
      .run();
    console.error('Script upload failed', error);
    throw new HttpError(502, `Cloudflare rejected the deploy: ${message}`);
  }

  // The bundle is kept without secrets or upload tokens, for audit and redeploys
  const stored = { ...metadata, mainModule, assetsBinding, assetsCompletionToken: null };
  await Promise.all([
    cloudEnv(env).BUNDLES.put(
      `${bundleKey}/metadata.json`,
      JSON.stringify({
        metadata: stored,
        assetsConfig: input.assets?.config ?? null,
        modules: modules.map(({ name, type }) => ({ name, type })),
      }),
    ),
    ...modules.map((module) =>
      cloudEnv(env).BUNDLES.put(`${bundleKey}/modules/${module.name}`, module.content, {
        httpMetadata: { contentType: module.type },
      }),
    ),
    input.assets !== null
      ? copyObject(cloudEnv(env).BUNDLES, input.assets.manifestKey, `${bundleKey}/manifest.json`)
      : null,
  ]);

  await db
    .update(deployments)
    .set({ status: 'success', bundleKey, finishedAt: new Date() })
    .where(eq(deployments.id, deploymentId))
    .run();

  const rows = await ensureBranchHostnames(db, env, cf, project, branch);
  await writeBranchRoutes(db, env, project, branch);
  if (branch === project.productionBranch) await followProduction(db, env, cf, project, rows);
  // A migrated project whose production already moved: a preview branch's v1 address follows on its first
  // deploy here (v1 no longer deploys it, so its address would show an old copy)
  const pendingHere = rows.filter(
    (row) => row.status === 'pending' && !row.isProduction && !row.hostname.startsWith('*.'),
  );
  if (pendingHere.length > 0) {
    const productionLive = await db
      .select({ hostname: hostnames.hostname })
      .from(hostnames)
      .where(and(eq(hostnames.projectId, project.id), eq(hostnames.isProduction, true), eq(hostnames.status, 'live')))
      .get();
    if (productionLive !== undefined) {
      for (const row of pendingHere) {
        await cutoverHostname(db, env, cf, row).catch((error: unknown) =>
          console.error('[deploy] could not move', row.hostname, error),
        );
      }
    }
  }
  await db
    .update(v1Migrations)
    .set({ status: 'deployed', updatedAt: new Date() })
    .where(and(eq(v1Migrations.projectId, project.id), eq(v1Migrations.status, 'imported')))
    .run();
  await audit(db, {
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
    action: 'deploy',
    target: project.id,
    metadata: { deploymentId, branch, script, commitSha: metadata.commitSha ?? null },
  });

  // The project card's picture of the site, once production changed (services/screenshots.ts)
  if (branch === project.productionBranch) input.background?.(refreshScreenshot(db, env, project, 'deploy'));

  const primary = rows.find((row) => row.isProduction) ?? rows[0];
  return { deploymentId, script, url: primary ? `https://${primary.hostname.replace(/^\*\./, '')}` : null };
}

// A migrated project with a published build plan deploys its pushes here instead of on v1, so its production
// address moves on the first successful production deploy (else v1 would keep serving a copy that no longer
// updates). A project whose cutover was rolled back stays where it is until moved by hand.
async function followProduction(db: Db, env: Env, cf: CloudflareClient, project: Project, rows: Hostname[]) {
  const pending = rows.filter((row) => row.status === 'pending' && row.isProduction && !row.hostname.startsWith('*.'));
  if (pending.length === 0) return;
  const [migration, plan] = await Promise.all([
    db.select().from(v1Migrations).where(eq(v1Migrations.projectId, project.id)).get(),
    db.select({ projectId: buildPlans.projectId }).from(buildPlans).where(eq(buildPlans.projectId, project.id)).get(),
  ]);
  if (migration === undefined || migration.status === 'rolled_back' || plan === undefined) return;

  await writeProjectRoutes(db, env, project);
  const changes = [];
  for (const row of pending) {
    try {
      changes.push({ hostname: row.hostname, ...(await cutoverHostname(db, env, cf, row)) });
      row.status = 'live';
    } catch (error) {
      console.error('[deploy] could not move', row.hostname, error);
    }
  }
  // Live once production is: other branches' v1 addresses follow when those branches deploy here
  const remaining = await db
    .select({ hostname: hostnames.hostname })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.isProduction, true), eq(hostnames.status, 'pending')))
    .all();
  if (remaining.length === 0) {
    await db.batch([
      db.update(projects).set({ status: 'active', updatedAt: new Date() }).where(eq(projects.id, project.id)),
      db
        .update(v1Migrations)
        .set({ status: 'live', updatedAt: new Date() })
        .where(eq(v1Migrations.projectId, project.id)),
    ]);
  }
  await audit(db, { actor: 'deploy', action: 'cutover', target: project.id, metadata: { changes } });
}

async function copyObject(bucket: R2Bucket, from: string, to: string) {
  const object = await bucket.get(from);
  if (object !== null) await bucket.put(to, object.body);
}

export async function finalizeDeploy(
  db: Db,
  env: Env,
  cf: CloudflareClient,
  caller: DeployCaller,
  sessionId: string,
  form: FormData,
  background?: UploadInput['background'],
) {
  const session = await db.select().from(deploySessions).where(eq(deploySessions.id, sessionId)).get();
  if (session === undefined) throw notFound('Unknown deploy session.');
  if (session.expiresAt.getTime() < Date.now())
    throw new HttpError(410, 'This deploy session expired; run the deploy again.');
  let project: Project | undefined;
  if (caller.kind === 'github') {
    const { claims } = caller;
    if (
      session.tokenId !== null ||
      session.repoKey !== claims.repository.toLowerCase() ||
      session.branch !== branchFromRef(claims.ref)
    ) {
      throw forbidden('This deploy session belongs to another repository or branch.');
    }
    project = await db.select().from(projects).where(eq(projects.id, session.projectId)).get();
  } else {
    if (session.tokenId !== caller.token.id) throw forbidden('This deploy session was opened with another token.');
    // Checked again before publishing: access may have changed since the session opened
    const access = await tokenProjectAccess(db, caller, session.projectId);
    const production = session.branch === access.project.productionBranch;
    await assertTokenMayDeploy(db, access.project, access.role, session.branch, production);
    project = access.project;
  }
  if (project === undefined) throw notFound('Project not found.');

  const metadata = await readMetadata(form);
  const modules = await readModules(form);
  if (session.hasAssets && metadata.assetsCompletionToken === null) {
    throw badRequest('assetsCompletionToken is required: this session uploaded assets.');
  }

  const result = await uploadAndRecord(db, env, cf, {
    project,
    branch: session.branch,
    script: session.script,
    metadata,
    modules,
    assets:
      session.hasAssets && metadata.assetsCompletionToken !== null
        ? {
            completionToken: metadata.assetsCompletionToken,
            config: session.assetsConfig,
            manifestKey: `sessions/${session.id}/manifest.json`,
          }
        : null,
    ...(caller.kind === 'github'
      ? { actor: `github-actions:${caller.claims.repository}${caller.claims.run_id ? `#${caller.claims.run_id}` : ''}` }
      : { actor: `token:${caller.token.id}`, actorUserId: caller.user.id }),
    background,
  });

  await db.delete(deploySessions).where(eq(deploySessions.id, session.id)).run();
  await cloudEnv(env).BUNDLES.delete(`sessions/${session.id}/manifest.json`);
  return result;
}

// Publishes a stored deployment again; assets must still be in Cloudflare's store (no upload happens here)
export async function redeploy(
  db: Db,
  env: Env,
  cf: CloudflareClient,
  project: Project,
  deployment: Deployment,
  actorUserId: string,
  actor = `user:${actorUserId}`,
  background?: UploadInput['background'],
) {
  if (deployment.status !== 'success' || deployment.bundleKey === null) {
    throw conflict('Only successful deployments can be published again.');
  }
  const stored = await cloudEnv(env).BUNDLES.get(`${deployment.bundleKey}/metadata.json`);
  if (stored === null) throw conflict('The bundle of this deployment is no longer stored.');
  const bundle = (await stored.json()) as {
    metadata: DeployMetadata;
    assetsConfig: AssetsSessionConfig | null;
    modules: { name: string; type: string }[];
  };

  const modules: ScriptModule[] = [];
  for (const module of bundle.modules) {
    if (module.name === ASSETS_ONLY_MODULE) continue;
    const object = await cloudEnv(env).BUNDLES.get(`${deployment.bundleKey}/modules/${module.name}`);
    if (object === null) throw conflict(`Module ${module.name} of this deployment is no longer stored.`);
    modules.push({ name: module.name, content: await object.arrayBuffer(), type: module.type });
  }
  const metadata: DeployMetadata = {
    ...bundle.metadata,
    mainModule: bundle.metadata.mainModule === ASSETS_ONLY_MODULE ? null : bundle.metadata.mainModule,
  };

  let assets: UploadInput['assets'] = null;
  const manifest = await cloudEnv(env).BUNDLES.get(`${deployment.bundleKey}/manifest.json`);
  if (manifest !== null) {
    const session = await createDispatchAssetsUploadSession(
      cf,
      cloudEnv(env).DISPATCH_NAMESPACE,
      deployment.script,
      await manifest.json(),
    );
    if (session.buckets.length > 0) {
      throw conflict(
        `Some assets of this deployment are gone from Cloudflare; run the workflow again for commit ${deployment.commitSha ?? 'unknown'}.`,
      );
    }
    assets = {
      completionToken: session.jwt,
      config: bundle.assetsConfig,
      manifestKey: `${deployment.bundleKey}/manifest.json`,
    };
  }

  return uploadAndRecord(db, env, cf, {
    project,
    branch: deployment.branch,
    script: deployment.script,
    metadata,
    modules,
    assets,
    actor,
    actorUserId,
    background,
  });
}

// Expired sessions and their stored manifests (run from the scheduled handler)
export async function deleteExpiredSessions(db: Db, env: Env) {
  const expired = await db
    .select({ id: deploySessions.id })
    .from(deploySessions)
    .where(lt(deploySessions.expiresAt, new Date()))
    .all();
  for (const session of expired) {
    await cloudEnv(env).BUNDLES.delete(`sessions/${session.id}/manifest.json`);
    await db.delete(deploySessions).where(eq(deploySessions.id, session.id)).run();
  }
  return expired.length;
}
