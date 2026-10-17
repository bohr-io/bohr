// Moving a project migrated from bohr v1 out of bohr's hosting and into its owner's own Cloudflare account.
//
// 1. prepareMove: opens a pull request that leaves the repository deploying production to the owner's account
//    by itself: a `wrangler deploy` workflow with the credentials it asks bohr for at run time (GitHub OIDC,
//    POST /api/deploy/credentials), the project's plain variables in its wrangler config, and none of bohr
//    v1's workflows (bohr.yml, which deployed to bohr's hosting with the build plan). The owner's token never
//    goes to the repository. Migrated repositories come in three shapes:
//    - the old pull-request migration's workflow (moveWorkflow): rewritten in place;
//    - bohr v1's bohr.yml and nothing else: .bohr/deploy.json and the files come from bohr's build plan;
//    - prepared by the bohr agent (.bohr/deploy.json, a wrangler config, maybe bohr.yml still): the workflow
//      bohr writes from .bohr/deploy.json, now to the owner's account.
// 2. The owner merges it; the workflow publishes the Worker in their account.
// 3. completeMove: copies the runtime secrets to that Worker, serves each custom domain whose zone is in the
//    owner's account from it, redirects the project's bohr.io addresses to the new home, and the project
//    stops being hosted by bohr. Domains whose zone is still in bohr's account stay as they are (pending)
//    until the owner adds the zone to their account and completes again. Once nothing is pending, the build
//    plan goes too: nothing deploys the project to bohr's hosting any more.
import {
  attachWorkerDomain,
  type CloudflareClient,
  CloudflareError,
  deleteDispatchScript,
  deleteWorkerRoute,
  findZoneForHostname,
  getAccountScriptSettings,
  getWorkersSubdomain,
  putAccountScriptSecret,
  upsertWorkerRoute,
  workersDevUrl,
} from '@bohr/cloudflare';
import { GithubClient } from '@bohr/github';
import {
  ASSETS_IGNORE_FILE,
  assetsIgnoreFile,
  DEFAULT_DEPLOY_COMMAND,
  DEPLOY_CONFIG_PATH,
  DEPLOY_WORKFLOW_HEADER,
  DEPLOY_WORKFLOW_PATH,
  type DeployConfig,
  d1MigrationBindings,
  deployConfigSchema,
  deployCredentialsStep,
  renderDeployWorkflow,
  stripJsonComments,
  usesBohrV1Action,
  WORKFLOWS_DIR,
  wranglerDeployStep,
} from '@bohr/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { buildPlans, cfConnections, deployments, envVars, hostnames, projects, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { instanceUrl } from '../lib/app-url';
import { cloudEnv } from '../lib/cloud';
import { badRequest, conflict, notFound } from '../lib/http';
import { connectionsOf, projectOwner } from '../lib/owner';
import { vault } from '../lib/vault';
import { audit } from './audit';
import { readBuildPlan } from './build-plans';
import { repositoryToken } from './github-app';
import { cfTokenContext } from './provision';
import { runtimeSecretsFor } from './secrets';
import { readSetting, writeSetting } from './settings';
import { templateWorkerName } from './templates';

export const MOVE_BRANCH = 'bohr/move-to-cloudflare';
const WORKFLOW_PATH = DEPLOY_WORKFLOW_PATH;
const WRANGLER_PATHS = ['wrangler.jsonc', 'wrangler.json'];
const ALL_BRANCHES = '*';

export type MovedHostname = {
  hostname: string;
  /** moved: served by the Worker in the owner's account; proxied: its zone stayed in bohr's account (bohr v1
   *  hosted the domain's DNS), so bohr passes its requests on to that Worker; redirected: a bohr.io address that
   *  now redirects there; pending: the zone is not in the owner's account yet; dropped: a branch preview no longer
   *  deployed. */
  status: 'moved' | 'proxied' | 'redirected' | 'pending' | 'dropped';
};

type MoveState = {
  connectionId: string;
  accountId: string;
  /** The Worker's name in the owner's account (wrangler.jsonc "name"). */
  script: string;
  pullRequest: { number: number; url: string };
  preparedAt: number;
  completedAt?: number;
  hostnames?: MovedHostname[];
};

