import { describe, expect, it, vi } from 'vitest';
import type { WorkerModule } from '../src/bundle';
import type { Fetch } from '../src/http';
import {
  buildFinalizeForm,
  createDeploySession,
  type FinalizeMetadata,
  finalizeDeployment,
  InstanceError,
  normalizeInstanceUrl,
} from '../src/instance';
import { jsonResponse, noSleep } from './helpers';

const OIDC = 'oidc-token';
const client = (fetch: Fetch) => ({ instanceUrl: 'https://bohr.example', token: OIDC, fetch, sleep: noSleep });

const metadata: FinalizeMetadata = {
  mainModule: 'index.js',
  compatibilityDate: '2026-10-01',
  compatibilityFlags: ['nodejs_compat'],
  vars: { PUBLIC_URL: 'https://example.com' },
  assetsBinding: 'ASSETS',
  assetsCompletionToken: 'completion-jwt',
  commitSha: 'abc123',
};

const modules: WorkerModule[] = [
  {
    name: 'index.js',
    contentType: 'application/javascript+module',
    content: new TextEncoder().encode('export default {}'),
  },
  { name: 'index.js.map', contentType: 'application/source-map', content: new TextEncoder().encode('{"version":3}') },
  { name: 'wasm/add.wasm', contentType: 'application/wasm', content: Uint8Array.from([0, 97, 115, 109]) },
];

describe('normalizeInstanceUrl', () => {
  it('drops trailing slashes and keeps a path prefix', () => {
    expect(normalizeInstanceUrl('https://app.bohr.io/')).toBe('https://app.bohr.io');
    expect(normalizeInstanceUrl(' https://example.com/bohr/ ')).toBe('https://example.com/bohr');
  });

  it('requires https except on localhost', () => {
    expect(normalizeInstanceUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeInstanceUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(() => normalizeInstanceUrl('http://bohr.example')).toThrow('instance-url must use https');
    expect(() => normalizeInstanceUrl('bohr.example')).toThrow('is not a valid URL');
  });
});

describe('createDeploySession', () => {
  it('posts the manifest and assets config as JSON with the OIDC bearer', async () => {
    const fetch = vi.fn<Fetch>(async () =>
      jsonResponse({ sessionId: 'ds_1', accountId: 'acc', uploadToken: 'upload-jwt', buckets: [['a', 'b'], ['c']] }),
    );
    const request = {
      manifest: { '/index.html': { hash: 'a'.repeat(32), size: 12 } },
      assetsConfig: { notFoundHandling: '404-page', runWorkerFirst: ['/api/*'] },
    };
    const session = await createDeploySession(client(fetch), request);

    expect(session).toEqual({
      sessionId: 'ds_1',
      accountId: 'acc',
      uploadToken: 'upload-jwt',
      buckets: [['a', 'b'], ['c']],
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://bohr.example/api/deploy/sessions');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${OIDC}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it('accepts a session without assets', async () => {
    const fetch = vi.fn<Fetch>(async () =>
      jsonResponse({ sessionId: 'ds_2', accountId: 'acc', uploadToken: null, buckets: [] }),
    );
    const session = await createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} });
    expect(session).toEqual({ sessionId: 'ds_2', accountId: 'acc', uploadToken: null, buckets: [] });
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ manifest: {}, assetsConfig: {} });
  });

  it('shows the instance error message with a hint', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ error: 'Unknown repository acme/site' }, 404));
    const session = createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} });
    await expect(session).rejects.toBeInstanceOf(InstanceError);
    await expect(session).rejects.toThrow(
      /could not open a deploy session \(HTTP 404\): Unknown repository acme\/site\nNo bohr\.io Cloud managed project/,
    );
  });

  it('explains a rejected OIDC token', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ error: 'Invalid token audience' }, 401));
    await expect(createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} })).rejects.toThrow(
      /HTTP 401\): Invalid token audience\nThe GitHub OIDC token was rejected/,
    );
  });

  it('shows the start of a non-JSON error body', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response('<html>Forbidden</html>', { status: 403 }));
    await expect(createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} })).rejects.toThrow(
      '(HTTP 403): <html>Forbidden</html>',
    );
  });

  it('retries a 503', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ sessionId: 'ds_3', accountId: 'acc', uploadToken: null, buckets: [] }));
    await expect(createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} })).resolves.toMatchObject({
      sessionId: 'ds_3',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed answers', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ sessionId: 'ds_4', buckets: 'all' }));
    await expect(createDeploySession(client(fetch), { manifest: {}, assetsConfig: {} })).rejects.toThrow(
      'without a valid "buckets"',
    );
    const html = vi.fn<Fetch>(async () => new Response('<html></html>', { status: 200 }));
    await expect(createDeploySession(client(html), { manifest: {}, assetsConfig: {} })).rejects.toThrow(
      'unexpected body',
    );
  });
});

