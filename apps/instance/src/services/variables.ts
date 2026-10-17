// Environment variables of a project, as the panel manages them.
//
// - Site (runtime) variables reach the production Worker. In the owner's account they are Worker secrets
//   (secrets survive `wrangler deploy`), plain ones included; bohr keeps the plain values to show them and
//   never stores the secret ones. Projects bohr still hosts (migrated from v1) keep their own path: values
//   in D1, bound on every deploy (services/secrets.ts).
// - Build variables are sealed in bohr (env_vars.value_sealed). The deploy workflow of a project in its
//   owner's account gets them with the Cloudflare credentials (POST /api/deploy/credentials); the build of a
//   project bohr hosts (migrated from v1, still on bohr v1's workflow) with its build plan (POST
//   /api/deploy/build-plan). Older versions kept them as BOHR_BUILD_<NAME> Actions secrets: saving or deleting
//   one removes that copy.
import {
  CloudflareError,
  deleteAccountScriptSecret,
  getAccountScriptSettings,
  putAccountScriptSecret,
  uploadAccountScript,
} from '@bohr/cloudflare';
import { GithubClient } from '@bohr/github';
import { BUILD_VARIABLE_PREFIX, DEPLOY_CONFIG_PATH } from '@bohr/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { cfConnections, envVars, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { badRequest, conflict, HttpError } from '../lib/http';
import { vault } from '../lib/vault';
import { repositoryToken } from './github-app';
import { stripJsonComments } from './move';
import { accountClient, RUNTIME_COMPATIBILITY_DATE } from './provision';
import { deleteRuntimeSecret, setRuntimeSecret } from './secrets';
import { readSetting } from './settings';

const ALL_BRANCHES = '*';
export type VariableTarget = 'runtime' | 'build';
/** What a build variable's sealed value is bound to: its project, branch and name. */
export const buildVariableContext = (projectId: string, branch: string, key: string) =>
  `build_variable:${projectId}:${branch}:${key}`;

/**
 * A branch's build variables sealed in bohr: project-wide, overridden by the branch's own. Rows without a
 * sealed value are older ones, whose value is still an Actions secret, and are left out.
 */
export async function sealedBuildVariables(
  db: Db,
  env: Env,
  projectId: string,
  branch: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(envVars)
    .where(
      and(
        eq(envVars.projectId, projectId),
        eq(envVars.target, 'build'),
        inArray(envVars.branch, [ALL_BRANCHES, branch]),
      ),
    )
    .all();
  const variables: Record<string, string> = {};
  const ordered = [
    ...rows.filter((row) => row.branch === ALL_BRANCHES),
    ...rows.filter((row) => row.branch !== ALL_BRANCHES),
  ];
  for (const row of ordered) {
    if (row.valueSealed === null) continue;
    variables[row.key] = await vault(env).open(row.valueSealed, buildVariableContext(projectId, row.branch, row.key));
  }
  return variables;
}

export type Variable = { key: string; target: VariableTarget; secret: boolean; value: string | null; updatedAt: Date };

/** Names the platform uses itself: GitHub's own, the deploy credentials and bohr's. */
export function reservedVariable(key: string): boolean {
  return /^(GITHUB_|CLOUDFLARE_|BOHR_)/.test(key) || key === 'CI';
}

export async function listVariables(db: Db, project: Project): Promise<Variable[]> {
  const rows = await db.select().from(envVars).where(eq(envVars.projectId, project.id)).all();
  return rows
    .filter((row) => row.branch === ALL_BRANCHES)
    .map((row) => ({
      key: row.key,
      target: row.target,
      secret: row.isSecret,
      value: row.isSecret ? null : row.value,
      updatedAt: row.updatedAt,
    }))
    .sort((a, b) => a.target.localeCompare(b.target) || a.key.localeCompare(b.key));
}

async function record(
  db: Db,
  project: Project,
  target: VariableTarget,
  key: string,
  value: string,
  secret: boolean,
  valueSealed: string | null = null,
) {
  await db
    .insert(envVars)
    .values({
      id: randomId('v_', 16),
      projectId: project.id,
      branch: ALL_BRANCHES,
      key,
      target,
      isSecret: secret,
      value: secret ? null : value,
      valueSealed,
    })
    .onConflictDoUpdate({
      target: [envVars.projectId, envVars.branch, envVars.key, envVars.target],
      set: { isSecret: secret, value: secret ? null : value, valueSealed, updatedAt: new Date() },
    })
    .run();
}

