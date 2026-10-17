import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProject } from '../src/api';
import type { Context } from '../src/commands';
import type { DeployOptions, DeployResult } from '../src/deploy';
import type { Fetch } from '../src/http';
import { main } from '../src/main';
import { jsonResponse, makeTempDir, noSleep, writeTree } from './helpers';

const INSTANCE = 'https://app.bohr.io';
const TOKEN = `bohr_${'a'.repeat(40)}`;
const WRANGLER = JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'dist' } });
const RESULT: DeployResult = {
  deploymentId: 'd_1',
  script: 'p_loja-feature',
  url: 'https://feature-loja-ana.bohr.io',
  mainModule: null,
  modules: 0,
  assetFiles: 2,
  assetBytes: 10,
  uploadedFiles: 1,
  uploadedBytes: 5,
};

function project(overrides: Partial<ApiProject> = {}): ApiProject {
  return {
    id: 'p_loja',
    name: 'Loja',
    repository: 'ana/loja',
    productionBranch: 'main',
    mode: 'managed',
    status: 'active',
    role: 'owner',
    productionUrl: 'https://loja.example.com',
    hostnames: [{ hostname: 'loja.example.com', branch: 'main', isProduction: true, status: 'live' }],
    ...overrides,
  };
}

let dir: string;
let config: string;

beforeEach(async () => {
  dir = await makeTempDir();
  config = await makeTempDir();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(config, { recursive: true, force: true });
});

function git(...args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

/** A repository of ana/loja on `branch`, with a wrangler config and a .bohr/deploy.json. */
async function repository(branch = 'feature', files: Record<string, string> = {}) {
  git('init', '--quiet', '--initial-branch', branch);
  git('remote', 'add', 'origin', 'git@github.com:ana/loja.git');
  await writeTree(dir, {
    'wrangler.jsonc': WRANGLER,
    '.bohr/deploy.json': JSON.stringify({ install: 'npm ci', build: 'npm run build' }),
    ...files,
  });
}

/** Runs the CLI against a fake instance; `api` answers "METHOD /path" with a body (or [status, body]). */
async function cli(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    api?: Record<string, unknown | (() => unknown)>;
    context?: Partial<Context>;
  } = {},
) {
  const fetch = vi.fn<Fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    const route = options.api?.[key];
    if (route === undefined) return jsonResponse({ error: `No fake for ${key}` }, 404);
    const answer = typeof route === 'function' ? (route as () => unknown)() : route;
    return Array.isArray(answer) ? jsonResponse(answer[1], answer[0]) : jsonResponse(answer);
  });
  const deploy = vi.fn(async (_options: DeployOptions) => RESULT);
  const runV1 = vi.fn(async (_args: string[], _env: NodeJS.ProcessEnv) => 0);
  const commands: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(args, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    runV1,
    context: {
      env: { BOHR_CONFIG_DIR: config, ...options.env },
      cwd: dir,
      fetch,
      sleep: noSleep,
      interactive: false,
      deploy: deploy as unknown as Context['deploy'],
      runShell: async (commandLine) => {
        commands.push(commandLine);
        return 0;
      },
      ...options.context,
    },
  });
  const out = stdout.join('\n');
  return { code, out, err: stderr.join('\n'), json: () => JSON.parse(out), fetch, deploy, commands, runV1 };
}

