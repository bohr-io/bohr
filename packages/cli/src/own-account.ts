// `bohr deploy` of a project in its owner's own Cloudflare account: wrangler runs here, as in the project's deploy
// workflow (packages/shared/src/deploy.ts), with the owner's Cloudflare token that bohr hands to the project's
// owners (POST /api/cli/projects/:id/credentials). A preview is `wrangler versions upload --preview-alias`, which
// never changes what production serves; --prod applies the D1 migrations and runs `wrangler deploy`, which leaves
// the previous version online when it fails. The token only goes to wrangler's environment: never to a log, a
// file, the command line or the result.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_DEPLOY_COMMAND,
  type DeployConfig,
  d1MigrationBindings,
  gateSetupScript,
  stripJsonComments,
} from '@bohr/shared';
import type { ApiProject, BohrApi, OwnAccountCredentials } from './api';
import { TOKEN_ENV } from './auth';
import { runBuild, type ShellRunner } from './build';
import { CliError, EXIT } from './errors';
import { git, headCommit } from './git';
import * as github from './github';
import type { Logger } from './log';
import { exportBuildVariables, mask } from './variables';

/**
 * The wrangler release the CLI runs when the project does not install wrangler (the one bohr's own packages use).
 * The project's own wrangler wins when it is recent enough.
 */
export const PINNED_WRANGLER = '4.149.0';
/** The first wrangler release with `versions upload --preview-alias`. */
export const PREVIEW_ALIAS_WRANGLER = '4.21.0';
/** Longest DNS label: "<alias>-<worker name>" must fit in it. */
const MAX_LABEL = 63;
/** Most stdout kept from a child process, to read wrangler's result from. */
const MAX_CAPTURE = 1024 * 1024;
/** Files the protection gate writes next to the wrangler config (site-gate.ts). */
const GATE_FILES = ['.bohr-gate.mjs', 'wrangler.bohr-gate.json'];

export interface ProcessRequest {
  /** A program, or one shell command line with `shell`. */
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to the child's stdin. */
  input?: string;
  /** Show the child's stdout (on stderr: stdout carries the CLI's result). Default true. */
  echo?: boolean;
  shell?: boolean;
}

/** Runs a child process; stdout is captured (and shown on stderr), stderr goes to the terminal. */
export type ProcessRunner = (request: ProcessRequest) => Promise<{ code: number; stdout: string }>;

