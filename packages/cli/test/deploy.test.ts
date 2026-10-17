import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleOptions, WorkerBundle } from '../src/bundle';
import { type DeployDependencies, deploy } from '../src/deploy';
import { hashAsset } from '../src/hash';
import type { Fetch } from '../src/http';
import { cloudflareOk, fakeJwt, jsonResponse, makeTempDir, noSleep, recordingLogger, writeTree } from './helpers';

const INSTANCE = 'https://bohr.example';
const NOW = Date.parse('2026-10-11T12:00:00Z');
const OIDC = fakeJwt({ aud: 'bohr.io', repository: 'acme/site', exp: NOW / 1000 + 600 });
const UPLOAD_TOKEN = fakeJwt({ session: 'upload', exp: NOW / 1000 + 300 });
const COMPLETION_TOKEN = fakeJwt({ session: 'complete' });
const DEPLOYMENT = { deploymentId: 'dep_1', script: 'p3k9x0a7qd2m-main', url: 'https://site-acme.bohr.io' };

interface Call {
  url: string;
  init: RequestInit;
}

/** Routes requests to the instance and Cloudflare handlers and records them. */
function fakeServers(handlers: {
  session: (body: { manifest: Record<string, { hash: string }>; assetsConfig: unknown }) => Response;
  upload?: (call: Call) => Response;
}) {
  const calls: Call[] = [];
  const fetch = vi.fn<Fetch>(async (url, init = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (call.url === `${INSTANCE}/api/deploy/sessions`) return handlers.session(JSON.parse(init.body as string));
    if (call.url === `${INSTANCE}/api/deploy/sessions/ds_1/finalize`) return jsonResponse(DEPLOYMENT);
    if (call.url.startsWith('https://api.cloudflare.com/') && handlers.upload) return handlers.upload(call);
    throw new Error(`Unexpected request to ${call.url}`);
  });
  const finalizeForm = () => calls.find((call) => call.url.endsWith('/finalize'))?.init.body as FormData;
  const metadata = () => JSON.parse(finalizeForm().get('metadata') as string);
  return { fetch, calls, finalizeForm, metadata };
}

const workerBundle: WorkerBundle = {
  mainModule: 'index.js',
  modules: [
    {
      name: 'index.js',
      contentType: 'application/javascript+module',
      content: new TextEncoder().encode('export default {}'),
    },
  ],
};

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function dependencies(fetch: Fetch, overrides: Partial<DeployDependencies> = {}) {
  const recorder = recordingLogger();
  const bundleWorker = vi.fn(async (_options: BundleOptions) => workerBundle);
  const deps: DeployDependencies = {
    fetch,
    getIdToken: vi.fn(async () => OIDC),
    logger: recorder.logger,
    bundleWorker,
    sleep: noSleep,
    now: () => NOW,
    ...overrides,
  };
  return { deps, bundleWorker, ...recorder };
}