/** The Cloudflare account a project in its owner's account deploys to, and a client for it. */
export async function projectAccount(db: Db, env: Env, project: Project) {
  // The project's own connection: its runtime may run elsewhere (bohr's account, on bohr.io Cloud)
  if (project.cfConnectionId !== null) {
    const connection = await db.select().from(cfConnections).where(eq(cfConnections.id, project.cfConnectionId)).get();
    if (connection === undefined) throw conflict("The project's Cloudflare connection was removed.");
    return {
      cf: await accountClient(db, env, connection.id, connection.accountId),
      accountId: connection.accountId,
    };
  }
  const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, project.id)).get();
  if (runtime?.cfConnectionId) {
    return {
      cf: await accountClient(db, env, runtime.cfConnectionId, runtime.accountId),
      accountId: runtime.accountId,
    };
  }
  // Moved from bohr's hosting: the account chosen for the move
  const moved = await readSetting<{ connectionId: string; accountId: string }>(db, `move:${project.id}`);
  if (moved !== null) {
    return { cf: await accountClient(db, env, moved.connectionId, moved.accountId), accountId: moved.accountId };
  }
  throw conflict('This project has no Cloudflare account connected.');
}

/** The production Worker's name: "name" in the wrangler config of the folder .bohr/deploy.json points at. */
export async function productionWorkerName(db: Db, env: Env, project: Project): Promise<string> {
  const github = new GithubClient({
    token: (await repositoryToken(db, env, project, 'worker')).token,
    fetch: deps.fetch,
  });
  const read = (path: string) => github.getFile(project.repoOwner, project.repoName, path, project.productionBranch);
  let directory = '.';
  const deploy = await read(DEPLOY_CONFIG_PATH);
  if (deploy !== null) {
    try {
      const parsed = JSON.parse(deploy.content) as { directory?: unknown };
      if (typeof parsed.directory === 'string') directory = parsed.directory;
    } catch {
      // An invalid deploy config is reported where it is used; the repository root is the default
    }
  }
  const prefix = directory === '.' ? '' : `${directory.replace(/\/+$/, '')}/`;
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    const found = await read(`${prefix}${file}`);
    if (found === null) continue;
    try {
      const name = (JSON.parse(stripJsonComments(found.content)) as { name?: unknown }).name;
      if (typeof name === 'string' && name !== '') return name;
    } catch {
      break;
    }
  }
  throw conflict(
    `No wrangler config with a "name" in ${prefix || 'the repository root'} on ${project.productionBranch}.`,
  );
}

/** The production Worker in the owner's account; 409 until its first deploy created it. */
export async function productionWorker(db: Db, env: Env, project: Project) {
  const { cf, accountId } = await projectAccount(db, env, project);
  const script = await productionWorkerName(db, env, project);
  if ((await getAccountScriptSettings(cf, accountId, script)) === null) {
    throw conflict(`The site's Worker (${script}) is not deployed yet. Publish the site once, then try again.`);
  }
  return { cf, accountId, script };
}

/** What a site's Worker answers until its first deploy replaces it (presetSiteSecret). */
const PLACEHOLDER_SOURCE = `export default {
  fetch() {
    return new Response('This site is being set up. It will be ready in a few minutes.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' },
    });
  },
};
`;

/**
 * A secret site variable for a Worker that is not deployed yet (a project created from a template): a placeholder
 * Worker takes the name and holds the secret until the first `wrangler deploy` replaces its code (secrets survive
 * deploys). `placeholder`: whether it was uploaded now, so a failed creation can remove it.
 */
