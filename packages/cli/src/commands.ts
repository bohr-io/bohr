import { hostname as osHostname } from 'node:os';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { DeployConfig } from '@bohr/shared';
import { DEFAULT_INSTANCE_URL } from './action';
import { type ApiProject, BohrApi } from './api';
import { removeLogin, requireToken, saveLogin, storedLogin, TOKEN_ENV } from './auth';
import { runBuild, type ShellRunner } from './build';
import { type DeployDependencies, type DeployResult, deploy, OIDC_AUDIENCE } from './deploy';
import { CliError, EXIT, exitCodeForStatus } from './errors';
import { currentBranch, githubRepository, headCommit } from './git';
import * as github from './github';
import { defaultSleep, type Fetch, type Sleep } from './http';
import { InstanceError, normalizeInstanceUrl } from './instance';
import { formatBytes, type Logger, plural } from './log';
import { V1_ASSETS_ENV } from './manifest';
import { deployOwnAccount, type ProcessRunner, setActionOutputs } from './own-account';
import {
  hasWranglerConfig,
  LINK_PATH,
  notAV2Project,
  type ProjectLink,
  projectRoot,
  readDeployConfig,
  readLink,
  v1Run,
  v1Signs,
  writeLink,
} from './project';
import { V1Delegation } from './v1';

/** Everything a command touches outside itself, so tests can run it without a terminal, network or browser. */
export interface Context {
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetch: Fetch;
  /** Progress lines: stderr, or the job log in GitHub Actions. */
  logger: Logger;
  /** People at a terminal: the CLI may open the browser and ask before publishing production. */
  interactive: boolean;
  json: boolean;
  openUrl: (url: string) => Promise<void>;
  /** Asks a question at the terminal (interactive only) and resolves with the answer. */
  prompt: (question: string) => Promise<string>;
  sleep?: Sleep;
  now?: () => number;
  hostname?: string;
  /** Replaced in tests. */
  deploy?: typeof deploy;
  bundleWorker?: DeployDependencies['bundleWorker'];
  runShell?: ShellRunner;
  /** Runs wrangler (projects in their owner's Cloudflare account). */
  runProcess?: ProcessRunner;
}

/** What a command prints on success: `text` for people (stdout), `data` for --json. */
export interface CommandResult {
  text: string;
  data: Record<string, unknown>;
}

export interface Command {
  summary: string;
  usage: string;
  /** Options besides the global ones (--instance, --json, --help). */
  options: Record<string, { type: 'string' | 'boolean'; short?: string; description: string }>;
  run: (context: Context, values: Record<string, string | boolean | undefined>) => Promise<CommandResult>;
}

/** Options every command takes. */
export const GLOBAL_OPTIONS = {
  instance: {
    type: 'string',
    description: `The bohr instance (default: $BOHR_INSTANCE_URL, the folder's link, or ${DEFAULT_INSTANCE_URL})`,
  },
  json: { type: 'boolean', description: 'Print one JSON object with the result (for scripts and AI agents)' },
  help: { type: 'boolean', short: 'h', description: 'Show this help' },
} as const;

/** bohr v1's deploy options: seeing one means a bohr v1 workflow is running this CLI. */
export const V1_OPTIONS = ['--no-install', '--show-install', '--show-build'];

/** Parses a command's arguments; unknown options and stray arguments are usage errors. */
export function parseCommandArgs(command: Command, args: string[]) {
  try {
    return parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: false,
      strict: true,
    }).values as Record<string, string | boolean | undefined>;
  } catch (error) {
    throw new CliError(`${(error as Error).message}\nUsage: ${command.usage}`, EXIT.usage, 'usage');
  }
}

/** The instance to talk to: --instance, $BOHR_INSTANCE_URL, the folder's link, else bohr.io's. */
export function instanceFor(context: Context, values: Record<string, unknown>, link: ProjectLink | null = null) {
  const value =
    (typeof values.instance === 'string' ? values.instance : undefined) ??
    (context.env.BOHR_INSTANCE_URL || undefined) ??
    link?.instanceUrl ??
    DEFAULT_INSTANCE_URL;
  try {
    return normalizeInstanceUrl(value);
  } catch (error) {
    throw new CliError((error as Error).message.replace('instance-url', '--instance'), EXIT.usage, 'usage');
  }
}

async function tokenApi(context: Context, instanceUrl: string) {
  const { token } = await requireToken(instanceUrl, context.env);
  return new BohrApi(instanceUrl, token, context.fetch, context.sleep);
}

/**
 * The project a command acts on: --project, else the folder's link (.bohr/project.json), else the project of the
 * repository's GitHub remote (origin).
 */