describe('deploy', () => {
  it('deploys a Worker with assets: session, upload of new files, finalize', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': `{
        // Migrated from bohr v1
        "name": "site",
        "main": "src/index.ts",
        "compatibility_date": "2026-10-01",
        "compatibility_flags": ["nodejs_compat"],
        "vars": { "PUBLIC_URL": "https://site-acme.bohr.io" },
        "assets": { "directory": "dist", "binding": "ASSETS", "not_found_handling": "single-page-application" },
      }`,
      'dist/index.html': '<h1>bohr</h1>',
      'dist/app.js': 'console.log(1)',
    });
    const newFileHash = hashAsset(Buffer.from('<h1>bohr</h1>'), 'index.html');
    const servers = fakeServers({
      session: () =>
        jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: UPLOAD_TOKEN, buckets: [[newFileHash]] }),
      upload: () => cloudflareOk({ jwt: COMPLETION_TOKEN }),
    });
    const { deps, bundleWorker, lines, secrets } = dependencies(servers.fetch);

    const result = await deploy({ workingDirectory: dir, instanceUrl: `${INSTANCE}/`, commitSha: 'abc123' }, deps);

    expect(result).toEqual({
      ...DEPLOYMENT,
      mainModule: 'index.js',
      modules: 1,
      assetFiles: 2,
      assetBytes: 13 + 14,
      uploadedFiles: 1,
      uploadedBytes: 13,
    });
    expect(bundleWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: dir,
        configPath: join(dir, 'wrangler.jsonc'),
        main: join(dir, 'src', 'index.ts'),
        workerName: 'site',
      }),
    );

    expect(servers.calls.map((call) => call.url)).toEqual([
      `${INSTANCE}/api/deploy/sessions`,
      'https://api.cloudflare.com/client/v4/accounts/acc/workers/assets/upload?base64=true',
      `${INSTANCE}/api/deploy/sessions/ds_1/finalize`,
    ]);
    const [session, upload, finalize] = servers.calls as [Call, Call, Call];
    expect(JSON.parse(session.init.body as string)).toEqual({
      manifest: {
        '/app.js': { hash: hashAsset(Buffer.from('console.log(1)'), 'app.js'), size: 14 },
        '/index.html': { hash: newFileHash, size: 13 },
      },
      assetsConfig: { notFoundHandling: 'single-page-application' },
    });
    expect(new Headers(session.init.headers).get('authorization')).toBe(`Bearer ${OIDC}`);
    expect(new Headers(upload.init.headers).get('authorization')).toBe(`Bearer ${UPLOAD_TOKEN}`);
    expect(new Headers(finalize.init.headers).get('authorization')).toBe(`Bearer ${OIDC}`);

    expect(servers.metadata()).toEqual({
      mainModule: 'index.js',
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      vars: { PUBLIC_URL: 'https://site-acme.bohr.io' },
      assetsBinding: 'ASSETS',
      assetsCompletionToken: COMPLETION_TOKEN,
      commitSha: 'abc123',
    });
    expect([...servers.finalizeForm().keys()]).toEqual(['metadata', 'index.js']);

    expect(secrets).toEqual(expect.arrayContaining([OIDC, UPLOAD_TOKEN, COMPLETION_TOKEN]));
    for (const token of [OIDC, UPLOAD_TOKEN, COMPLETION_TOKEN]) {
      expect(lines.some((line) => line.includes(token))).toBe(false);
    }
    expect(lines).toContain('+ /index.html');
    expect(lines).toContain(`Deployed ${DEPLOYMENT.url} (deployment dep_1, script ${DEPLOYMENT.script}).`);
  });

  it('deploys a Worker without assets with an empty manifest and null asset fields', async () => {
    await writeTree(dir, {
      'wrangler.json': JSON.stringify({ main: 'worker.js', compatibility_date: '2026-10-01' }),
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: null, buckets: [] }),
    });
    const { deps } = dependencies(servers.fetch);

    const result = await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, deps);

    expect(result).toMatchObject({ assetFiles: 0, uploadedFiles: 0, modules: 1, mainModule: 'index.js' });
    expect(servers.calls).toHaveLength(2);
    expect(JSON.parse(servers.calls[0]?.init.body as string)).toEqual({ manifest: {}, assetsConfig: {} });
    expect(servers.metadata()).toEqual({
      mainModule: 'index.js',
      compatibilityDate: '2026-10-01',
      compatibilityFlags: [],
      vars: {},
      assetsBinding: null,
      assetsCompletionToken: null,
      commitSha: null,
    });
  });

  it('deploys an assets-only project whose files Cloudflare already has', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({
        compatibility_date: '2026-10-01',
        assets: { directory: 'public', binding: 'ASSETS', html_handling: 'drop-trailing-slash' },
      }),
      'public/index.html': 'home',
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: UPLOAD_TOKEN, buckets: [] }),
    });
    const { deps, bundleWorker, lines } = dependencies(servers.fetch);

    const result = await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: 'abc' }, deps);

    expect(bundleWorker).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mainModule: null, modules: 0, assetFiles: 1, uploadedFiles: 0 });
    expect(servers.calls).toHaveLength(2);
    expect(JSON.parse(servers.calls[0]?.init.body as string).assetsConfig).toEqual({
      htmlHandling: 'drop-trailing-slash',
    });
    expect(servers.metadata()).toMatchObject({
      mainModule: null,
      assetsBinding: 'ASSETS',
      assetsCompletionToken: UPLOAD_TOKEN,
    });
    expect([...servers.finalizeForm().keys()]).toEqual(['metadata']);
    expect(lines).toContain('No new or changed assets: Cloudflare already stores every file.');
  });

  it('sends _redirects and _headers with the assets config', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
      'public/_redirects': '/old /new 301',
      'public/_headers': '/*\n  X-Robots-Tag: noindex',
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: UPLOAD_TOKEN, buckets: [] }),
    });
    const { deps, lines } = dependencies(servers.fetch);

    await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: 'abc' }, deps);

    const body = JSON.parse(servers.calls[0]?.init.body as string);
    expect(body.assetsConfig).toEqual({ redirects: '/old /new 301', headers: '/*\n  X-Robots-Tag: noindex' });
    expect(Object.keys(body.manifest)).toEqual(['/index.html']);
    expect(lines).toContainEqual(expect.stringMatching(/^Applying _redirects from .*public\.$/));
  });

  it('refuses a _redirects file larger than the instance accepts', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
      'public/_redirects': `/a /b 301\n`.repeat(30_000),
    });
    const servers = fakeServers({ session: () => jsonResponse({}) });
    const { deps } = dependencies(servers.fetch);

    await expect(deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: 'abc' }, deps)).rejects.toThrow(
      /_redirects is .* bohr\.io Cloud accepts up to/,
    );
    expect(servers.calls).toHaveLength(0);
  });

  it('deploys a Worker whose assets directory is empty without assets, with a warning', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({
        main: 'w.js',
        compatibility_date: '2026-10-01',
        assets: { directory: 'dist', binding: 'ASSETS' },
      }),
      'dist/.assetsignore': '*.map',
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: null, buckets: [] }),
    });
    const { deps, lines } = dependencies(servers.fetch);
    await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, deps);
    expect(
      lines.some((line) => line.startsWith('warning: The assets directory') && line.includes('Did the build run?')),
    ).toBe(true);
    expect(JSON.parse(servers.calls[0]?.init.body as string).manifest).toEqual({});
    expect(servers.metadata()).toMatchObject({ assetsBinding: null, assetsCompletionToken: null });
  });

  it('fails before any request when the OIDC token is unavailable', async () => {
    await writeTree(dir, { 'wrangler.jsonc': JSON.stringify({ main: 'w.js', compatibility_date: '2026-10-01' }) });
    const fetch = vi.fn<Fetch>();
    const { deps } = dependencies(fetch, {
      getIdToken: async () => {
        throw new Error('Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable');
      },
    });
    await expect(deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, deps)).rejects.toThrow(
      'Could not get a GitHub OIDC token: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable. The workflow (or job) needs "permissions: id-token: write"',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests a fresh OIDC token when the current one is about to expire', async () => {
    await writeTree(dir, { 'wrangler.jsonc': JSON.stringify({ main: 'w.js', compatibility_date: '2026-10-01' }) });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: null, buckets: [] }),
    });
    const expiring = fakeJwt({ exp: NOW / 1000 + 30 });
    const getIdToken = vi.fn(async () => expiring);
    const { deps } = dependencies(servers.fetch, { getIdToken });
    await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, deps);
    expect(getIdToken).toHaveBeenCalledTimes(3);

    const fresh = vi.fn(async () => OIDC);
    await deploy(
      { workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null },
      dependencies(servers.fetch, { getIdToken: fresh }).deps,
    );
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('refuses to deploy nothing', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/.assetsignore': '*',
    });
    const fetch = vi.fn<Fetch>();
    await expect(
      deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, dependencies(fetch).deps),
    ).rejects.toThrow('Nothing to deploy: the assets directory');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails when the instance wants uploads but sends no upload token', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: null, buckets: [['x']] }),
    });
    await expect(
      deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, dependencies(servers.fetch).deps),
    ).rejects.toThrow('asked for asset uploads without an upload token');
  });

  it('deploys with a bohr API token: no OIDC token, and the project and branch in the session request', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: COMPLETION_TOKEN, buckets: [] }),
    });
    const { deps } = dependencies(servers.fetch);
    const target = { projectId: 'p_loja', branch: 'feature/login', production: false };
    await deploy(
      { workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null, apiToken: { token: 'bohr_abc', target } },
      deps,
    );
    expect(deps.getIdToken).not.toHaveBeenCalled();
    const [session, finalize] = servers.calls as [Call, Call];
    expect(JSON.parse(session.init.body as string)).toMatchObject(target);
    for (const call of [session, finalize]) {
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer bohr_abc');
    }
  });

  it("publishes a migrated project's assets with bohr v1's rules", async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
      'public/package.json': '{}',
      'public/.env': 'SECRET=1',
      'public/big.csv': 'x'.repeat(64),
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: COMPLETION_TOKEN, buckets: [] }),
    });
    const { deps, lines } = dependencies(servers.fetch);
    await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null, v1Assets: true }, deps);
    const [session] = servers.calls as [Call];
    expect(Object.keys(JSON.parse(session.init.body as string).manifest)).toEqual(['/big.csv', '/index.html']);
    expect(lines).toContain("Migrated from bohr v1: assets follow v1's rules (1 file v1 never published left out).");
    expect(lines).toContain('warning: Skipped /.env: environment files are never published.');
  });

  it('never finalizes, so the live version stays, when an upload fails', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({ compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
      'public/index.html': 'home',
    });
    const servers = fakeServers({
      session: (body) =>
        jsonResponse({
          sessionId: 'ds_1',
          accountId: 'acc',
          uploadToken: UPLOAD_TOKEN,
          buckets: [Object.values(body.manifest).map((entry) => entry.hash)],
        }),
      upload: () => jsonResponse({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403),
    });
    await expect(
      deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, dependencies(servers.fetch).deps),
    ).rejects.toThrow('Cloudflare asset upload failed (HTTP 403)');
    expect(servers.calls.some((call) => call.url.endsWith('/finalize'))).toBe(false);
  });

  it('logs config warnings', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': JSON.stringify({
        main: 'w.js',
        compatibility_date: '2026-10-01',
        triggers: { crons: ['* * * * *'] },
      }),
    });
    const servers = fakeServers({
      session: () => jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: null, buckets: [] }),
    });
    const { deps, lines } = dependencies(servers.fetch);
    await deploy({ workingDirectory: dir, instanceUrl: INSTANCE, commitSha: null }, deps);
    expect(lines).toContain(
      'warning: triggers.crons in wrangler.jsonc are ignored: bohr.io Cloud does not run cron triggers yet.',
    );
  });
});