export type MoveView =
  | { status: 'available' }
  | {
      status: 'prepared' | 'done';
      script: string;
      accountId: string;
      pullRequest: { number: number; url: string };
      hostnames: MovedHostname[];
    }
  | { status: 'unavailable' };

const settingKey = (projectId: string) => `move:${projectId}`;

export async function moveView(db: Db, project: Project): Promise<MoveView> {
  const state = await readSetting<MoveState>(db, settingKey(project.id));
  if (state === null) return project.mode === 'managed' ? { status: 'available' } : { status: 'unavailable' };
  return {
    status: state.completedAt === undefined ? 'prepared' : 'done',
    script: state.script,
    accountId: state.accountId,
    pullRequest: state.pullRequest,
    hostnames: state.hostnames ?? [],
  };
}

/** One of the Cloudflare connections of the project's owner (its organization's for an org project). */
async function connectionFor(db: Db, env: Env, project: Project, connectionId: string) {
  const connection = await db
    .select()
    .from(cfConnections)
    .where(and(eq(cfConnections.id, connectionId), connectionsOf(projectOwner(project))))
    .get();
  if (connection === undefined) throw notFound('Cloudflare connection not found.');
  const token = await vault(env).open(connection.tokenSealed, cfTokenContext(connection.id));
  return { connection, token, cf: deps.userCloudflare(token, connection.accountId) };
}

// A wrangler.jsonc parses as JSON without its comments (the helper is shared with the deploy workflow)
export { stripJsonComments };

/**
 * The migration's workflow, turned into a deploy to the owner's account: only the production branch (every
 * branch would overwrite the same Worker), and `wrangler deploy` instead of bohr's deploy action, with the
 * credentials the first step asks bohr for (GitHub OIDC, so `id-token: write` stays). Returns null when the
 * file is not the one the migration generated.
 */
export function moveWorkflow(source: string, productionBranch: string, instanceUrl?: string): string | null {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const action = lines.findIndex((line) => line.trim() === '- uses: bohr-io/deploy-action@v1');
  const branches = lines.findIndex((line) => /^\s{4}branches:\s*\[.*\]\s*$/.test(line));
  const steps = lines.findIndex((line) => /^\s{4}steps:\s*$/.test(line));
  if (action === -1 || branches === -1 || steps === -1 || !lines[0]?.startsWith('# Generated by the bohr v2 migration'))
    return null;
  const indent = lines[action]?.match(/^\s*/)?.[0] ?? '      ';
  const out: string[] = [
    '# Deploys production to your own Cloudflare account. It was the bohr v2 migration workflow, moved out of',
    "# bohr's hosting by bohr. bohr leaves this file as it is; edit it freely.",
  ];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('#')) continue;
    if (index === branches) out.push(`    branches: [${JSON.stringify(productionBranch)}]`);
    else if (line.trim() === 'workflow_dispatch:') continue;
    else if (index === action) out.push(...wranglerDeployStep(DEFAULT_DEPLOY_COMMAND, indent));
    else if (index === steps) out.push(line, ...deployCredentialsStep(instanceUrl, indent));
    else out.push(line);
  }
  return out.join('\n');
}

/** The production branch's plain runtime variables (project-wide, then branch), as bohr deployed them. */
async function productionVars(db: Db, project: Project): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(envVars)
    .where(
      and(
        eq(envVars.projectId, project.id),
        eq(envVars.target, 'runtime'),
        eq(envVars.isSecret, false),
        inArray(envVars.branch, [ALL_BRANCHES, project.productionBranch]),
      ),
    )
    .all();
  const vars: Record<string, string> = {};
  for (const row of rows.filter((r) => r.branch === ALL_BRANCHES)) vars[row.key] = row.value ?? '';
  for (const row of rows.filter((r) => r.branch !== ALL_BRANCHES)) vars[row.key] = row.value ?? '';
  return vars;
}

