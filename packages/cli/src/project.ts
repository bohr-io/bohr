// What makes a folder a bohr v2 project for the CLI: its link (.bohr/project.json), its build (.bohr/deploy.json)
// and its wrangler config; and how a repository still on bohr v1 is told apart, so the CLI touches nothing there.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  DEPLOY_CONFIG_PATH,
  type DeployConfig,
  deployConfigSchema,
  usesBohrV1Action,
  WORKFLOWS_DIR,
} from '@bohr/shared';
import { CONFIG_FILES, DEPLOY_REDIRECT } from './config';
import { CliError, EXIT } from './errors';
import { gitRoot } from './git';

/** Written by `bohr link`: which project this folder deploys to. */
export const LINK_PATH = '.bohr/project.json';

export interface ProjectLink {
  projectId: string;
  /** The instance that manages it; absent: the default (https://app.bohr.io). */
  instanceUrl?: string;
}

/** The repository's root (git), else the folder itself. */
export async function projectRoot(cwd: string): Promise<string> {
  return resolve((await gitRoot(cwd)) ?? cwd);
}

export async function readLink(root: string): Promise<ProjectLink | null> {
  const path = join(root, LINK_PATH);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`${LINK_PATH} is not valid JSON. Run "bohr link" again.`, EXIT.usage, 'invalid_link');
  }
  const link = value as Partial<ProjectLink> | null;
  if (typeof link?.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(link.projectId)) {
    throw new CliError(`${LINK_PATH} has no valid projectId. Run "bohr link" again.`, EXIT.usage, 'invalid_link');
  }
  return {
    projectId: link.projectId,
    ...(typeof link.instanceUrl === 'string' ? { instanceUrl: link.instanceUrl } : {}),
  };
}

export async function writeLink(root: string, link: ProjectLink): Promise<string> {
  const path = join(root, LINK_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(link, null, 2)}\n`);
  return path;
}

/** The project's .bohr/deploy.json (how bohr builds it), or null when it has none. */
export async function readDeployConfig(root: string): Promise<DeployConfig | null> {
  let text: string;
  try {
    text = await readFile(join(root, DEPLOY_CONFIG_PATH), 'utf8');
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`${DEPLOY_CONFIG_PATH} is not valid JSON.`, EXIT.usage, 'invalid_deploy_config');
  }
  const parsed = deployConfigSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new CliError(`${DEPLOY_CONFIG_PATH} is invalid: ${issues.join('; ')}`, EXIT.usage, 'invalid_deploy_config');
  }
  return parsed.data;
}

/** A wrangler config the deploy can read, or one it explains how to convert (wrangler.toml). */
export function hasWranglerConfig(directory: string): boolean {
  return [...CONFIG_FILES, 'wrangler.toml', DEPLOY_REDIRECT].some((name) => existsSync(join(directory, name)));
}

/**
 * Why `bohr deploy` must not run here because the repository is on bohr v1, or null. In GitHub Actions: bohr v1's
 * action (bohr-io/action) runs `npx bohr@latest deploy` when bohr v2 has no build plan for the repository, so a
 * run of bohr-io/action, or of a workflow that uses it, is bohr v1's.
 */
export async function v1Run(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  if (env.GITHUB_ACTION_REPOSITORY?.toLowerCase() === 'bohr-io/action') {
    return "bohr v1's GitHub Action (bohr-io/action) ran it";
  }
  // owner/repo/.github/workflows/bohr.yml@refs/heads/main
  const workflow = /^[^/]+\/[^/]+\/(\.github\/workflows\/[^@]+)@/.exec(env.GITHUB_WORKFLOW_REF ?? '')?.[1];
  if (workflow !== undefined && env.GITHUB_WORKSPACE) {
    const text = await readFile(join(env.GITHUB_WORKSPACE, workflow), 'utf8').catch(() => null);
    if (text !== null && usesBohrV1Action(text)) return `its workflow ${workflow} runs bohr v1 (bohr-io/action)`;
  }
  return null;
}

/** Signs of bohr v1 in a repository: a workflow that uses bohr-io/action, or v1's .bohr.env. */
export async function v1Signs(root: string): Promise<string[]> {
  const signs: string[] = [];
  const dir = join(root, WORKFLOWS_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((file) => /\.ya?ml$/i.test(file)).sort()) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    if (usesBohrV1Action(text)) signs.push(`${WORKFLOWS_DIR}/${name} uses bohr-io/action`);
  }
  if (existsSync(join(root, '.bohr.env'))) signs.push('.bohr.env (bohr v1 settings)');
  return signs;
}

/** The error for a folder that is not a bohr v2 project; nothing was changed anywhere. */
export function notAV2Project(reason: string, signs: string[] = []): CliError {
  const v1 =
    signs.length > 0
      ? ` It looks like a bohr v1 project (${signs.join('; ')}): bohr v2's CLI does not deploy bohr v1 projects. Move it to bohr v2 in the panel at https://app.bohr.io.`
      : '';
  return new CliError(
    `This repository is not a bohr v2 project: ${reason}. Nothing was deployed or changed.${v1}`,
    EXIT.notFound,
    'not_a_v2_project',
  );
}
