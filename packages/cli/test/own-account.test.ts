import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gateSetupScript } from '@bohr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProject } from '../src/api';
import type { Context } from '../src/commands';
import type { Fetch } from '../src/http';
import { main } from '../src/main';
import {
  compareVersions,
  localWranglerVersion,
  PINNED_WRANGLER,
  type ProcessRequest,
  parseWranglerOutput,
  previewAlias,
  redact,
  runProcess,
} from '../src/own-account';
import { jsonResponse, makeTempDir, noSleep, writeTree } from './helpers';

const TOKEN = `bohr_${'a'.repeat(40)}`;
const CF_TOKEN = 'cf-owner-token-0123456789abcdefghijklmnop';
const SENTRY = 'sentry-build-secret-value';
const VERSION = '0f1e2d3c-aaaa-bbbb-cccc-123456789abc';
const ALIAS_URL = 'https://feature-login-loja.ana.workers.dev';
const VERSION_URL = 'https://0f1e2d3c-loja.ana.workers.dev';

const project = (overrides: Partial<ApiProject> = {}): ApiProject => ({
  id: 'p_loja',
  name: 'Loja',
  repository: 'ana/loja',
  productionBranch: 'main',
  mode: 'byo',
  status: 'active',
  role: 'owner',
  productionUrl: 'https://loja.example.com',
  hostnames: [],
  ...overrides,
});

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
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** A committed repository of ana/loja on `branch`; returns its commit. */
async function repository(branch: string, files: Record<string, string> = {}) {
  git('init', '--quiet', '--initial-branch', branch);
  git('remote', 'add', 'origin', 'git@github.com:ana/loja.git');
  await writeTree(dir, {
    'wrangler.jsonc': JSON.stringify({ name: 'loja', main: 'src/index.ts', compatibility_date: '2026-10-01' }),
    '.bohr/deploy.json': JSON.stringify({ install: 'npm ci', build: 'npm run build' }),
    'src/index.ts': 'export default {};',
    ...files,
  });
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'init');
  return git('rev-parse', 'HEAD');
}

type WranglerAnswer = { code?: number; stdout?: string; output?: Record<string, unknown> };

/** Runs the CLI against a fake instance and a fake wrangler. */
async function cli(
  args: string[],
  options: {
    api?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    wrangler?: (request: ProcessRequest) => WranglerAnswer | Promise<WranglerAnswer>;
    gate?: (request: ProcessRequest) => Promise<string>;
    context?: Partial<Context>;
  } = {},
) {
  const bodies: Record<string, unknown[]> = {};
  const fetch = vi.fn<Fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    if (init?.body) bodies[key] = [...(bodies[key] ?? []), JSON.parse(String(init.body))];
    const routes: Record<string, unknown> = {
      'GET /api/cli/projects?repository=ana%2Floja': { projects: [project()] },
      'POST /api/cli/projects/p_loja/credentials': {
        accountId: 'acc-ana',
        apiToken: CF_TOKEN,
        buildVariables: { SENTRY_TOKEN: SENTRY, PUBLIC_FLAG: '1', CLOUDFLARE_API_TOKEN: 'nope' },
        workerName: 'loja',
        ...options.credentials,
      },
      'POST /api/cli/projects/p_loja/deploys': { deploy: { id: 'cd_1' } },
      ...options.api,
    };
    const route = routes[key];
    if (route === undefined) return jsonResponse({ error: `No fake for ${key}` }, 404);
    return Array.isArray(route) ? jsonResponse(route[1], route[0]) : jsonResponse(route);
  });
  const builds: { commandLine: string; env: NodeJS.ProcessEnv | undefined }[] = [];
  const processes: ProcessRequest[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(args, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    context: {
      env: { BOHR_CONFIG_DIR: config, BOHR_TOKEN: TOKEN, PATH: process.env.PATH },
      cwd: dir,
      fetch,
      sleep: noSleep,
      interactive: false,
      runShell: async (commandLine, _cwd, env) => {
        builds.push({ commandLine, env });
        return 0;
      },
      runProcess: async (request) => {
        processes.push(request);
        if (request.command === process.execPath) {
          return { code: 0, stdout: options.gate === undefined ? '' : await options.gate(request) };
        }
        const answer = (await options.wrangler?.(request)) ?? {};
        if (answer.output !== undefined && request.env.WRANGLER_OUTPUT_FILE_PATH) {
          await writeFile(request.env.WRANGLER_OUTPUT_FILE_PATH, `${JSON.stringify(answer.output)}\n`);
        }
        return { code: answer.code ?? 0, stdout: answer.stdout ?? '' };
      },
      ...options.context,
    },
  });
  const out = stdout.join('\n');
  return {
    code,
    out,
    err: stderr.join('\n'),
    json: () => JSON.parse(out),
    bodies,
    builds,
    processes,
    wrangler: processes.filter((request) => request.command !== process.execPath),
  };
}