/** The package manager a build plan's commands run, for .bohr/deploy.json (pnpm and yarn need Corepack). */
function packageManagerOf(command: string): DeployConfig['packageManager'] {
  const found = /(?:^|[\s;&|(])(npm|npx|pnpm|yarn|bun)(?=\s|$)/.exec(command)?.[1];
  return found === 'pnpm' || found === 'yarn' || found === 'bun' ? found : 'npm';
}

/**
 * The .bohr/deploy.json of a repository that still deploys with bohr v1's workflow and bohr's build plan: the
 * plan's install, build (with the plain build environment the migration put in front of it, like
 * `export CI='false';`) and Node.js major. Build variables stay sealed in bohr; the workflow gets them at run
 * time with the deploy credentials.
 */
export function deployConfigFromPlan(plan: {
  nodeVersion: string;
  install: string | null;
  build: string | null;
}): Record<string, unknown> {
  const major = Number.parseInt(plan.nodeVersion, 10);
  const manager = packageManagerOf(plan.install ?? plan.build ?? '');
  return {
    ...(major >= 10 && major <= 99 ? { node: String(major) } : {}),
    ...(manager === 'npm' ? {} : { packageManager: manager }),
    ...(plan.install === null ? {} : { install: plan.install.trim() }),
    ...(plan.build === null ? {} : { build: plan.build.trim() }),
  };
}

/**
 * The assets directory of a wrangler config, from the repository root ("" for the root itself), or null when the
 * config has none or it leaves the repository. wrangler resolves it from the config's folder.
 */
export function assetsDirectory(configPath: string, config: { assets?: unknown }): string | null {
  const directory = (config.assets as { directory?: unknown } | undefined)?.directory;
  if (typeof directory !== 'string' || directory.startsWith('/') || /^[A-Za-z]:/.test(directory)) return null;
  const segments = configPath.split('/').slice(0, -1);
  for (const segment of directory.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.pop() === undefined) return null;
    } else segments.push(segment);
  }
  return segments.join('/');
}

type RepoFile = { sha: string; content: string };
/** A file the pull request writes; `sha` when it replaces the production branch's copy. */
type Write = { path: string; content: string; message: string; sha?: string };