export async function presetSiteSecret(
  db: Db,
  env: Env,
  project: Project,
  input: { script: string; key: string; value: string },
): Promise<{ placeholder: boolean }> {
  const { cf, accountId } = await projectAccount(db, env, project);
  let placeholder = false;
  if ((await getAccountScriptSettings(cf, accountId, input.script)) === null) {
    await uploadAccountScript(
      cf,
      accountId,
      input.script,
      {
        main_module: 'placeholder.mjs',
        compatibility_date: RUNTIME_COMPATIBILITY_DATE,
        annotations: { 'workers/message': 'bohr: placeholder until the first deploy' },
      },
      [{ name: 'placeholder.mjs', content: PLACEHOLDER_SOURCE, type: 'application/javascript+module' }],
    );
    placeholder = true;
  }
  await putAccountScriptSecret(cf, accountId, input.script, input.key, input.value);
  await record(db, project, 'runtime', input.key, input.value, true);
  return { placeholder };
}

async function actionsClient(db: Db, env: Env, project: Project) {
  return new GithubClient({ token: (await repositoryToken(db, env, project, 'secrets')).token, fetch: deps.fetch });
}

/**
 * Deletes the BOHR_BUILD_<NAME> Actions secret an older version kept a build variable in. Strict for a
 * project in its owner's account (its workflow still loads those secrets); best effort for a project bohr
 * hosts, whose repository may not have the GitHub App with the secrets permission.
 */
async function deleteLegacyBuildSecret(db: Db, env: Env, project: Project, key: string): Promise<void> {
  const name = `${BUILD_VARIABLE_PREFIX}${key}`;
  try {
    const github = await actionsClient(db, env, project);
    await github.deleteActionsSecret(project.repoOwner, project.repoName, name);
  } catch (error) {
    if (project.mode === 'byo') throw error;
    console.error(
      `[variables] Could not delete the Actions secret ${name} of ${project.repoKey}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function setVariable(
  db: Db,
  env: Env,
  project: Project,
  input: { target: VariableTarget; key: string; value: string; secret: boolean },
): Promise<void> {
  if (reservedVariable(input.key)) throw badRequest(`${input.key} is a name bohr or GitHub use themselves.`);
  if (input.target === 'build') {
    // Sealed in bohr: the deploy workflow asks for it with the Cloudflare credentials (own account) or the
    // build plan (projects bohr hosts)
    const sealed = await vault(env).seal(input.value, buildVariableContext(project.id, ALL_BRANCHES, input.key));
    await record(db, project, input.target, input.key, input.value, input.secret, sealed);
    // The copy an older version kept in the repository would load too
    await deleteLegacyBuildSecret(db, env, project, input.key);
    return;
  }
  if (project.mode === 'managed') {
    // Hosted by bohr: bound on every deploy, secrets right away too (the existing v1 path)
    const cf = deps.cloudflare(env);
    if (input.secret) await setRuntimeSecret(db, env, cf, project, ALL_BRANCHES, input.key, input.value);
    else await deleteRuntimeSecret(db, env, cf, project, ALL_BRANCHES, input.key);
  } else {
    const { cf, accountId, script } = await productionWorker(db, env, project);
    try {
      await putAccountScriptSecret(cf, accountId, script, input.key, input.value);
    } catch (error) {
      // A plain var with the same name in wrangler.jsonc wins on every deploy; Cloudflare refuses both
      if (error instanceof CloudflareError && error.status === 400) {
        throw new HttpError(409, `${input.key} is already set in the site's wrangler config: change it there.`);
      }
      throw error;
    }
  }
  await record(db, project, input.target, input.key, input.value, input.secret);
}

export async function deleteVariable(
  db: Db,
  env: Env,
  project: Project,
  input: { target: VariableTarget; key: string },
): Promise<void> {
  if (input.target === 'build') {
    await deleteLegacyBuildSecret(db, env, project, input.key);
  } else if (project.mode === 'managed') {
    await deleteRuntimeSecret(db, env, deps.cloudflare(env), project, ALL_BRANCHES, input.key);
  } else {
    const { cf, accountId } = await projectAccount(db, env, project);
    const script = await productionWorkerName(db, env, project);
    await deleteAccountScriptSecret(cf, accountId, script, input.key);
  }
  await db
    .delete(envVars)
    .where(
      and(
        eq(envVars.projectId, project.id),
        eq(envVars.branch, ALL_BRANCHES),
        eq(envVars.key, input.key),
        eq(envVars.target, input.target),
      ),
    )
    .run();
}