describe('bohr deploy in a bohr v1 repository', () => {
  it("hands the run to bohr v1's CLI with the same arguments, touching nothing itself", async () => {
    await writeTree(dir, {
      '.github/workflows/bohr.yml': 'jobs:\n  deploy:\n    steps:\n      - uses: bohr-io/action@main\n',
      '.bohr.env': 'BUILD_CMD=npm run build',
      'index.html': 'v1 site',
    });
    const before = await readdir(dir, { recursive: true });
    const run = await cli(['deploy'], { env: { BOHR_TOKEN: TOKEN } });
    expect(run.code).toBe(0);
    expect(run.runV1).toHaveBeenCalledTimes(1);
    expect(run.runV1.mock.calls[0]?.[0]).toEqual(['deploy']);
    expect(run.err).toContain("running bohr v1's CLI (bohr@1.0.577)");
    expect(run.err).toContain('.github/workflows/bohr.yml uses bohr-io/action');
    expect(run.fetch).not.toHaveBeenCalled();
    expect(run.deploy).not.toHaveBeenCalled();
    expect(run.commands).toEqual([]);
    expect(await readdir(dir, { recursive: true })).toEqual(before);
  });

  it("hands over inside bohr v1's action, even where a wrangler config exists", async () => {
    await writeTree(dir, { 'wrangler.jsonc': WRANGLER });
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION_REPOSITORY: 'bohr-io/action',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/x?y=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
    };
    const run = await cli(['deploy'], { env });
    expect(run.runV1).toHaveBeenCalledTimes(1);
    expect(run.err).toContain("bohr v1's GitHub Action (bohr-io/action) ran it");
    expect(run.fetch).not.toHaveBeenCalled();
  });

  it('never hands a run over twice; outside CI, a folder that is no project is explained', async () => {
    await writeTree(dir, { '.github/workflows/bohr.yml': 'steps:\n  - uses: bohr-io/action@main\n' });
    const loop = await cli(['deploy', '--json'], { env: { BOHR_TOKEN: TOKEN, BOHR_V1_DELEGATED: '1' } });
    expect(loop.code).toBe(1);
    expect(loop.runV1).not.toHaveBeenCalled();
    await rm(join(dir, '.github'), { recursive: true });
    const plain = await cli(['deploy', '--json'], { env: { BOHR_TOKEN: TOKEN } });
    expect(plain.code).toBe(4);
    expect(plain.json()).toMatchObject({ ok: false, error: { code: 'not_a_v2_project' } });
    expect(plain.runV1).not.toHaveBeenCalled();
  });

  it('hands over in a workflow that uses bohr-io/action, and on bohr v1 options', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': WRANGLER,
      '.github/workflows/custom.yml': 'steps:\n  - uses: "bohr-io/action@main"\n  - run: npx bohr@latest deploy\n',
    });
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKSPACE: dir,
      GITHUB_WORKFLOW_REF: 'ana/site/.github/workflows/custom.yml@refs/heads/main',
    };
    expect((await cli(['deploy'], { env })).runV1).toHaveBeenCalledTimes(1);
    const v1Option = await cli(['deploy', '--no-install', '--no-build'], { env: { BOHR_TOKEN: TOKEN } });
    expect(v1Option.runV1.mock.calls[0]?.[0]).toEqual(['deploy', '--no-install', '--no-build']);
    expect(v1Option.err).toContain("--no-install is an option of bohr v1's deploy");
  });
});