export const runProcess: ProcessRunner = (request) =>
  new Promise((done, fail) => {
    // npx is a .cmd script on Windows, which only runs through a shell
    const windows = process.platform === 'win32';
    const shell = request.shell === true || (windows && request.command === 'npx');
    const args = request.shell === true ? [] : windows && shell ? request.args.map(quoteForCmd) : [...request.args];
    const child = spawn(request.command, args, {
      cwd: request.cwd,
      env: request.env,
      shell,
      windowsHide: true,
      stdio: [request.input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
      if (request.echo !== false) process.stderr.write(chunk);
    });
    if (request.input !== undefined) child.stdin?.end(request.input);
    child.once('error', fail);
    child.once('close', (code) => done({ code: code ?? 1, stdout }));
  });

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export interface OwnAccountInput {
  api: BohrApi;
  instanceUrl: string;
  project: ApiProject;
  branch: string;
  production: boolean;
  /** The repository's root, for its commit. */
  root: string;
  /** The folder with the wrangler config, where wrangler runs. */
  directory: string;
  deployConfig: DeployConfig | null;
  build: boolean;
}

export interface OwnAccountDependencies {
  env: NodeJS.ProcessEnv;
  logger: Logger;
  runShell?: ShellRunner;
  runProcess?: ProcessRunner;
}

export interface OwnAccountResult {
  /** The preview's address (its alias, else the version's), or production's. */
  url: string | null;
  /** bohr's record of the deploy; null when it could not be recorded. */
  deploymentId: string | null;
  versionId: string | null;
  /** The version's own preview address (also for production, when wrangler printed one). */
  previewUrl: string | null;
  workerName: string | null;
  commitSha: string | null;
}

/** What wrangler said it deployed. */
export interface WranglerOutcome {
  versionId: string | null;
  previewUrl: string | null;
  aliasUrl: string | null;
  /** `wrangler deploy`'s addresses (workers.dev, routes, custom domains). */
  targets: string[];
  workerName: string | null;
}

/** Builds with the build variables kept in bohr, runs wrangler in the owner's account and records the result. */
export async function deployOwnAccount(
  input: OwnAccountInput,
  deps: OwnAccountDependencies,
): Promise<OwnAccountResult> {
  const { logger } = deps;
  const run = deps.runProcess ?? runProcess;
  // A tree with uncommitted changes deploys "local", not the commit it started from
  const commitSha =
    (await git(['status', '--porcelain', '--untracked-files=no'], input.root)) === ''
      ? await headCommit(input.root)
      : null;
  const tag = `bohr-${commitSha === null ? 'local' : commitSha.slice(0, 12)}`;

  const credentials = await input.api.ownAccountCredentials(input.project.id, {
    branch: input.branch,
    production: input.production,
  });
  const secrets = secretValues(credentials);
  for (const secret of secrets) mask(logger, secret);
  try {
    return await withCredentials(input, deps, run, credentials, commitSha, tag);
  } catch (error) {
    if (error instanceof CliError) throw new CliError(redact(error.message, secrets), error.exitCode, error.code);
    throw new CliError(redact(error instanceof Error ? error.message : String(error), secrets));
  }
}

async function withCredentials(
  input: OwnAccountInput,
  deps: OwnAccountDependencies,
  run: ProcessRunner,
  credentials: OwnAccountCredentials,
  commitSha: string | null,
  tag: string,
): Promise<OwnAccountResult> {
  const { logger } = deps;
  const { directory, production } = input;

  // The build gets the build variables kept in bohr, as in the deploy workflow; never the bohr token or the
  // Cloudflare token, which only wrangler gets
  const buildEnv: NodeJS.ProcessEnv = { ...deps.env };
  delete buildEnv[TOKEN_ENV];
  delete buildEnv.CLOUDFLARE_API_TOKEN;
  delete buildEnv.CLOUDFLARE_ACCOUNT_ID;
  exportBuildVariables(credentials.buildVariables, logger, (name, value) => {
    buildEnv[name] = value;
  });
  if (input.build && input.deployConfig !== null) {
    await runBuild(input.deployConfig, directory, logger, { run: deps.runShell, env: buildEnv });
  }

  const config = readWranglerJson(directory);
  const configName = typeof config?.settings.name === 'string' ? config.settings.name : null;
  const workerName = credentials.workerName ?? configName;
  if (credentials.workerName !== undefined && configName !== null && configName !== credentials.workerName) {
    const message = `This folder's wrangler config deploys the Worker "${configName}", but ${input.project.name}'s site is "${credentials.workerName}" (the wrangler config on ${input.project.productionBranch}).`;
    if (production) throw new CliError(`${message} Nothing was deployed.`, EXIT.notAllowed, 'worker_mismatch');
    logger.warning(message);
  }

  const output = await mkdtemp(join(deps.env.RUNNER_TEMP || tmpdir(), 'bohr-wrangler-'));
  const outputFile = join(output, 'output.json');
  const wranglerEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    CLOUDFLARE_API_TOKEN: credentials.apiToken,
    CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
    // Never an interactive login or question: what to deploy was decided (and confirmed) already
    CI: buildEnv.CI || 'true',
    WRANGLER_OUTPUT_FILE_PATH: outputFile,
  };
  const customDeploy = input.deployConfig !== null && input.deployConfig.deploy !== DEFAULT_DEPLOY_COMMAND;
  const gate = customDeploy ? null : await protectionGate(directory, buildEnv, run);
  try {
    let stdout: string;
    if (!production) {
      const alias = previewAlias(input.branch, workerName);
      const wrangler = wranglerCommand(directory, alias === null ? undefined : PREVIEW_ALIAS_WRANGLER, logger);
      const args = [
        ...wrangler,
        'versions',
        'upload',
        ...(gate === null ? [] : ['--config', gate.config]),
        '--message',
        'bohr',
        '--tag',
        tag,
        ...(alias === null ? [] : ['--preview-alias', alias]),
      ];
      stdout = await logger.group(`Upload a preview version${alias === null ? '' : ` (alias ${alias})`}`, async () => {
        const result = await run({ command: 'npx', args, cwd: directory, env: wranglerEnv });
        if (result.code !== 0) {
          throw new CliError(
            `wrangler versions upload failed (exit code ${result.code}); see its output above. Production was not touched.`,
          );
        }
        return result.stdout;
      });
    } else {
      const wrangler = wranglerCommand(directory, undefined, logger);
      for (const binding of d1Migrations(directory)) {
        await logger.group(`D1 migrations of ${binding}`, async () => {
          const result = await run({
            command: 'npx',
            args: [...wrangler, 'd1', 'migrations', 'apply', binding, '--remote'],
            cwd: directory,
            env: wranglerEnv,
          });
          if (result.code !== 0) {
            throw new CliError(
              `The D1 migrations of ${binding} failed (exit code ${result.code}); see wrangler's output above. The Worker was not deployed: production still serves the previous version.`,
            );
          }
        });
      }
      stdout = await logger.group('Deploy production', async () => {
        const result = customDeploy
          ? await run({
              command: input.deployConfig?.deploy ?? '',
              args: [],
              cwd: directory,
              env: wranglerEnv,
              shell: true,
            })
          : await run({
              command: 'npx',
              args: [
                ...wrangler,
                'deploy',
                ...(gate === null ? [] : ['--config', gate.config]),
                '--message',
                'bohr',
                '--tag',
                tag,
              ],
              cwd: directory,
              env: wranglerEnv,
            });
        if (result.code !== 0) {
          throw new CliError(
            `The production deploy failed (exit code ${result.code}); see wrangler's output above. Cloudflare keeps serving the previous version.`,
          );
        }
        return result.stdout;
      });
    }
    const outcome = parseWranglerOutput(await readFile(outputFile, 'utf8').catch(() => null), stdout);
    const deployedName = outcome.workerName ?? workerName;
    const url = production
      ? (input.project.productionUrl ?? outcome.targets.find((target) => target.startsWith('https://')) ?? null)
      : (outcome.aliasUrl ?? outcome.previewUrl);
    if (!production && url === null) {
      logger.warning(
        'wrangler printed no preview address: turn on preview URLs for the Worker ("preview_urls": true in its wrangler config) to open previews.',
      );
    }
    const deploymentId = await record(input, logger, {
      branch: input.branch,
      production,
      workerName: deployedName,
      versionId: outcome.versionId,
      url,
      commitSha,
    });
    return {
      url,
      deploymentId,
      versionId: outcome.versionId,
      previewUrl: outcome.previewUrl,
      workerName: deployedName,
      commitSha,
    };
  } finally {
    await rm(output, { recursive: true, force: true });
    for (const file of gate?.created ?? []) await rm(file, { force: true });
  }
}