describe('finalizeDeployment', () => {
  it('builds a form with the metadata JSON and one typed part per module', async () => {
    const form = buildFinalizeForm(metadata, modules);
    expect([...form.keys()]).toEqual(['metadata', 'index.js', 'index.js.map', 'wasm/add.wasm']);
    expect(typeof form.get('metadata')).toBe('string');
    expect(JSON.parse(form.get('metadata') as string)).toEqual({
      mainModule: 'index.js',
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      vars: { PUBLIC_URL: 'https://example.com' },
      assetsBinding: 'ASSETS',
      assetsCompletionToken: 'completion-jwt',
      commitSha: 'abc123',
    });
    for (const module of modules) {
      const part = form.get(module.name) as File;
      expect(part).toBeInstanceOf(File);
      expect(part.name).toBe(module.name);
      expect(part.type).toBe(module.contentType);
      expect(new Uint8Array(await part.arrayBuffer())).toEqual(module.content);
    }
  });

  it('serializes null assets fields for projects without assets', () => {
    const form = buildFinalizeForm(
      { ...metadata, assetsBinding: null, assetsCompletionToken: null, commitSha: null },
      [],
    );
    expect([...form.keys()]).toEqual(['metadata']);
    expect(JSON.parse(form.get('metadata') as string)).toMatchObject({
      assetsBinding: null,
      assetsCompletionToken: null,
      commitSha: null,
    });
  });

  it('posts the form to the session and returns the deployment', async () => {
    const fetch = vi.fn<Fetch>(async () =>
      jsonResponse({ deploymentId: 'dep_1', script: 'p3k9x0a7qd2m-main', url: 'https://site-acme.bohr.io' }),
    );
    const deployment = await finalizeDeployment(client(fetch), 'ds_1/x', metadata, modules);
    expect(deployment).toEqual({
      deploymentId: 'dep_1',
      script: 'p3k9x0a7qd2m-main',
      url: 'https://site-acme.bohr.io',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://bohr.example/api/deploy/sessions/ds_1%2Fx/finalize');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${OIDC}`);
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('does not retry a failed finalize', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ error: 'Script upload failed' }, 502));
    await expect(finalizeDeployment(client(fetch), 'ds_1', metadata, modules)).rejects.toThrow(
      'could not finalize the deployment (HTTP 502): Script upload failed',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('explains a finalize call that got no answer, without retrying it', async () => {
    const fetch = vi.fn<Fetch>(async () => {
      throw new TypeError('fetch failed', { cause: new Error('socket hang up') });
    });
    await expect(finalizeDeployment(client(fetch), 'ds_1', metadata, modules)).rejects.toThrow(
      'The bohr instance did not answer the finalize call (fetch failed (socket hang up)). Check the deployment in the bohr panel',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('explains an expired session', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ error: 'Unknown session' }, 404));
    await expect(finalizeDeployment(client(fetch), 'ds_1', metadata, modules)).rejects.toThrow(
      /Unknown session\nThe deploy session expired/,
    );
  });
});