describe('bohr login, whoami and logout', () => {
  it('signs in with the device flow and stores the token for the user only', async () => {
    const polls = [
      { status: 'pending' },
      { status: 'approved', token: TOKEN, user: { id: 'u_ana', name: 'Ana', email: 'ana@example.com' } },
    ];
    const run = await cli(['login', '--json'], {
      api: {
        'POST /api/cli/login': {
          deviceCode: 'device',
          userCode: 'BCDF-GHJK',
          verificationUrl: `${INSTANCE}/cli?code=BCDF-GHJK`,
          expiresIn: 600,
          interval: 5,
        },
        'POST /api/cli/login/poll': () => polls.shift(),
      },
      context: { hostname: 'ana-laptop' },
    });
    expect(run.code).toBe(0);
    expect(run.json()).toEqual({
      ok: true,
      instanceUrl: INSTANCE,
      user: { id: 'u_ana', name: 'Ana', email: 'ana@example.com' },
    });
    expect(run.err).toContain(`${INSTANCE}/cli?code=BCDF-GHJK`);
    expect(JSON.parse(String(run.fetch.mock.calls[0]?.[1]?.body))).toEqual({ clientName: 'CLI on ana-laptop' });

    const path = join(config, 'credentials.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored.instances[INSTANCE]).toMatchObject({ token: TOKEN, user: { id: 'u_ana' } });
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);

    const me = await cli(['whoami'], {
      api: {
        'GET /api/cli/me': {
          user: { id: 'u_ana', name: 'Ana', email: 'ana@example.com' },
          token: { id: 'tok_1', name: 'CLI on ana-laptop', projects: null, expiresAt: null },
        },
      },
    });
    expect(me.out).toBe(
      `Ana <ana@example.com> on ${INSTANCE}\nToken "CLI on ana-laptop" (bohr login): all your projects`,
    );
    expect(new Headers(me.fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);

    const out = await cli(['logout'], { api: { 'DELETE /api/cli/token': { revoked: true } } });
    expect(out.out).toBe(`Signed out of ${INSTANCE}.`);
    expect(JSON.parse(await readFile(path, 'utf8')).instances).toEqual({});
  });

  it('says when the sign-in was denied, and asks to sign in first', async () => {
    const denied = await cli(['login'], {
      api: {
        'POST /api/cli/login': {
          deviceCode: 'd',
          userCode: 'BCDF-GHJK',
          verificationUrl: 'x',
          expiresIn: 600,
          interval: 5,
        },
        'POST /api/cli/login/poll': { status: 'denied' },
      },
    });
    expect(denied.code).toBe(3);
    const signedOut = await cli(['projects', '--json']);
    expect(signedOut.code).toBe(3);
    expect(signedOut.json().error).toMatchObject({ code: 'not_signed_in' });
    expect((await cli(['whoami'], { env: { BOHR_TOKEN: 'ghp_wrong' } })).code).toBe(3);
  });
});

describe('bohr deploy with a token', () => {
  const api = (overrides: Partial<ApiProject> = {}) => ({
    'GET /api/cli/projects?repository=ana%2Floja': { projects: [project(overrides)] },
  });

  it('builds and deploys a preview of the checked-out branch, and prints one JSON result', async () => {
    await repository('feature');
    const run = await cli(['deploy', '--json'], { env: { BOHR_TOKEN: TOKEN }, api: api({ role: 'member' }) });
    expect(run.code).toBe(0);
    expect(run.commands).toEqual(['npm ci', 'npm run build']);
    expect(run.deploy.mock.calls[0]?.[0]).toMatchObject({
      workingDirectory: dir,
      instanceUrl: INSTANCE,
      apiToken: { token: TOKEN, target: { projectId: 'p_loja', branch: 'feature', production: false } },
    });
    expect(run.json()).toMatchObject({
      ok: true,
      url: RESULT.url,
      deploymentId: 'd_1',
      project: { id: 'p_loja', name: 'Loja' },
      branch: 'feature',
      production: false,
    });
  });

  it('deploys a preview, not production, from the production branch without --prod', async () => {
    await repository('main');
    const run = await cli(['deploy', '--no-build'], { env: { BOHR_TOKEN: TOKEN }, api: api() });
    expect(run.code).toBe(0);
    expect(run.out).toBe(RESULT.url);
    expect(run.commands).toEqual([]);
    expect(run.deploy.mock.calls[0]?.[0].apiToken?.target).toEqual({
      projectId: 'p_loja',
      branch: 'main-preview',
      production: false,
    });
    expect(run.err).toContain('main is the production branch: deploying a preview on main-preview');
  });

  it('deploys production with --prod for owners, after asking at a terminal', async () => {
    await repository('feature');
    const prompt = vi.fn(async () => 'n');
    const cancelled = await cli(['deploy', '--prod'], {
      env: { BOHR_TOKEN: TOKEN },
      api: api(),
      context: { interactive: true, prompt },
    });
    expect(cancelled.code).toBe(1);
    expect(prompt).toHaveBeenCalledWith('Deploy this folder to production (https://loja.example.com)? [y/N] ');
    expect(cancelled.deploy).not.toHaveBeenCalled();

    const run = await cli(['deploy', '--prod', '--yes'], {
      env: { BOHR_TOKEN: TOKEN },
      api: api(),
      context: { interactive: true, prompt },
    });
    expect(run.code).toBe(0);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(run.deploy.mock.calls[0]?.[0].apiToken?.target).toEqual({
      projectId: 'p_loja',
      branch: 'main',
      production: true,
    });
  });

  it('refuses production to members, and own-account projects to members, before building', async () => {
    await repository('feature');
    const member = await cli(['deploy', '--prod', '--json'], {
      env: { BOHR_TOKEN: TOKEN },
      api: api({ role: 'member' }),
    });
    expect(member.code).toBe(5);
    expect(member.json().error.code).toBe('production_not_allowed');

    // In the owner's own account, even previews need the owner: wrangler deploys with the account's token
    const byo = await cli(['deploy', '--json'], {
      env: { BOHR_TOKEN: TOKEN },
      api: api({ mode: 'byo', role: 'member' }),
    });
    expect(byo.code).toBe(5);
    expect(byo.json().error).toMatchObject({ code: 'own_account_not_allowed' });
    expect(byo.json().error.message).toContain("runs in its owner's Cloudflare account");
    for (const run of [member, byo]) {
      expect(run.commands).toEqual([]);
      expect(run.deploy).not.toHaveBeenCalled();
    }
    expect((await cli(['deploy', '--prod', '--branch', 'dev'], { env: { BOHR_TOKEN: TOKEN }, api: api() })).code).toBe(
      2,
    );
  });

  it('uses the link and --project over the remote, and reports projects it cannot reach', async () => {
    await repository('feature', { '.bohr/project.json': JSON.stringify({ projectId: 'p_other' }) });
    const linked = await cli(['deploy', '--no-build', '--json'], {
      env: { BOHR_TOKEN: TOKEN },
      api: { 'GET /api/cli/projects/p_other': { project: project({ id: 'p_other', buildPlan: false } as never) } },
    });
    expect(linked.code).toBe(0);
    expect(linked.deploy.mock.calls[0]?.[0].apiToken?.target.projectId).toBe('p_other');

    const missing = await cli(['deploy', '--project', 'p_nope', '--json'], {
      env: { BOHR_TOKEN: TOKEN },
      api: { 'GET /api/cli/projects/p_nope': [404, { error: 'Project not found.' }] },
    });
    expect(missing.code).toBe(4);
  });

  it("leaves the project and branch to the run's OIDC token in GitHub Actions without BOHR_TOKEN", async () => {
    await repository('feature');
    const env = {
      GITHUB_ACTIONS: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/x?y=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
      GITHUB_SHA: 'abc',
      BOHR_V1_ASSETS: 'true',
    };
    const refused = await cli(['deploy', '--branch', 'x', '--json'], { env });
    expect(refused.code).toBe(2);
    const run = await cli(['deploy', '--no-build', '--json'], { env });
    expect(run.code).toBe(0);
    const options = run.deploy.mock.calls[0]?.[0];
    expect(options?.apiToken).toBeUndefined();
    expect(options).toMatchObject({ commitSha: 'abc', v1Assets: true });
  });
});

describe('bohr projects, link and open', () => {
  it('lists the projects, links the folder and prints the URL', async () => {
    await repository('feature');
    const env = { BOHR_TOKEN: TOKEN };
    const listed = await cli(['projects'], { env, api: { 'GET /api/cli/projects': { projects: [project()] } } });
    expect(listed.out.split('\n')).toEqual([
      'ID      NAME  REPOSITORY  HOSTED  ROLE   URL',
      'p_loja  Loja  ana/loja    bohr    owner  https://loja.example.com',
    ]);

    const linked = await cli(['link'], {
      env,
      api: { 'GET /api/cli/projects?repository=ana%2Floja': { projects: [project()] } },
    });
    expect(linked.code).toBe(0);
    expect(JSON.parse(await readFile(join(dir, '.bohr', 'project.json'), 'utf8'))).toEqual({ projectId: 'p_loja' });

    const opened = await cli(['open', '--json'], {
      env,
      api: { 'GET /api/cli/projects/p_loja': { project: project() } },
      context: { interactive: true, openUrl: async () => {} },
    });
    expect(opened.json()).toMatchObject({ url: 'https://loja.example.com', branch: 'main' });
    const noPreview = await cli(['open', '--branch', 'dev'], {
      env,
      api: { 'GET /api/cli/projects/p_loja': { project: project() } },
    });
    expect(noPreview.code).toBe(4);
  });

  it('explains usage errors and bohr v1 commands', async () => {
    const dev = await cli(['dev']);
    expect(dev.runV1.mock.calls[0]?.[0]).toEqual(['dev']);
    expect(dev.err).toContain('"bohr dev" is a bohr v1 command');
    expect((await cli(['deploy', '--nope'])).code).toBe(2);
    const help = await cli(['deploy', '--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('--prod');
    expect((await cli(['--help'])).out).toContain('Exit codes: 0 done');
  });
});