/** Records the deploy in bohr; a failure only warns, since the deploy itself is done. */
async function record(
  input: OwnAccountInput,
  logger: Logger,
  report: Parameters<BohrApi['recordDeploy']>[1],
): Promise<string | null> {
  try {
    return (await input.api.recordDeploy(input.project.id, report)).deploy.id;
  } catch (error) {
    logger.warning(`Deployed, but bohr did not record it: ${(error as Error).message}`);
    return null;
  }
}

/** The values to keep out of every message: the Cloudflare token, and build variables long enough to be secrets. */
function secretValues(credentials: OwnAccountCredentials): string[] {
  return [credentials.apiToken, ...Object.values(credentials.buildVariables).filter((value) => value.length >= 6)];
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret !== '') out = out.split(secret).join('***');
  }
  return out;
}

/**
 * Wraps the site in bohr's protection gate (Basic Auth when the owner turns it on), as the deploy workflow does:
 * the gate's config path, and the files to remove afterwards. Null when the site cannot be wrapped (a TOML config,
 * a non-JavaScript entry), and it deploys as it is, like in the workflow.
 */
async function protectionGate(directory: string, env: NodeJS.ProcessEnv, run: ProcessRunner) {
  const location = readWranglerJson(directory);
  const existed = new Set(
    location === null
      ? []
      : GATE_FILES.map((name) => join(dirname(location.path), name)).filter((path) => existsSync(path)),
  );
  const result = await run({
    command: process.execPath,
    args: ['-'],
    cwd: directory,
    env,
    input: gateSetupScript(),
    echo: false,
  });
  if (result.code !== 0)
    throw new CliError(`Could not set up bohr's protection gate (node exited with code ${result.code}).`);
  const path = result.stdout.trim();
  if (path === '') return null;
  const config = resolve(directory, path);
  const created = GATE_FILES.map((name) => join(dirname(config), name)).filter((file) => !existed.has(file));
  return { config, created };
}