async function resolveProject(
  api: BohrApi,
  values: Record<string, unknown>,
  root: string,
  link: ProjectLink | null,
): Promise<ApiProject> {
  const id = typeof values.project === 'string' ? values.project : link?.projectId;
  if (id !== undefined) return (await api.project(id)).project;
  const repository = await githubRepository(root);
  if (repository === null) {
    throw new CliError(
      `Which project? ${root} has no GitHub remote (origin). Pass --project <id> (see "bohr projects"), or run "bohr link".`,
      EXIT.usage,
      'no_project',
    );
  }
  const { projects } = await api.projects(repository);
  const project = projects[0];
  if (project === undefined) {
    throw new CliError(
      `No bohr project for ${repository} that this token can reach on ${api.instanceUrl}. Check "bohr projects", or the token's projects in the panel (Account › Tokens).`,
      EXIT.notFound,
      'project_not_found',
    );
  }
  return project;
}

const login: Command = {
  summary: 'Sign in from this computer (approve it in the browser)',
  usage: 'bohr login [--instance <url>]',
  options: {},
  async run(context, values) {
    const instanceUrl = instanceFor(context, values);
    const now = context.now ?? Date.now;
    const sleep = context.sleep ?? defaultSleep;
    const api = new BohrApi(instanceUrl, null, context.fetch, context.sleep);
    const name = `CLI on ${(context.hostname ?? osHostname()).slice(0, 80)}`;
    const start = await api.startLogin(name);
    context.logger.info(`To sign in, open ${start.verificationUrl}`);
    context.logger.info(`and approve "${name}" with the code ${start.userCode}.`);
    if (context.interactive) await context.openUrl(start.verificationUrl).catch(() => {});

    const deadline = now() + start.expiresIn * 1000;
    while (now() < deadline) {
      await sleep(Math.max(1, start.interval) * 1000);
      const answer = await api.pollLogin(start.deviceCode);
      if (answer.status === 'pending') continue;
      if (answer.status === 'approved') {
        await saveLogin(
          instanceUrl,
          { token: answer.token, user: answer.user, createdAt: new Date(now()).toISOString() },
          context.env,
        );
        if (context.env[TOKEN_ENV]) {
          context.logger.warning(`${TOKEN_ENV} is set in this environment, and the CLI uses it instead of this login.`);
        }
        const who = answer.user.name ?? answer.user.email ?? answer.user.id;
        return {
          text: `Signed in to ${instanceUrl} as ${who}.`,
          data: { instanceUrl, user: answer.user },
        };
      }
      if (answer.status === 'denied') {
        throw new CliError('The sign-in was denied in the panel.', EXIT.auth, 'login_denied');
      }
      break;
    }
    throw new CliError('The sign-in code expired. Run "bohr login" again.', EXIT.auth, 'login_expired');
  },
};

const logout: Command = {
  summary: "Sign out: revoke this computer's token and forget it",
  usage: 'bohr logout [--instance <url>]',
  options: {},
  async run(context, values) {
    const instanceUrl = instanceFor(context, values);
    const stored = await storedLogin(instanceUrl, context.env);
    if (stored !== null) {
      try {
        await new BohrApi(instanceUrl, stored.token, context.fetch, context.sleep).revoke();
      } catch (error) {
        // Already revoked (401) is fine; otherwise it stays valid until revoked in the panel
        if (!(error instanceof CliError && error.exitCode === EXIT.auth)) {
          context.logger.warning(
            `Could not revoke the token on ${instanceUrl} (${(error as Error).message}). Revoke it in the panel (Account › Tokens).`,
          );
        }
      }
      await removeLogin(instanceUrl, context.env);
    }
    if (context.env[TOKEN_ENV]) {
      context.logger.warning(`${TOKEN_ENV} is still set in this environment; unset it, or revoke it in the panel.`);
    }
    return {
      text: stored === null ? `Not signed in to ${instanceUrl}.` : `Signed out of ${instanceUrl}.`,
      data: { instanceUrl, signedOut: stored !== null },
    };
  },
};

const whoami: Command = {
  summary: 'Show who the CLI acts as, and with which token',
  usage: 'bohr whoami [--instance <url>] [--json]',
  options: {},
  async run(context, values) {
    const instanceUrl = instanceFor(context, values);
    const found = await requireToken(instanceUrl, context.env);
    const me = await new BohrApi(instanceUrl, found.token, context.fetch, context.sleep).me();
    const who = me.user.email ? `${me.user.name ?? me.user.email} <${me.user.email}>` : (me.user.name ?? me.user.id);
    const scope =
      me.token.projects === null ? 'all your projects' : plural(me.token.projects.length, 'selected project');
    const source = found.source === 'env' ? TOKEN_ENV : 'bohr login';
    return {
      text: `${who} on ${instanceUrl}\nToken "${me.token.name}" (${source}): ${scope}${me.token.expiresAt ? `, expires ${me.token.expiresAt}` : ''}`,
      data: { instanceUrl, user: me.user, token: { ...me.token, source } },
    };
  },
};

