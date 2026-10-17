import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAction } from '../src/action';
import type { Fetch } from '../src/http';
import { fakeJwt, jsonResponse, makeTempDir, writeTree } from './helpers';

// `bohr action` is what bohr-io/deploy-action runs: inputs from INPUT_*, results in the runner's files

const OIDC = fakeJwt({ aud: 'bohr.io', exp: Math.floor(Date.now() / 1000) + 600 });
const saved = { ...process.env };
let dir: string;
let stdout: string;
let requests: { url: string; body: unknown }[];

beforeEach(async () => {
  dir = await makeTempDir();
  stdout = '';
  requests = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  for (const file of ['output', 'env', 'summary']) await writeFile(join(dir, file), '');
  process.env = {
    ...saved,
    GITHUB_ACTIONS: 'true',
    GITHUB_OUTPUT: join(dir, 'output'),
    GITHUB_ENV: join(dir, 'env'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    GITHUB_WORKSPACE: join(dir, 'repo'),
    GITHUB_SHA: 'abc123',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/x?api-version=2.0',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request',
    'INPUT_INSTANCE-URL': 'https://bohr.example',
    'INPUT_WORKING-DIRECTORY': join(dir, 'repo'),
    INPUT_CREDENTIALS: 'false',
    'INPUT_BUILD-PLAN': 'false',
    INPUT_PHASE: 'prepare',
  };
  delete process.env.BOHR_V1_ASSETS;
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...saved };
  process.exitCode = undefined;
  await rm(dir, { recursive: true, force: true });
});

function instance(routes: Record<string, () => Response>) {
  const fetch = vi.fn<Fetch>(async (input, init) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    if (url.startsWith('https://token.actions.example/')) return jsonResponse({ value: OIDC });
    const route = routes[new URL(url).pathname];
    if (route === undefined) throw new Error(`Unexpected request to ${url}`);
    return route();
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const read = (file: string) => readFile(join(dir, file), 'utf8');
/** name -> value from the $GITHUB_OUTPUT / $GITHUB_ENV heredocs. */
function pairs(text: string) {
  return Object.fromEntries(
    [...text.matchAll(/^([^\n<]+)<<(ghadelimiter_[0-9a-f-]+)\r?\n([\s\S]*?)\r?\n\2$/gm)].map((match) => [
      match[1],
      match[3],
    ]),
  );
}

describe('bohr action', () => {
  it('deploys, sets the outputs and writes the job summary', async () => {
    await writeTree(join(dir, 'repo'), {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
      'public/.env.production': 'SECRET=1',
    });
    instance({
      '/api/deploy/sessions': () =>
        jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: 'done', buckets: [] }),
      '/api/deploy/sessions/ds_1/finalize': () =>
        jsonResponse({ deploymentId: 'd_1', script: 'p-main', url: 'https://site-acme.bohr.io' }),
    });
    await runAction();
    expect(process.exitCode).toBeUndefined();
    expect(pairs(await read('output'))).toEqual({ url: 'https://site-acme.bohr.io', 'deployment-id': 'd_1' });
    expect(await read('summary')).toContain('<h2>bohr.io Cloud deploy</h2>');
    expect(await read('summary')).toContain('<td>1</td><td>0</td><td>4 B</td><td>0</td><td>d_1</td>');
    expect(stdout).toContain(`::add-mask::${OIDC}`);
    expect(stdout).toContain('::group::Finalize deployment');
    expect(stdout).toContain('::warning::Skipped /.env.production: environment files are never published.');
    const session = requests.find((request) => request.url.endsWith('/api/deploy/sessions'));
    expect(Object.keys((session?.body as { manifest: object } | undefined)?.manifest ?? {})).toEqual(['/index.html']);
  });

  it("publishes with bohr v1's rules after the build plan's prepare step in the same job", async () => {
    await writeTree(join(dir, 'repo'), {});
    process.env['INPUT_BUILD-PLAN'] = 'true';
    instance({
      '/api/deploy/build-plan': () =>
        jsonResponse({
          found: true,
          nodeVersion: '20',
          install: 'npm ci',
          build: null,
          files: {
            'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
          },
          buildVariables: {},
          live: false,
        }),
    });
    await runAction();
    const env = pairs(await read('env'));
    expect(env).toEqual({ BOHR_V1_ASSETS: 'true' });
    expect(pairs(await read('output'))).toMatchObject({ found: 'true', 'node-version': '20', install: 'npm ci' });

    // The deploy step: the runner gives it the variable from $GITHUB_ENV
    process.env['INPUT_BUILD-PLAN'] = 'false';
    process.env.BOHR_V1_ASSETS = env.BOHR_V1_ASSETS;
    await writeTree(join(dir, 'repo'), {
      'public/index.html': 'home',
      'public/package.json': '{}',
      'public/README.md': '# v1 served it',
    });
    instance({
      '/api/deploy/sessions': () =>
        jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: 'done', buckets: [] }),
      '/api/deploy/sessions/ds_1/finalize': () =>
        jsonResponse({ deploymentId: 'd_2', script: 'p-main', url: 'https://site-acme.bohr.io' }),
    });
    await runAction();
    expect(process.exitCode).toBeUndefined();
    const session = requests.filter((request) => request.url.endsWith('/api/deploy/sessions')).at(-1);
    expect(Object.keys((session?.body as { manifest: object } | undefined)?.manifest ?? {})).toEqual([
      '/README.md',
      '/index.html',
    ]);
  });

  it('fails the step with an error annotation, and deploys nothing, when the instance refuses', async () => {
    await writeTree(join(dir, 'repo'), {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
    });
    instance({
      '/api/deploy/sessions': () => jsonResponse({ error: 'No bohr.io Cloud project is linked to a/b.' }, 404),
    });
    await runAction();
    expect(process.exitCode).toBe(1);
    expect(stdout).toMatch(/::error::The bohr instance could not open a deploy session \(HTTP 404\)/);
    expect(await read('output')).toBe('');
    expect(requests.some((request) => request.url.endsWith('/finalize'))).toBe(false);
  });

  it('refuses credentials and build-plan together', async () => {
    process.env.INPUT_CREDENTIALS = 'true';
    process.env['INPUT_BUILD-PLAN'] = 'TRUE';
    await runAction();
    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('::error::Set either credentials or build-plan, not both.');
  });
});
