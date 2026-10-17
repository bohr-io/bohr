import { existsSync } from 'node:fs';
import { readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { invalidPlanPath, planOwns, prepareBuildPlan } from '../src/build-plan';
import type { Fetch } from '../src/http';
import { requestBuildPlan } from '../src/instance';
import { fakeJwt, jsonResponse, makeTempDir, noSleep, recordingLogger, writeTree } from './helpers';

const OIDC = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 600 });
const SECRET = 'sk_build_secret_value_0123456789';
const WRANGLER = '{ "name": "store", "compatibility_date": "2026-10-01", "assets": { "directory": "dist" } }';
const PLAN = {
  found: true,
  nodeVersion: '22',
  install: 'npm ci',
  build: 'npm run build',
  files: { 'wrangler.jsonc': WRANGLER, '.bohr/worker.mjs': 'export default {};\n' },
  buildVariables: { API_KEY: SECRET, MULTI: 'line one\nline two', GITHUB_TOKEN: 'nope' },
};

async function setup(response: () => Response | Promise<Response>) {
  const workspace = await makeTempDir();
  const fetch = vi.fn<Fetch>(async () => response());
  const { logger, lines, secrets } = recordingLogger();
  const exported: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  const deps = {
    fetch,
    getIdToken: vi.fn(async () => OIDC),
    logger,
    exportVariable: (name: string, value: string) => {
      exported[name] = value;
    },
    setOutput: (name: string, value: string) => {
      outputs[name] = value;
    },
    sleep: noSleep,
  };
  const run = () => prepareBuildPlan({ instanceUrl: 'https://bohr.example/', workspace }, deps);
  return { workspace, fetch, deps, lines, secrets, exported, outputs, run };
}

describe('build plan mode', () => {
  it('writes the files, masks and exports the build variables and sets the outputs', async () => {
    const { workspace, fetch, run, lines, secrets, exported, outputs } = await setup(() => jsonResponse(PLAN));
    const result = await run();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://bohr.example/api/deploy/build-plan');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${OIDC}`);

    expect(await readFile(join(workspace, 'wrangler.jsonc'), 'utf8')).toBe(WRANGLER);
    expect(await readFile(join(workspace, '.bohr', 'worker.mjs'), 'utf8')).toBe('export default {};\n');
    expect(secrets).toEqual(expect.arrayContaining([OIDC, SECRET, 'line one\nline two', 'line one', 'line two']));
    // The build variables, and the mark that makes the deploy step publish the assets as bohr v1 did
    expect(exported).toEqual({ API_KEY: SECRET, MULTI: 'line one\nline two', BOHR_V1_ASSETS: 'true' });
    expect(outputs).toEqual({
      found: 'true',
      'node-version': '22',
      install: 'npm ci',
      build: 'npm run build',
      live: 'false',
    });
    expect(result).toEqual({
      found: true,
      files: [
        { path: 'wrangler.jsonc', status: 'written' },
        { path: '.bohr/worker.mjs', status: 'written' },
      ],
      variables: ['API_KEY', 'MULTI'],
    });
    const log = lines.join('\n');
    expect(log).not.toContain(SECRET);
    expect(log).toContain('Skipped the build variable "GITHUB_TOKEN"');
  });

  it('sets found=false and changes nothing when bohr has no plan (404 or found: false)', async () => {
    for (const answer of [
      () => jsonResponse({ found: false }, 404),
      () => new Response('Not Found', { status: 404 }),
      () => jsonResponse({ found: false }),
    ]) {
      const { workspace, run, exported, outputs } = await setup(answer);
      expect(await run()).toEqual({ found: false });
      expect(outputs).toEqual({ found: 'false' });
      expect(exported).toEqual({});
      expect(existsSync(join(workspace, 'wrangler.jsonc'))).toBe(false);
    }
  });

  it('falls back (found=false) when the run cannot get an OIDC token', async () => {
    const { run, fetch, deps, outputs, lines } = await setup(() => jsonResponse(PLAN));
    deps.getIdToken.mockRejectedValueOnce(new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable'));
    expect(await run()).toEqual({ found: false });
    expect(outputs).toEqual({ found: 'false' });
    expect(fetch).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('id-token: write');
  });

  it('fails when bohr refuses the run', async () => {
    const { run, outputs, exported } = await setup(() =>
      jsonResponse({ error: 'Build plans are only given to push … runs, not pull_request.' }, 403),
    );
    await expect(run()).rejects.toThrow(/HTTP 403\): Build plans are only given/);
    expect(outputs).toEqual({});
    expect(exported).toEqual({});
  });

  it("replaces the repository's own wrangler.jsonc with a warning, and keeps identical files", async () => {
    const { workspace, run, lines } = await setup(() =>
      jsonResponse({ ...PLAN, files: { ...PLAN.files, 'public/robots.txt': 'User-agent: *\n' } }),
    );
    await writeTree(workspace, { 'wrangler.jsonc': '{ "name": "old" }', 'public/robots.txt': 'User-agent: *\n' });
    const result = await run();
    expect(await readFile(join(workspace, 'wrangler.jsonc'), 'utf8')).toBe(WRANGLER);
    expect(result).toMatchObject({
      files: expect.arrayContaining([
        { path: 'wrangler.jsonc', status: 'replaced' },
        { path: 'public/robots.txt', status: 'unchanged' },
      ]),
    });
    expect(lines).toContain(
      "warning: wrangler.jsonc: the repository's copy differs from the build plan's; using the build plan's.",
    );
  });

  it('refuses to overwrite a file it does not own, before writing anything', async () => {
    const { workspace, run, outputs } = await setup(() =>
      jsonResponse({ ...PLAN, files: { ...PLAN.files, 'package.json': '{}' } }),
    );
    await writeTree(workspace, { 'package.json': '{ "name": "site" }' });
    await expect(run()).rejects.toThrow(/already has package.json with other contents/);
    expect(existsSync(join(workspace, 'wrangler.jsonc'))).toBe(false);
    expect(await readFile(join(workspace, 'package.json'), 'utf8')).toBe('{ "name": "site" }');
    expect(outputs).toEqual({});
  });

  it('refuses paths outside the workspace and through symbolic links', async () => {
    for (const path of ['../evil.js', '/etc/passwd', '.github/workflows/x.yml', 'a\\b', '.git/hooks/post-checkout']) {
      const { run, workspace } = await setup(() => jsonResponse({ ...PLAN, files: { [path]: 'x' } }));
      await expect(run(), path).rejects.toThrow('invalid file path');
      expect(existsSync(join(workspace, '..', 'evil.js'))).toBe(false);
    }

    const { run, workspace } = await setup(() => jsonResponse({ ...PLAN, files: { '.bohr/worker.mjs': 'x' } }));
    const outside = await makeTempDir();
    try {
      await symlink(outside, join(workspace, '.bohr'), 'junction');
    } catch {
      return; // No permission to create links here
    }
    await expect(run()).rejects.toThrow('symbolic link');
    expect(existsSync(join(outside, 'worker.mjs'))).toBe(false);
  });
});