const projects: Command = {
  summary: 'List the projects the token can reach',
  usage: 'bohr projects [--instance <url>] [--json]',
  options: {},
  async run(context, values) {
    const instanceUrl = instanceFor(context, values);
    const api = await tokenApi(context, instanceUrl);
    const list = (await api.projects()).projects;
    const rows = list.map((project) => [
      project.id,
      project.name,
      project.repository,
      project.mode === 'managed' ? 'bohr' : 'own account',
      project.role,
      project.productionUrl ?? '-',
    ]);
    return {
      text:
        list.length === 0 ? 'No projects.' : table([['ID', 'NAME', 'REPOSITORY', 'HOSTED', 'ROLE', 'URL'], ...rows]),
      data: { instanceUrl, projects: list },
    };
  },
};

const link: Command = {
  summary: 'Link this folder to a project (.bohr/project.json)',
  usage: 'bohr link [--project <id>] [--instance <url>] [--json]',
  options: { project: { type: 'string', description: 'The project id (default: the one of the GitHub remote)' } },
  async run(context, values) {
    const root = await projectRoot(context.cwd);
    const instanceUrl = instanceFor(context, values);
    const api = await tokenApi(context, instanceUrl);
    const project = await resolveProject(api, values, root, null);
    const path = await writeLink(root, {
      projectId: project.id,
      ...(instanceUrl !== DEFAULT_INSTANCE_URL ? { instanceUrl } : {}),
    });
    return {
      text: `Linked ${root} to ${project.name} (${project.id}) in ${relative(context.cwd, path) || LINK_PATH}.`,
      data: { instanceUrl, project, path },
    };
  },
};

const open: Command = {
  summary: "Print the project's URL and open it in the browser",
  usage: 'bohr open [--branch <name>] [--print] [--project <id>] [--instance <url>] [--json]',
  options: {
    branch: { type: 'string', description: "A branch's preview instead of production" },
    print: { type: 'boolean', description: 'Only print the URL' },
    project: { type: 'string', description: 'The project id (default: the link, or the GitHub remote)' },
  },
  async run(context, values) {
    const root = await projectRoot(context.cwd);
    const link = await readLink(root);
    const instanceUrl = instanceFor(context, values, link);
    const api = await tokenApi(context, instanceUrl);
    const { project } = await api.project((await resolveProject(api, values, root, link)).id);
    const branch = typeof values.branch === 'string' ? values.branch : project.productionBranch;
    const hosts = project.hostnames.filter((host) => host.branch === branch && !host.hostname.startsWith('*.'));
    const host = hosts.find((entry) => entry.isProduction) ?? hosts[0];
    if (host === undefined) {
      throw new CliError(
        `${project.name} has no address for ${branch} yet: deploy it first (bohr deploy${branch === project.productionBranch ? ' --prod' : ` --branch ${branch}`}).`,
        EXIT.notFound,
        'no_address',
      );
    }
    const url = `https://${host.hostname}`;
    if (context.interactive && values.print !== true) await context.openUrl(url).catch(() => {});
    return { text: url, data: { instanceUrl, url, project: { id: project.id, name: project.name }, branch } };
  },
};