const versionUpload = {
  type: 'version-upload',
  version: 1,
  worker_name: 'loja',
  version_id: VERSION,
  preview_url: VERSION_URL,
  preview_alias_url: ALIAS_URL,
};

/** wrangler's own arguments, after npx's ("--yes wrangler@x" or "wrangler", whichever this machine has). */
function wranglerArgs(request: ProcessRequest) {
  return request.args.slice(request.args.findIndex((arg) => /^wrangler(@|$)/.test(arg)) + 1);
}

/** Every file below the folder, contents included, to check no secret was written. */
async function everything(root: string) {
  const names = await readdir(root, { recursive: true });
  const contents = await Promise.all(names.map((name) => readFile(join(root, name), 'utf8').catch(() => '')));
  return names.join('\n') + contents.join('\n');
}

describe('bohr deploy of a project in its owner account', () => {
  it('builds with the build variables and uploads a preview version with a branch alias', async () => {
    const sha = await repository('feature/login');
    const run = await cli(['deploy', '--json'], { wrangler: () => ({ output: versionUpload }) });
    expect(run.code).toBe(0);
    expect(run.bodies['POST /api/cli/projects/p_loja/credentials']).toEqual([
      { branch: 'feature/login', production: false },
    ]);

    // The build: build variables (not reserved names), never the bohr or Cloudflare token
    expect(run.builds.map((build) => build.commandLine)).toEqual(['npm ci', 'npm run build']);
    for (const { env } of run.builds) {
      expect(env).toMatchObject({ SENTRY_TOKEN: SENTRY, PUBLIC_FLAG: '1' });
      expect(env?.BOHR_TOKEN).toBeUndefined();
      expect(env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
      expect(env?.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    }

    // wrangler: a version upload with an alias, which never changes what production serves
    expect(run.wrangler).toHaveLength(1);
    const [upload] = run.wrangler;
    expect(upload?.command).toBe('npx');
    expect(upload?.args).toEqual([
      '--yes',
      `wrangler@${PINNED_WRANGLER}`,
      'versions',
      'upload',
      '--message',
      'bohr',
      '--tag',
      `bohr-${sha.slice(0, 12)}`,
      '--preview-alias',
      'feature-login',
    ]);
    expect(upload?.cwd).toBe(dir);
    // The Cloudflare token only in wrangler's environment
    expect(upload?.env).toMatchObject({ CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acc-ana', CI: 'true' });
    expect(upload?.env.BOHR_TOKEN).toBeUndefined();
    expect(JSON.stringify(run.processes.map(({ command, args }) => [command, args]))).not.toContain(CF_TOKEN);
    expect(run.out + run.err).not.toContain(CF_TOKEN);
    expect(run.out + run.err).not.toContain(SENTRY);
    expect(await everything(dir)).not.toContain(CF_TOKEN);
    expect(existsSync(String(upload?.env.WRANGLER_OUTPUT_FILE_PATH))).toBe(false);

    expect(run.bodies['POST /api/cli/projects/p_loja/deploys']).toEqual([
      {
        branch: 'feature/login',
        production: false,
        workerName: 'loja',
        versionId: VERSION,
        url: ALIAS_URL,
        commitSha: sha,
      },
    ]);
    expect(run.json()).toEqual({
      ok: true,
      instanceUrl: 'https://app.bohr.io',
      url: ALIAS_URL,
      deploymentId: 'cd_1',
      project: { id: 'p_loja', name: 'Loja' },
      branch: 'feature/login',
      production: false,
      mode: 'byo',
      versionId: VERSION,
      previewUrl: VERSION_URL,
      workerName: 'loja',
      commitSha: sha,
      files: null,
      bytes: null,
      uploadedFiles: null,
      uploadedBytes: null,
      modules: null,
    });
  });

  it("applies the D1 migrations, then deploys production behind bohr's gate, after asking", async () => {
    await repository('main', {
      'wrangler.jsonc': JSON.stringify({
        name: 'loja',
        main: 'src/index.ts',
        compatibility_date: '2026-10-01',
        d1_databases: [
          { binding: 'DB', database_name: 'loja', migrations_dir: 'migrations' },
          { binding: 'CACHE', database_name: 'cache', migrations_dir: 'not-there' },
          { binding: 'PLAIN', database_name: 'plain' },
        ],
      }),
      'migrations/0001_init.sql': 'CREATE TABLE t (id INTEGER);',
    });
    // Uncommitted changes: the version is tagged "local" and no commit is recorded
    await writeFile(join(dir, 'src/index.ts'), 'export default { changed: true };');
    const prompt = vi.fn(async () => 'y');
    const run = await cli(['deploy', '--prod', '--no-build'], {
      context: { interactive: true, prompt },
      gate: async (request) => {
        await writeTree(request.cwd, { '.bohr-gate.mjs': '// gate', 'wrangler.bohr-gate.json': '{}' });
        return 'wrangler.bohr-gate.json';
      },
      wrangler: (request) =>
        request.args.includes('deploy')
          ? {
              stdout: `Deployed loja triggers (0.5 sec)\n  https://loja.ana.workers.dev\n  loja.example.com (custom domain)\nCurrent Version ID: ${VERSION}\n`,
            }
          : {},
    });
    expect(run.code).toBe(0);
    expect(prompt).toHaveBeenCalledWith(
      "Deploy this folder to production (https://loja.example.com) in the owner's Cloudflare account? [y/N] ",
    );
    expect(run.bodies['POST /api/cli/projects/p_loja/credentials']).toEqual([{ branch: 'main', production: true }]);
    expect(run.builds).toEqual([]);
    expect(run.wrangler.map(wranglerArgs)).toEqual([
      ['d1', 'migrations', 'apply', 'DB', '--remote'],
      ['deploy', '--config', join(dir, 'wrangler.bohr-gate.json'), '--message', 'bohr', '--tag', 'bohr-local'],
    ]);
    for (const request of run.wrangler) expect(request.env.CLOUDFLARE_API_TOKEN).toBe(CF_TOKEN);
    // The gate script never gets the token, and its files are gone afterwards
    const gate = run.processes.find((request) => request.command === process.execPath);
    expect(gate?.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(gate?.input).toContain('.bohr-gate.mjs');
    expect(existsSync(join(dir, '.bohr-gate.mjs'))).toBe(false);
    expect(existsSync(join(dir, 'wrangler.bohr-gate.json'))).toBe(false);

    expect(run.out).toBe('https://loja.example.com');
    expect(run.bodies['POST /api/cli/projects/p_loja/deploys']?.[0]).toEqual({
      branch: 'main',
      production: true,
      workerName: 'loja',
      versionId: VERSION,
      url: 'https://loja.example.com',
      commitSha: null,
    });
  });

  it('previews from the production branch without --prod, and deploys production only when asked', async () => {
    await repository('main');
    const preview = await cli(['deploy', '--no-build', '--json'], { wrangler: () => ({ output: versionUpload }) });
    expect(preview.json()).toMatchObject({ branch: 'main-preview', production: false });
    expect(preview.wrangler[0]?.args).toContain('main-preview');
    expect(preview.wrangler.some((request) => request.args.includes('deploy'))).toBe(false);

    // Without a terminal, --prod is the confirmation
    const production = await cli(['deploy', '--prod', '--no-build', '--json']);
    expect(production.code).toBe(0);
    expect(production.json()).toMatchObject({ branch: 'main', production: true, url: 'https://loja.example.com' });
  });

  it("runs the project's custom deploy command for production, without the gate", async () => {
    await repository('main', {
      '.bohr/deploy.json': JSON.stringify({ build: 'npm run build', deploy: 'npm run ship -- --env production' }),
    });
    const run = await cli(['deploy', '--prod', '--json']);
    expect(run.code).toBe(0);
    expect(run.processes.some((request) => request.command === process.execPath)).toBe(false);
    expect(run.wrangler).toEqual([
      expect.objectContaining({ command: 'npm run ship -- --env production', shell: true, args: [] }),
    ]);
    expect(run.wrangler[0]?.env.CLOUDFLARE_API_TOKEN).toBe(CF_TOKEN);
  });

  it("uses the project's wrangler when it is recent enough", async () => {
    await repository('feature', { 'node_modules/wrangler/package.json': JSON.stringify({ version: '4.40.0' }) });
    const recent = await cli(['deploy', '--no-build'], { wrangler: () => ({ output: versionUpload }) });
    expect(recent.wrangler[0]?.args.slice(0, 3)).toEqual(['wrangler', 'versions', 'upload']);

    await writeTree(dir, { 'node_modules/wrangler/package.json': JSON.stringify({ version: '3.99.0' }) });
    const old = await cli(['deploy', '--no-build'], { wrangler: () => ({ output: versionUpload }) });
    expect(old.wrangler[0]?.args.slice(0, 2)).toEqual(['--yes', `wrangler@${PINNED_WRANGLER}`]);
    expect(old.err).toContain('older than 4.21.0');
  });

  it('fails without taking anything down, and never shows the token', async () => {
    await repository('main');
    const failed = await cli(['deploy', '--prod', '--no-build', '--json'], { wrangler: () => ({ code: 1 }) });
    expect(failed.code).toBe(1);
    expect(failed.json().error.message).toContain('Cloudflare keeps serving the previous version');
    expect(failed.bodies['POST /api/cli/projects/p_loja/deploys']).toBeUndefined();

    const preview = await cli(['deploy', '--no-build', '--json'], { wrangler: () => ({ code: 1 }) });
    expect(preview.json().error.message).toContain('Production was not touched');

    const leaky = await cli(['deploy', '--no-build', '--json'], {
      wrangler: () => {
        throw new Error(`spawn failed with ${CF_TOKEN} and ${SENTRY}`);
      },
    });
    expect(leaky.code).toBe(1);
    expect(leaky.out).not.toContain(CF_TOKEN);
    expect(leaky.out).not.toContain(SENTRY);
    expect(leaky.json().error.message).toBe('spawn failed with *** and ***');
  });

  it("refuses a folder whose Worker is not the project's site in production, and members", async () => {
    await repository('main', {
      'wrangler.jsonc': JSON.stringify({ name: 'other', compatibility_date: '2026-10-01' }),
    });
    const mismatch = await cli(['deploy', '--prod', '--no-build', '--json']);
    expect(mismatch.code).toBe(5);
    expect(mismatch.json().error.code).toBe('worker_mismatch');
    expect(mismatch.wrangler).toEqual([]);

    const member = await cli(['deploy', '--json'], {
      api: { 'GET /api/cli/projects?repository=ana%2Floja': { projects: [project({ role: 'member' })] } },
    });
    expect(member.code).toBe(5);
    expect(member.json().error.code).toBe('own_account_not_allowed');
    expect(member.bodies['POST /api/cli/projects/p_loja/credentials']).toBeUndefined();

    // The instance says no too (a role changed since): exit 5, nothing run
    const refused = await cli(['deploy', '--json'], {
      api: {
        'POST /api/cli/projects/p_loja/credentials': [403, { error: 'Only owners…', code: 'own_account_not_allowed' }],
      },
    });
    expect(refused.code).toBe(5);
    expect(refused.processes).toEqual([]);
  });

  it('still reports the deploy when bohr cannot record it', async () => {
    await repository('feature');
    const run = await cli(['deploy', '--no-build', '--json'], {
      api: { 'POST /api/cli/projects/p_loja/deploys': [500, { error: 'Internal error.' }] },
      wrangler: () => ({ output: versionUpload }),
    });
    expect(run.code).toBe(0);
    expect(run.json()).toMatchObject({ url: ALIAS_URL, deploymentId: null, versionId: VERSION });
    expect(run.err).toContain('bohr did not record it');
  });
});

describe('own-account helpers', () => {
  it('derives preview aliases that fit a DNS label', () => {
    expect(previewAlias('feature/Login_Page', 'loja')).toBe('feature-login-page');
    expect(previewAlias('123-fix', 'loja')).toBe('b-123-fix');
    expect(previewAlias('---', 'loja')).toBeNull();
    const alias = previewAlias(`feature/${'x'.repeat(80)}`, 'my-worker');
    expect(`${alias}-my-worker`.length).toBe(63);
    // Cut long branches keep apart, by a hash of the branch
    expect(alias).toMatch(/^feature-x+-[0-9a-f]{4}$/);
    expect(previewAlias(`feature/${'x'.repeat(80)}y`, 'my-worker')).not.toBe(alias);
    expect(previewAlias('feature', 'w'.repeat(63))).toBeNull();
  });

  it("reads wrangler's printed result when it wrote no output file", () => {
    const upload = parseWranglerOutput(
      null,
      `\u001b[32mWorker Version ID:\u001b[0m ${VERSION}\nVersion Preview URL: ${VERSION_URL}\nVersion Preview Alias URL: ${ALIAS_URL}\n`,
    );
    expect(upload).toMatchObject({ versionId: VERSION, previewUrl: VERSION_URL, aliasUrl: ALIAS_URL });
    const deployed = parseWranglerOutput(
      '{"type":"wrangler-session"}\nnot json\n{"type":"deploy","version_id":"v-1","worker_name":"loja","targets":["https://loja.ana.workers.dev"]}\n',
      '',
    );
    expect(deployed).toMatchObject({ versionId: 'v-1', workerName: 'loja', targets: ['https://loja.ana.workers.dev'] });
  });

  it('compares versions, finds the local wrangler and redacts secrets', async () => {
    expect(compareVersions('4.21.0', '4.21.0')).toBe(0);
    expect(compareVersions('4.100.1', '4.21.0')).toBeGreaterThan(0);
    expect(compareVersions('3.114.0-beta.1', '4.0.0')).toBeLessThan(0);
    await writeTree(dir, { 'node_modules/wrangler/package.json': JSON.stringify({ version: '4.30.0' }) });
    expect(localWranglerVersion(join(dir, 'apps', 'web'))).toBe('4.30.0');
    expect(redact('a secret-long and secret', ['secret', 'secret-long'])).toBe('a *** and ***');
  });

  it("runs bohr's gate script for real: a gated copy of the config next to it", async () => {
    await writeTree(dir, {
      'wrangler.jsonc': [
        '// site',
        '{ "name": "loja", "main": "src/index.ts", "assets": { "directory": "dist" } }',
      ].join('\n'),
    });
    const result = await runProcess({
      command: process.execPath,
      args: ['-'],
      cwd: dir,
      env: { PATH: process.env.PATH },
      input: gateSetupScript(),
      echo: false,
    });
    expect(result.code).toBe(0);
    const gated = JSON.parse(await readFile(join(dir, result.stdout.trim()), 'utf8'));
    expect(gated).toMatchObject({
      name: 'loja',
      main: '.bohr-gate.mjs',
      assets: { binding: 'ASSETS', run_worker_first: true },
    });
    expect(await readFile(join(dir, '.bohr-gate.mjs'), 'utf8')).toContain("import * as site from './src/index.ts'");
  });
});