/**
 * The deploy folder's JSON wrangler config, parsed: the one the build generated (.wrangler/deploy/config.json)
 * when there is one, else wrangler.jsonc or wrangler.json. Null for a TOML config or an unreadable one.
 */
export function readWranglerJson(directory: string): { path: string; settings: Record<string, unknown> } | null {
  let path = ['wrangler.jsonc', 'wrangler.json'].map((name) => join(directory, name)).find((file) => existsSync(file));
  const redirect = join(directory, '.wrangler', 'deploy', 'config.json');
  if (existsSync(redirect)) {
    try {
      const target = (JSON.parse(readFileSync(redirect, 'utf8')) as { configPath?: unknown }).configPath;
      if (typeof target === 'string' && target !== '') path = resolve(dirname(redirect), target);
    } catch {
      // wrangler reports a broken redirect itself
    }
  }
  if (path === undefined || !existsSync(path)) return null;
  try {
    const settings = JSON.parse(stripJsonComments(readFileSync(path, 'utf8')));
    return typeof settings === 'object' && settings !== null ? { path, settings } : null;
  } catch {
    return null;
  }
}

/**
 * The D1 databases whose migrations production applies first, as the deploy workflow does: those of the folder's
 * wrangler.jsonc (or wrangler.json) that declare a `migrations_dir` the folder has.
 */
export function d1Migrations(directory: string): string[] {
  const file = ['wrangler.jsonc', 'wrangler.json']
    .map((name) => join(directory, name))
    .find((path) => existsSync(path));
  if (file === undefined) return [];
  let settings: { d1_databases?: { binding?: string; database_name?: string; migrations_dir?: string }[] };
  try {
    settings = JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
  const names = new Set(d1MigrationBindings(settings));
  return (settings.d1_databases ?? []).flatMap((database) => {
    const name = database.binding || database.database_name;
    return name && names.has(name) && database.migrations_dir && existsSync(join(directory, database.migrations_dir))
      ? [name]
      : [];
  });
}

/**
 * npx's arguments before wrangler's own: the project's wrangler when it has one recent enough, else the pinned
 * release. The project's is what its workflow runs.
 */
export function wranglerCommand(directory: string, minimum: string | undefined, logger: Logger): string[] {
  const local = localWranglerVersion(directory);
  if (local !== null && (minimum === undefined || compareVersions(local, minimum) >= 0)) return ['wrangler'];
  logger.info(
    local === null
      ? `wrangler is not installed in this project: running wrangler ${PINNED_WRANGLER}.`
      : `The project's wrangler ${local} is older than ${minimum}, which previews need: running wrangler ${PINNED_WRANGLER}.`,
  );
  return ['--yes', `wrangler@${PINNED_WRANGLER}`];
}

/** The version of node_modules/wrangler in the folder or a parent, where npx finds it. */
export function localWranglerVersion(directory: string): string | null {
  for (let current = resolve(directory); ; current = dirname(current)) {
    const manifest = join(current, 'node_modules', 'wrangler', 'package.json');
    if (existsSync(manifest)) {
      try {
        const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }).version;
        return typeof version === 'string' ? version : null;
      } catch {
        return null;
      }
    }
    if (dirname(current) === current) return null;
  }
}