/** Step 1: the pull request that moves the deploy to the owner's account. */
export async function prepareMove(
  db: Db,
  env: Env,
  project: Project,
  userId: string,
  connectionId: string,
): Promise<MoveView> {
  if (project.mode !== 'managed') throw badRequest('Only projects hosted by bohr can move.');
  const existing = await readSetting<MoveState>(db, settingKey(project.id));
  if (existing?.completedAt !== undefined) throw conflict('This project already moved.');
  const { connection } = await connectionFor(db, env, project, connectionId);

  const github = new GithubClient({
    token: (await repositoryToken(db, env, project, 'worker')).token,
    fetch: deps.fetch,
  });
  const owner = project.repoOwner;
  const repo = project.repoName;
  const base = project.productionBranch;
  const read = (path: string): Promise<RepoFile | null> => github.getFile(owner, repo, path, base);
  const instance = (await instanceUrl(db, env)) ?? undefined;

  // bohr v1's workflows (bohr.yml): with the build plan they deploy every push to bohr's hosting
  const legacy: { path: string; sha: string }[] = [];
  for (const entry of await github.listDirectory(owner, repo, WORKFLOWS_DIR, base)) {
    if (entry.type !== 'file' || !/\.ya?ml$/i.test(entry.name)) continue;
    const file = await read(entry.path);
    if (file !== null && usesBohrV1Action(file.content)) legacy.push({ path: entry.path, sha: file.sha });
  }

  const workflow = await read(WORKFLOW_PATH);
  // The old pull-request migration's workflow is rewritten in place; it has no .bohr/deploy.json
  const moved = workflow === null ? null : moveWorkflow(workflow.content, base, instance);
  if (workflow !== null && moved === null && !workflow.content.startsWith(DEPLOY_WORKFLOW_HEADER)) {
    throw conflict(
      `${WORKFLOW_PATH} is not the workflow the bohr migration created. Change its deploy step to \`npx wrangler deploy\` by hand.`,
    );
  }

  const writes: Write[] = [];
  let config: DeployConfig | null = null;
  if (moved === null) {
    const deployFile = await read(DEPLOY_CONFIG_PATH);
    // The build plan is how production deploys while bohr.yml is there, and what describes a repository that
    // has nothing else
    const plan = deployFile === null || legacy.length > 0 ? await readBuildPlan(db, project) : null;
    let raw: unknown;
    if (deployFile !== null) {
      try {
        raw = JSON.parse(deployFile.content);
      } catch {
        throw conflict(`${DEPLOY_CONFIG_PATH} is not valid JSON; fix it on ${base} and try again.`);
      }
    } else if (plan !== null) {
      raw = deployConfigFromPlan(plan);
    } else {
      throw conflict(
        `The repository has no ${DEPLOY_CONFIG_PATH} and bohr has no build plan for it: add ${DEPLOY_CONFIG_PATH} (install, build and Node.js version) and try again.`,
      );
    }
    const parsed = deployConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = deployFile === null ? "bohr's build plan" : DEPLOY_CONFIG_PATH;
      throw conflict(
        `${where} does not fit ${DEPLOY_CONFIG_PATH} (${issue?.path.join('.') || 'deploy.json'}: ${issue?.message ?? 'invalid'}). Write ${DEPLOY_CONFIG_PATH} by hand and try again.`,
      );
    }
    config = parsed.data;
    if (deployFile === null) {
      writes.push({
        path: DEPLOY_CONFIG_PATH,
        content: `${JSON.stringify(raw, null, 2)}\n`,
        message: `Describe the production build in ${DEPLOY_CONFIG_PATH}`,
      });
    }
    // The files the build plan wrote at every deploy (wrangler.jsonc, the function adapter…), when the
    // repository does not have them: from now on they live in the repository
    for (const [path, content] of Object.entries(plan?.files ?? {})) {
      if ((await read(path)) === null) writes.push({ path, content, message: `Add ${path} from bohr's build plan` });
    }
  }

  // The wrangler config of the deploy folder (the repository root for the old migration's workflow)
  const prefix = config === null || config.directory === '.' ? '' : `${config.directory.replace(/\/+$/, '')}/`;
  let wrangler: { path: string; content: string; sha?: string; pending?: Write } | null = null;
  for (const name of WRANGLER_PATHS) {
    const path = `${prefix}${name}`;
    const pending = writes.find((write) => write.path === path);
    if (pending !== undefined) {
      wrangler = { path, content: pending.content, pending };
      break;
    }
    const file = await read(path);
    if (file !== null) {
      wrangler = { path, ...file };
      break;
    }
  }
  if (wrangler === null) {
    throw conflict(`The repository has no wrangler.jsonc in ${prefix || 'its root'} on its production branch.`);
  }
  let settings: { name?: unknown; vars?: Record<string, unknown>; assets?: unknown };
  try {
    settings = JSON.parse(stripJsonComments(wrangler.content)) as typeof settings;
  } catch {
    throw conflict(`${wrangler.path} could not be read; check its syntax.`);
  }
  // "name" is the Worker in the owner's account: the project's slug when the config has none
  const script = typeof settings.name === 'string' && settings.name !== '' ? settings.name : templateWorkerName(repo);
  const vars = { ...(settings.vars ?? {}), ...(await productionVars(db, project)) };
  const next = { ...settings, name: script, ...(Object.keys(vars).length > 0 ? { vars } : {}) };
  if (JSON.stringify(next) !== JSON.stringify(settings)) {
    const header = wrangler.content.match(/^(\s*\/\/[^\n]*\n)*/)?.[0] ?? '';
    const content = `${header}${JSON.stringify(next, null, 2)}\n`;
    if (wrangler.pending !== undefined) wrangler.pending.content = content;
    else {
      writes.push({
        path: wrangler.path,
        content,
        message: "Keep the site's name and variables in wrangler config",
        ...(wrangler.sha === undefined ? {} : { sha: wrangler.sha }),
      });
    }
  }

  // bohr published assets with its own rules (v1's exclusions, never .git or .env); wrangler publishes the whole
  // assets directory but what its .assetsignore lists. Only a site served from the config's own folder (the source
  // tree, with package.json and the like) needs one: a build's output folder is emptied by the build, and usually
  // ignored by git. One the owner wrote stays as it is.
  const assets = assetsDirectory(wrangler.path, next);
  if (assets !== null && assets === wrangler.path.split('/').slice(0, -1).join('/')) {
    const path = assets === '' ? ASSETS_IGNORE_FILE : `${assets}/${ASSETS_IGNORE_FILE}`;
    if (!writes.some((write) => write.path === path) && (await read(path)) === null) {
      writes.push({ path, content: assetsIgnoreFile(), message: `Keep private files out of the site's assets` });
    }
  }

  // bohr's deploy workflow, to the owner's account (the one bohr wrote for its hosting is replaced)
  const deployWorkflow =
    moved ??
    renderDeployWorkflow(config as DeployConfig, {
      productionBranch: base,
      target: 'wrangler',
      ...(instance === undefined ? {} : { instanceUrl: instance }),
      d1Migrations: d1MigrationBindings(next).length > 0,
    });

  // The branch starts from production each time, so preparing again is safe
  const head = await github.getBranchSha(owner, repo, base);
  if (head === null) throw conflict(`The branch ${base} does not exist.`);
  if ((await github.getBranchSha(owner, repo, MOVE_BRANCH)) === null) {
    await github.createBranch(owner, repo, MOVE_BRANCH, head);
  } else {
    await github.updateBranch(owner, repo, MOVE_BRANCH, head, true);
  }
  // bohr v1's workflows go first: the next commits on the branch no longer start deploys to bohr's hosting
  for (const file of legacy) {
    await github.deleteFile(owner, repo, file.path, {
      message: `Remove the bohr v1 workflow ${file.path}: the site no longer deploys to bohr's hosting`,
      branch: MOVE_BRANCH,
      sha: file.sha,
    });
  }
  if (workflow?.content !== deployWorkflow) {
    await github.putFile(owner, repo, WORKFLOW_PATH, {
      content: deployWorkflow,
      message: 'Deploy production to my own Cloudflare account',
      branch: MOVE_BRANCH,
      ...(workflow === null ? {} : { sha: workflow.sha }),
    });
  }
  for (const write of writes) {
    await github.putFile(owner, repo, write.path, {
      content: write.content,
      message: write.message,
      branch: MOVE_BRANCH,
      ...(write.sha === undefined ? {} : { sha: write.sha }),
    });
  }
  const removed = legacy.map((file) => `\`${file.path}\``).join(', ');
  const pull =
    (await github.findOpenPullRequest(owner, repo, MOVE_BRANCH, base)) ??
    (await github.createPullRequest(owner, repo, {
      head: MOVE_BRANCH,
      base,
      title: 'Move the site to my own Cloudflare account',
      body: [
        `After this is merged, GitHub Actions deploys \`${script}\` to your Cloudflare account (${connection.accountName ?? connection.accountId}) on every push to \`${base}\`.`,
        ...(legacy.length > 0
          ? ['', `It removes bohr v1's workflow (${removed}), so the site no longer deploys to bohr's hosting.`]
          : []),
        '',
        'Then finish the move in bohr: it copies the secrets, moves your domains and stops hosting the site.',
        'Branch previews are no longer deployed; the bohr agent shows changes in its own preview.',
      ].join('\n'),
    }));

  const state: MoveState = {
    connectionId: connection.id,
    accountId: connection.accountId,
    script,
    pullRequest: { number: pull.number, url: pull.html_url },
    preparedAt: Date.now(),
  };
  await writeSetting(db, settingKey(project.id), state);
  await audit(db, { actorUserId: userId, actor: `user:${userId}`, action: 'project.move.prepare', target: project.id });
  return moveView(db, project);
}

