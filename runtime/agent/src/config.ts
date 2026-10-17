import { AGENT_EVENTS_PATH, AGENT_PORT, GIT_TOKEN_PLACEHOLDER, INTERNAL_HOST, WORKSPACE_DIR } from '@bohr/shared';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface RunnerConfig {
  port: number;
  workspace: string;
  remoteBase: string;
  eventsUrl: string;
  /** The repository to clone when /git/sync finds no checkout and no job has run yet. */
  defaultRepo?: RepoRef;
}

const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** Reads the runner's settings from the environment. Everything has a default for the container. */
export function readConfig(env: NodeJS.ProcessEnv): RunnerConfig {
  const port = env.BOHR_AGENT_PORT ? Number(env.BOHR_AGENT_PORT) : AGENT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BOHR_AGENT_PORT must be a TCP port, not "${env.BOHR_AGENT_PORT}".`);
  }
  const config: RunnerConfig = {
    port,
    workspace: env.BOHR_WORKSPACE_DIR || WORKSPACE_DIR,
    remoteBase: env.BOHR_GIT_REMOTE_BASE || `https://x-access-token:${GIT_TOKEN_PLACEHOLDER}@github.com`,
    eventsUrl: env.BOHR_EVENTS_URL || `http://${INTERNAL_HOST}${AGENT_EVENTS_PATH}`,
  };
  const repo = env.BOHR_REPO?.trim();
  if (repo) {
    const [owner = '', name = '', ...rest] = repo.split('/');
    if (rest.length > 0 || !isRepoPart(owner) || !isRepoPart(name)) {
      throw new Error(`BOHR_REPO must look like <owner>/<name>, not "${repo}".`);
    }
    config.defaultRepo = { owner, name };
  }
  return config;
}

function isRepoPart(value: string): boolean {
  return REPO_PART.test(value) && !/^\.+$/.test(value);
}

/** The git remote for a repository: `<base>/<owner>/<name>.git`. */
export function remoteUrl(base: string, repo: RepoRef): string {
  if (!isRepoPart(repo.owner) || !isRepoPart(repo.name)) {
    throw new Error(`Invalid repository ${repo.owner}/${repo.name}.`);
  }
  return `${base.replace(/\/+$/, '')}/${repo.owner}/${repo.name}.git`;
}