/** Compares "major.minor.patch" versions (pre-release suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .split('-')[0]
      ?.split('.')
      .map((part) => Number.parseInt(part, 10) || 0) ?? [];
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The preview alias of a branch, as wrangler derives one itself (its generatePreviewAlias): lowercase letters,
 * digits and dashes, short enough that "<alias>-<worker>" is one DNS label; a long one is cut and ends with a short
 * hash of the branch, so two long branches do not share an alias. A branch starting with a digit gets "b-" (wrangler
 * would give it none). Null when nothing fits: the version's own address remains.
 */
export function previewAlias(branch: string, workerName: string | null): string | null {
  let slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (/^[0-9]/.test(slug)) slug = `b-${slug}`;
  if (!/^[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return null;
  const room = MAX_LABEL - (workerName?.length ?? 32) - 1;
  if (slug.length <= room) return slug;
  const suffix = `-${createHash('sha256').update(branch).digest('hex').slice(0, 4)}`;
  if (room - suffix.length < 1) return null;
  const cut = `${slug.slice(0, room - suffix.length).replace(/-+$/, '')}${suffix}`;
  return /^[a-z]/.test(cut) ? cut : null;
}

/**
 * wrangler's result: from the file it writes to WRANGLER_OUTPUT_FILE_PATH (one JSON object per line), else from
 * what it printed.
 */
export function parseWranglerOutput(file: string | null, stdout: string): WranglerOutcome {
  const outcome: WranglerOutcome = { versionId: null, previewUrl: null, aliasUrl: null, targets: [], workerName: null };
  for (const line of (file ?? '').split('\n')) {
    if (line.trim() === '') continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'version-upload' && entry.type !== 'deploy') continue;
    if (typeof entry.version_id === 'string') outcome.versionId = entry.version_id;
    if (typeof entry.worker_name === 'string') outcome.workerName = entry.worker_name;
    if (typeof entry.preview_url === 'string') outcome.previewUrl = entry.preview_url;
    if (typeof entry.preview_alias_url === 'string') outcome.aliasUrl = entry.preview_alias_url;
    if (Array.isArray(entry.targets)) {
      outcome.targets = entry.targets.filter((target): target is string => typeof target === 'string');
    }
  }
  const text = stripAnsi(stdout);
  const match = (pattern: RegExp) => pattern.exec(text)?.[1] ?? null;
  outcome.versionId ??= match(/(?:Worker Version ID|Current Version ID):\s*([0-9a-f-]{8,})/i);
  outcome.aliasUrl ??= match(/Version Preview Alias URL:\s*(https:\/\/\S+)/i);
  outcome.previewUrl ??= match(/Version Preview URL:\s*(https:\/\/\S+)/i);
  if (outcome.targets.length === 0) {
    const deployed = /Deployed .*? triggers[^\n]*\n((?:[ \t]+\S.*\n?)+)/i.exec(text)?.[1] ?? '';
    outcome.targets = deployed
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((target) => target !== '')
      .map((target) => (target.startsWith('https://') ? target : `https://${target}`));
  }
  return outcome;
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: wrangler colours its output
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** The step outputs of a deploy in GitHub Actions, as for projects bohr hosts. */
export function setActionOutputs(env: NodeJS.ProcessEnv, url: string | null, deploymentId: string | null): void {
  if (!github.inGithubActions(env) || !env.GITHUB_OUTPUT) return;
  if (url !== null) github.setOutput('url', url);
  if (deploymentId !== null) github.setOutput('deployment-id', deploymentId);
}