/** Step 3, after the pull request is merged and the Worker exists in the owner's account. */
export async function completeMove(db: Db, env: Env, project: Project, userId: string): Promise<MoveView> {
  const state = await readSetting<MoveState>(db, settingKey(project.id));
  if (state === null) throw conflict('Prepare the move first.');
  if (state.completedAt !== undefined) return moveView(db, project);
  const github = new GithubClient({
    token: (await repositoryToken(db, env, project, 'worker')).token,
    fetch: deps.fetch,
  });
  const pull = await github.getPullRequest(project.repoOwner, project.repoName, state.pullRequest.number);
  if (!pull.merged) throw conflict(`Merge pull request #${state.pullRequest.number} first.`);
  const { cf } = await connectionFor(db, env, project, state.connectionId);
  if ((await getAccountScriptSettings(cf, state.accountId, state.script)) === null) {
    throw conflict(
      `The Worker ${state.script} is not in your Cloudflare account yet: wait for the deploy workflow to finish.`,
    );
  }

  // Secrets the site had on bohr (the variables went into wrangler.jsonc with the pull request)
  const secrets = await runtimeSecretsFor(db, env, project.id, project.productionBranch);
  for (const [name, value] of secrets) await putAccountScriptSecret(cf, state.accountId, state.script, name, value);

  const cloud = cloudEnv(env);
  const bohrCf = deps.cloudflare(env);
  const rows = await db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all();
  const results: MovedHostname[] = [];
  let home: string | null = null;
  const custom = rows.filter((row) => !isBohrHostname(row.hostname, cloud.BOHR_DOMAIN));
  for (const row of custom) {
    if (!row.isProduction) {
      await stopServing(db, bohrCf, cloud.ROUTES, row);
      results.push({ hostname: row.hostname, status: 'dropped' });
      continue;
    }
    const zone = await findZoneForHostname(cf, row.hostname.replace(/^\*\./, ''));
    // A zone still pending in the owner's account (its nameservers point elsewhere, often at bohr's own zone)
    // serves nothing yet: bohr keeps serving the hostname until it is active
    if (zone === null || zone.status !== 'active') {
      const proxied = await proxyFromBohr(db, bohrCf, cf, cloud, project, state, row);
      if (proxied) home ??= `https://${row.hostname}`;
      results.push({ hostname: row.hostname, status: proxied ? 'proxied' : 'pending' });
      continue;
    }
    // A zone bohr already routes is in bohr's own account (the owner connected it): bohr's token retargets its
    // route, which the owner's token may not be allowed to touch (Workers Routes is a zone permission)
    const routes = row.routes?.some((change) => change.zoneId === zone.id) ? bohrCf : cf;
    let kept: string | null = null;
    if (row.hostname.startsWith('*.')) {
      kept = (await upsertWorkerRoute(routes, zone.id, `${row.hostname}/*`, state.script)).id;
    } else {
      kept = await serveFromWorker(cf, routes, state, row.hostname, zone.id);
      home ??= `https://${row.hostname}`;
    }
    await stopServing(db, bohrCf, cloud.ROUTES, row, kept);
    results.push({ hostname: row.hostname, status: 'moved' });
  }
  if (home === null) {
    const subdomain = await getWorkersSubdomain(cf, state.accountId);
    if (subdomain !== null) home = workersDevUrl(state.script, subdomain);
  }
  // bohr.io addresses cannot move: they redirect to the site's new home
  for (const row of rows.filter((candidate) => isBohrHostname(candidate.hostname, cloud.BOHR_DOMAIN))) {
    if (home === null) {
      results.push({ hostname: row.hostname, status: 'pending' });
      continue;
    }
    await cloud.ROUTES.put(
      row.hostname,
      JSON.stringify({ v: 1, projectId: project.id, script: 'moved', movedTo: home }),
    );
    await db.delete(hostnames).where(eq(hostnames.hostname, row.hostname)).run();
    results.push({ hostname: row.hostname, status: 'redirected' });
  }

  const pending = results.some((result) => result.status === 'pending');
  // Completing again after a pending domain moved keeps what the earlier runs did
  const merged = new Map((state.hostnames ?? []).map((result) => [result.hostname, result]));
  for (const result of results) merged.set(result.hostname, result);
  const next: MoveState = { ...state, hostnames: [...merged.values()] };
  if (!pending) {
    // Nothing points at bohr's copies any more
    const scripts = await db
      .selectDistinct({ script: deployments.script })
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .all();
    for (const { script } of scripts) {
      await deleteDispatchScript(bohrCf, cloud.DISPATCH_NAMESPACE, script).catch((error) =>
        console.error('[move] could not delete', script, error),
      );
    }
    await db
      .update(projects)
      .set({ mode: 'byo', status: 'active', updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .run();
    // bohr v1's workflow left with the pull request; nothing deploys the project to bohr's hosting any more
    await db.delete(buildPlans).where(eq(buildPlans.projectId, project.id)).run();
    next.completedAt = Date.now();
    // A runtime that exists keeps running where it is; its deploy target changes on the next provisioning
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, project.id)).get();
    if (runtime !== undefined) {
      // The move's pull request prepared the repository for bohr: no import after it, which would redo that work
      // on a preview older than production
      if (runtime.importStartedAt === null) {
        await db.update(runtimes).set({ importStartedAt: new Date() }).where(eq(runtimes.projectId, project.id)).run();
      }
      await deps.startProvisioning(env, { projectId: project.id, userId });
    }
  }
  await writeSetting(db, settingKey(project.id), next);
  await audit(db, {
    actorUserId: userId,
    actor: `user:${userId}`,
    action: pending ? 'project.move.partial' : 'project.move.complete',
    target: project.id,
    metadata: { hostnames: results },
  });
  return moveView(db, { ...project, mode: pending ? project.mode : 'byo' });
}