describe('plan paths', () => {
  it('accepts repository-relative paths and knows the files a plan owns', () => {
    expect(invalidPlanPath('wrangler.jsonc')).toBeNull();
    expect(invalidPlanPath('site/.bohr/worker.mjs')).toBeNull();
    for (const path of ['', 'a//b', './a', 'a/./b', 'C:/x', '.GitHub/a', 'x/.git/config', 'a\nb']) {
      expect(invalidPlanPath(path), path).not.toBeNull();
    }
    expect(planOwns('wrangler.jsonc')).toBe(true);
    expect(planOwns('site/wrangler.jsonc')).toBe(true);
    expect(planOwns('.bohr/worker.mjs')).toBe(true);
    expect(planOwns('lambda-adapter.mjs')).toBe(true);
    expect(planOwns('package.json')).toBe(false);
    expect(planOwns('.bohr')).toBe(false);
  });
});

describe('requestBuildPlan', () => {
  const client = (fetch: Fetch) => ({ instanceUrl: 'https://bohr.example', token: 'oidc', fetch, sleep: noSleep });

  it('retries server errors and validates the answer', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ found: true, nodeVersion: '20', install: null }));
    expect(await requestBuildPlan(client(fetch))).toEqual({
      nodeVersion: '20',
      install: null,
      build: null,
      files: {},
      buildVariables: {},
      live: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    for (const body of [
      {},
      { found: 'yes', nodeVersion: '20' },
      { found: true },
      { found: true, nodeVersion: '20', install: 1 },
      { found: true, nodeVersion: '20', files: { a: 1 } },
      { found: true, nodeVersion: '20', buildVariables: ['A'] },
    ]) {
      await expect(requestBuildPlan(client(async () => jsonResponse(body)))).rejects.toThrow('without a valid');
    }
  });
});