const deployCommand: Command = {
  summary: 'Build and deploy this folder (a preview, or production with --prod)',
  usage: 'bohr deploy [--prod] [--branch <name>] [--project <id>] [--dir <path>] [--no-build] [--yes] [--json]',
  options: {
    prod: { type: 'boolean', description: 'Deploy production (project owners only)' },
    branch: { type: 'string', description: "The preview's branch (default: the checked-out branch)" },
    project: { type: 'string', description: 'The project id (default: the link, or the GitHub remote)' },
    dir: { type: 'string', description: 'Folder with the wrangler config (default: from .bohr/deploy.json, or here)' },
    'no-build': { type: 'boolean', description: "Deploy what is built: skip .bohr/deploy.json's install and build" },
    yes: { type: 'boolean', short: 'y', description: 'Do not ask before deploying production' },
  },
  async run(context, values) {
    // A bohr v1 workflow (bohr-io/action's fallback) runs `npx bohr@latest deploy`: bohr v1's CLI deploys it
    const v1 = await v1Run(context.env);
    if (v1 !== null) throw new V1Delegation(v1);

    const root = await projectRoot(context.cwd);
    const link = await readLink(root);
    const deployConfig = await readDeployConfig(root);
    const directory =
      typeof values.dir === 'string'
        ? resolve(context.cwd, values.dir)
        : deployConfig
          ? resolve(root, deployConfig.directory)
          : context.cwd;
    if (deployConfig === null && link === null && !hasWranglerConfig(directory)) {
      const reason = `${directory} has no wrangler config, and the repository no ${LINK_PATH} or .bohr/deploy.json`;
      const signs = await v1Signs(root);
      // A bohr v1 repository (or a workflow of one: a bohr v2 project always has its config): bohr v1's CLI
      if (signs.length > 0) throw new V1Delegation(signs.join('; '));
      if (context.env.GITHUB_ACTIONS === 'true') throw new V1Delegation(reason);
      throw notAV2Project(reason, signs);
    }

    const instanceUrl = instanceFor(context, values, link);
    const tokenFromEnv = Boolean(context.env[TOKEN_ENV]?.trim());
    // GitHub Actions without BOHR_TOKEN: the run's OIDC token, like bohr-io/deploy-action
    if (!tokenFromEnv && github.hasOidc(context.env)) {
      for (const option of ['prod', 'branch', 'project'] as const) {
        if (values[option] !== undefined) {
          throw new CliError(
            `--${option} needs ${TOKEN_ENV}: with the run's GitHub OIDC token, bohr deploys the run's repository and branch.`,
            EXIT.usage,
            'usage',
          );
        }
      }
      await build(context, values, deployConfig, directory);
      const result = await runDeploy(context, {
        workingDirectory: directory,
        instanceUrl,
        commitSha: context.env.GITHUB_SHA || (await headCommit(root)),
        v1Assets: context.env[V1_ASSETS_ENV] === 'true',
      });
      return deployResult(context, instanceUrl, result, null, null, null);
    }

    const { token } = await requireToken(instanceUrl, context.env);
    const api = new BohrApi(instanceUrl, token, context.fetch, context.sleep);
    const project = await resolveProject(api, values, root, link);
    if (project.status === 'suspended') {
      throw new CliError(`${project.name} is suspended.`, EXIT.notAllowed, 'suspended');
    }
    // In its owner's Cloudflare account, wrangler deploys it here with the account's token: owners only, previews too
    const ownAccount = project.mode === 'byo';
    if (ownAccount && project.role !== 'owner') {
      throw new CliError(
        `${project.name} runs in its owner's Cloudflare account: only its owners (admins of its organization) can deploy it from the CLI, since wrangler deploys it with that account's token. Push a branch instead: its workflow deploys ${project.productionBranch}.`,
        EXIT.notAllowed,
        'own_account_not_allowed',
      );
    }

    const { branch, production } = await chooseBranch(context, values, root, project);
    if (production) {
      if (project.role !== 'owner') {
        throw new CliError(
          `Only owners of ${project.name} (admins of its organization) can deploy production. Deploy a preview: bohr deploy`,
          EXIT.notAllowed,
          'production_not_allowed',
        );
      }
      if (context.interactive && values.yes !== true) {
        const where = project.productionUrl ?? project.name;
        const account = ownAccount ? " in the owner's Cloudflare account" : '';
        const answer = await context.prompt(`Deploy this folder to production (${where})${account}? [y/N] `);
        if (!/^y(es)?$/i.test(answer.trim()))
          throw new CliError('Cancelled: nothing was deployed.', EXIT.error, 'cancelled');
      }
    }
    context.logger.info(
      `Deploying ${production ? 'production' : `a preview of ${branch}`} of ${project.name} (${project.id}) on ${instanceUrl}.`,
    );
    if (ownAccount) {
      const result = await deployOwnAccount(
        {
          api,
          instanceUrl,
          project,
          branch,
          production,
          root,
          directory,
          deployConfig,
          build: values['no-build'] !== true,
        },
        { env: context.env, logger: context.logger, runShell: context.runShell, runProcess: context.runProcess },
      );
      setActionOutputs(context.env, result.url, result.deploymentId);
      return {
        text:
          result.url ?? `Deployed version ${result.versionId ?? '(unknown)'} of ${result.workerName ?? project.name}.`,
        data: {
          instanceUrl,
          url: result.url,
          deploymentId: result.deploymentId,
          project: { id: project.id, name: project.name },
          branch,
          production,
          mode: 'byo',
          versionId: result.versionId,
          previewUrl: result.previewUrl,
          workerName: result.workerName,
          commitSha: result.commitSha,
          files: null,
          bytes: null,
          uploadedFiles: null,
          uploadedBytes: null,
          modules: null,
        },
      };
    }
    await build(context, values, deployConfig, directory);
    const result = await runDeploy(context, {
      workingDirectory: directory,
      instanceUrl,
      commitSha: await headCommit(root),
      apiToken: { token, target: { projectId: project.id, branch, production } },
      configHint: 'Run bohr deploy in the folder with the wrangler config, or pass --dir.',
    });
    return deployResult(context, instanceUrl, result, project, branch, production);
  },
};