const isBohrHostname = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

/** Removes bohr's routing for a hostname: the Worker routes in bohr's zones and the dispatcher record. */
/**
 * Serves a hostname from the owner's Worker as a Custom Domain or, when the hostname already has DNS records
 * (bohr v1 served apexes through a Worker route over a placeholder record), through a Worker route, which leaves
 * the DNS as it is. Returns the route's id, or null for a Custom Domain.
 */
async function serveFromWorker(
  cf: CloudflareClient,
  routes: CloudflareClient,
  state: MoveState,
  hostname: string,
  zoneId: string,
): Promise<string | null> {
  try {
    await attachWorkerDomain(cf, state.accountId, { hostname, service: state.script, zoneId });
    return null;
  } catch (error) {
    if (!hasDnsRecords(error)) throw error;
    return (await upsertWorkerRoute(routes, zoneId, `${hostname}/*`, state.script)).id;
  }
}

/** Cloudflare refuses a Custom Domain over existing DNS records (100117 "already has externally managed DNS records"). */
function hasDnsRecords(error: unknown): boolean {
  return (
    error instanceof CloudflareError &&
    (error.hasCode(100117) || error.errors.some((entry) => /DNS record/i.test(entry.message)))
  );
}

/**
 * A hostname whose zone is still in bohr's own account (bohr v1 hosted the domain's DNS): bohr keeps answering it
 * and passes every request on to the project's Worker in the owner's account, on its workers.dev address.
 * False when bohr's account does not have the zone either, or the owner's account has no workers.dev subdomain.
 */