/**
 * The branch a token deploy publishes. Previews are the default: the checked-out branch (or --branch), and the
 * production branch itself only with --prod; without it, its preview goes to "<production branch>-preview".
 */
async function chooseBranch(
  context: Context,
  values: Record<string, unknown>,
  root: string,
  project: ApiProject,
): Promise<{ branch: string; production: boolean }> {
  const requested = typeof values.branch === 'string' ? values.branch.trim() : undefined;
  if (values.prod === true) {
    if (requested !== undefined && requested !== project.productionBranch) {
      throw new CliError(
        `--prod deploys the production branch (${project.productionBranch}), not ${requested}.`,
        EXIT.usage,
        'usage',
      );
    }
    return { branch: project.productionBranch, production: true };
  }
  const branch =
    requested ||
    (await currentBranch(root)) ||
    context.env.GITHUB_HEAD_REF ||
    (context.env.GITHUB_REF?.startsWith('refs/heads/') ? context.env.GITHUB_REF.slice('refs/heads/'.length) : '');
  if (!branch) {
    throw new CliError('Which branch? HEAD is detached: pass --branch <name>.', EXIT.usage, 'no_branch');
  }
  if (branch === project.productionBranch) {
    const preview = `${branch}-preview`;
    context.logger.info(
      `${branch} is the production branch: deploying a preview on ${preview}. Use --prod to deploy production.`,
    );
    return { branch: preview, production: false };
  }
  return { branch, production: false };
}

async function build(
  context: Context,
  values: Record<string, unknown>,
  deployConfig: DeployConfig | null,
  directory: string,
) {
  if (values['no-build'] === true || deployConfig === null) return;
  await runBuild(deployConfig, directory, context.logger, { run: context.runShell, env: context.env });
}

async function runDeploy(context: Context, options: Parameters<typeof deploy>[0]): Promise<DeployResult> {
  try {
    return await (context.deploy ?? deploy)(options, {
      fetch: context.fetch,
      getIdToken: () => github.getIdToken(OIDC_AUDIENCE, { fetch: context.fetch, env: context.env }),
      logger: context.logger,
      bundleWorker: context.bundleWorker,
      sleep: context.sleep,
      now: context.now,
    });
  } catch (error) {
    if (error instanceof InstanceError) {
      const notAllowed = [
        'own_account',
        'production_branch',
        'production_on_v1',
        'production_not_allowed',
        'too_many_previews',
      ];
      const exitCode =
        error.code !== null && notAllowed.includes(error.code) ? EXIT.notAllowed : exitCodeForStatus(error.status);
      throw new CliError(error.message, exitCode, error.code ?? `http_${error.status}`);
    }
    throw error;
  }
}

function deployResult(
  context: Context,
  instanceUrl: string,
  result: DeployResult,
  project: ApiProject | null,
  branch: string | null,
  production: boolean | null,
): CommandResult {
  // A step that runs the CLI gets the action's outputs too
  if (github.inGithubActions(context.env) && context.env.GITHUB_OUTPUT) {
    github.setOutput('url', result.url);
    github.setOutput('deployment-id', result.deploymentId);
  }
  context.logger.info(
    `${plural(result.assetFiles, 'file')} (${formatBytes(result.assetBytes)}), ${result.uploadedFiles} uploaded; ${plural(result.modules, 'Worker module')}.`,
  );
  return {
    text: result.url,
    data: {
      instanceUrl,
      url: result.url,
      deploymentId: result.deploymentId,
      project: project === null ? null : { id: project.id, name: project.name },
      branch,
      production,
      mode: 'managed',
      files: result.assetFiles,
      bytes: result.assetBytes,
      uploadedFiles: result.uploadedFiles,
      uploadedBytes: result.uploadedBytes,
      modules: result.modules,
    },
  };
}

/** Left-aligned columns, two spaces apart. */
export function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export const COMMANDS: Record<string, Command> = {
  deploy: deployCommand,
  login,
  logout,
  whoami,
  projects,
  link,
  open,
};