async function proxyFromBohr(
  db: Db,
  bohrCf: CloudflareClient,
  cf: CloudflareClient,
  cloud: ReturnType<typeof cloudEnv>,
  project: Project,
  state: MoveState,
  row: typeof hostnames.$inferSelect,
): Promise<boolean> {
  if (row.hostname.startsWith('*.')) return false;
  const bohrZone = await findZoneForHostname(bohrCf, row.hostname);
  if (bohrZone === null || bohrZone.status !== 'active') return false;
  const subdomain = await getWorkersSubdomain(cf, state.accountId);
  if (subdomain === null) return false;
  await cloud.ROUTES.put(
    row.hostname,
    JSON.stringify({ v: 1, projectId: project.id, script: 'moved', proxyTo: workersDevUrl(state.script, subdomain) }),
  );
  const pattern = `${row.hostname}/*`;
  const route = await upsertWorkerRoute(bohrCf, bohrZone.id, pattern, cloud.DISPATCHER_SCRIPT);
  // Deleting the project later removes the route like the others
  const routes = (row.routes ?? []).filter((change) => change.routeId !== route.id);
  routes.push({ zoneId: bohrZone.id, routeId: route.id, pattern, previousScript: null });
  await db
    .update(hostnames)
    .set({ zoneId: bohrZone.id, routes, status: 'live' })
    .where(eq(hostnames.hostname, row.hostname))
    .run();
  return true;
}

export async function stopServing(
  db: Db,
  bohrCf: CloudflareClient,
  routes: KVNamespace,
  row: typeof hostnames.$inferSelect,
  /** A route the owner's Worker now holds: the same route as bohr's when the zone is in bohr's account. */
  keptRouteId: string | null = null,
): Promise<void> {
  for (const change of row.routes ?? []) {
    if (change.routeId === keptRouteId) continue;
    await deleteWorkerRoute(bohrCf, change.zoneId, change.routeId).catch((error) =>
      console.error('[move] could not delete route', change.pattern, error),
    );
  }
  await routes.delete(row.hostname);
  await db.delete(hostnames).where(eq(hostnames.hostname, row.hostname)).run();
}
