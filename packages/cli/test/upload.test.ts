import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '../src/http';
import { type AssetFile, buildAssetManifest } from '../src/manifest';
import { CloudflareApiError, decodeJwtPayload, uploadAssets } from '../src/upload';
import { cloudflareOk, deferred, fakeJwt, jsonResponse, makeTempDir, noSleep, writeTree } from './helpers';

const UPLOAD_URL = 'https://api.cloudflare.com/client/v4/accounts/acc123/workers/assets/upload';
const CONTENTS: Record<string, string | Uint8Array> = {
  'index.html': '<h1>bohr</h1>',
  'app.js': 'console.log("hi")',
  'img/logo.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
  'data.unknownext': 'raw bytes',
};

let dir: string;
let files: AssetFile[];
const byPath = (path: string) => files.find((file) => file.path === path) as AssetFile;
const contentsOf = (file: AssetFile) => Buffer.from(CONTENTS[file.path.slice(1)] as string | Uint8Array);

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch mock that records calls and answers through `answer`. */
function mockFetch(answer: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn<Fetch>(async (url, init) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return answer(call, calls.length - 1);
  });
  return { fetch, calls };
}

const formKeys = (call: Call) => [...(call.init.body as FormData).keys()];

beforeEach(async () => {
  dir = await makeTempDir();
  await writeTree(dir, CONTENTS);
  ({ files } = await buildAssetManifest(dir));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('uploadAssets with buckets', () => {
  it('posts each bucket as a multipart form of base64 files, one field per hash', async () => {
    const html = byPath('/index.html');
    const js = byPath('/app.js');
    const png = byPath('/img/logo.png');
    const unknown = byPath('/data.unknownext');
    const token = fakeJwt({ exp: 2_000_000_000 });
    const { fetch, calls } = mockFetch((call) =>
      cloudflareOk(formKeys(call).includes(png.hash) ? { jwt: 'completion-jwt' } : {}),
    );

    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: token,
      buckets: [
        [html.hash, js.hash],
        [png.hash, unknown.hash],
      ],
      files,
      fetch,
      sleep: noSleep,
    });

    expect(result).toEqual({
      completionToken: 'completion-jwt',
      uploadedFiles: 4,
      uploadedBytes: html.size + js.size + png.size + unknown.size,
      singleAssetUploads: false,
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe(`${UPLOAD_URL}?base64=true`);
      expect(call.init.method).toBe('POST');
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${token}`);
      expect(call.init.body).toBeInstanceOf(FormData);
    }

    const forms = new Map(calls.map((call) => [formKeys(call).join(','), call.init.body as FormData]));
    expect([...forms.keys()].sort()).toEqual([`${html.hash},${js.hash}`, `${png.hash},${unknown.hash}`].sort());
    const partOf = (file: AssetFile) =>
      ([...forms.values()].find((form) => form.has(file.hash)) as FormData).get(file.hash) as File;
    for (const file of [html, js, png, unknown]) {
      const part = partOf(file);
      expect(part).toBeInstanceOf(File);
      expect(part.name).toBe(file.hash);
      expect(await part.text()).toBe(contentsOf(file).toString('base64'));
    }
    expect(partOf(html).type).toBe('text/html; charset=utf-8');
    expect(partOf(js).type).toBe('text/javascript; charset=utf-8');
    expect(partOf(png).type).toBe('image/png');
    expect(partOf(unknown).type).toBe('application/null');
  });

  it('keeps the last non-empty completion token', async () => {
    const { fetch } = mockFetch((_call, index) => cloudflareOk(index === 0 ? { jwt: 'first' } : { jwt: '' }));
    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: [[byPath('/index.html').hash], [byPath('/app.js').hash]],
      files,
      fetch,
      sleep: noSleep,
    });
    expect(result.completionToken).toBe('first');
  });

  it('uploads at most 3 buckets at a time', async () => {
    const gates = files.map(() => deferred());
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetch, calls } = mockFetch(async (_call, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[index]?.promise;
      inFlight--;
      return cloudflareOk(index === files.length - 1 ? { jwt: 'done' } : null);
    });
    const upload = uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: files.map((file) => [file.hash]),
      files,
      fetch,
      sleep: noSleep,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(inFlight).toBe(3);
    for (const gate of gates) gate.resolve();
    await expect(upload).resolves.toMatchObject({ completionToken: 'done', uploadedFiles: 4 });
    expect(maxInFlight).toBe(3);
  });

  it('retries a 503 after 1 second, then succeeds', async () => {
    const sleep = vi.fn(noSleep);
    const log = vi.fn();
    const { fetch, calls } = mockFetch((_call, index) =>
      index === 0 ? new Response('upstream unavailable', { status: 503 }) : cloudflareOk({ jwt: 'done' }),
    );
    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: [[byPath('/index.html').hash]],
      files,
      fetch,
      sleep,
      log,
    });
    expect(result.completionToken).toBe('done');
    expect(calls).toHaveLength(2);
    expect(formKeys(calls[1] as Call)).toEqual([byPath('/index.html').hash]);
    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(log.mock.calls[0]?.[0]).toMatch(/HTTP 503; retrying in 1s \(attempt 2 of 5\)/);
  });

  it('waits for Retry-After on 429', async () => {
    const sleep = vi.fn(noSleep);
    const { fetch } = mockFetch((_call, index) =>
      index === 0
        ? jsonResponse({ success: false, errors: [{ code: 971, message: 'rate limited' }] }, 429, {
            'Retry-After': '7',
          })
        : cloudflareOk({ jwt: 'done' }),
    );
    await uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: [[byPath('/index.html').hash]],
      files,
      fetch,
      sleep,
    });
    expect(sleep.mock.calls).toEqual([[7000]]);
  });

  it('retries network errors', async () => {
    const sleep = vi.fn(noSleep);
    const { fetch, calls } = mockFetch((_call, index) => {
      if (index === 0) throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
      return cloudflareOk({ jwt: 'done' });
    });
    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: [[byPath('/index.html').hash]],
      files,
      fetch,
      sleep,
    });
    expect(result.completionToken).toBe('done');
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls).toEqual([[1000]]);
  });

  it('gives up after 5 attempts with backoff 1s, 2s, 4s, 8s', async () => {
    const sleep = vi.fn(noSleep);
    const { fetch, calls } = mockFetch(() => new Response('bad gateway', { status: 502 }));
    await expect(
      uploadAssets({
        accountId: 'acc123',
        uploadToken: 'opaque-token',
        buckets: [[byPath('/index.html').hash]],
        files,
        fetch,
        sleep,
      }),
    ).rejects.toThrow('Cloudflare asset upload failed (HTTP 502): bad gateway');
    expect(calls).toHaveLength(5);
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000], [8000]]);
  });

  it('does not retry client errors and reports Cloudflare messages', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ success: false, errors: [{ code: 10_000, message: 'Authentication error' }], result: null }, 401),
    );
    const upload = uploadAssets({
      accountId: 'acc123',
      uploadToken: 'opaque-token',
      buckets: [[byPath('/index.html').hash]],
      files,
      fetch,
      sleep: noSleep,
    });
    await expect(upload).rejects.toBeInstanceOf(CloudflareApiError);
    await expect(upload).rejects.toThrow(
      /HTTP 401\): Authentication error \[code 10000\]\nThe upload token was rejected/,
    );
    expect(calls).toHaveLength(1);
  });

  it('fails when no upload returns a completion token', async () => {
    const { fetch } = mockFetch(() => cloudflareOk(null));
    await expect(
      uploadAssets({
        accountId: 'acc123',
        uploadToken: 'opaque-token',
        buckets: [[byPath('/index.html').hash]],
        files,
        fetch,
        sleep: noSleep,
      }),
    ).rejects.toThrow('Cloudflare did not return an assets completion token');
  });

  it('fails on a hash that is not in the manifest', async () => {
    const { fetch, calls } = mockFetch(() => cloudflareOk({ jwt: 'x' }));
    await expect(
      uploadAssets({ accountId: 'acc123', uploadToken: 'opaque', buckets: [['f'.repeat(32)]], files, fetch }),
    ).rejects.toThrow(`not in the manifest (hash ${'f'.repeat(32)})`);
    expect(calls).toHaveLength(0);
  });

  it('returns the upload token when there is nothing to upload', async () => {
    const { fetch, calls } = mockFetch(() => cloudflareOk({}));
    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: 'already-complete',
      buckets: [[]],
      files,
      fetch,
    });
    expect(result).toEqual({
      completionToken: 'already-complete',
      uploadedFiles: 0,
      uploadedBytes: 0,
      singleAssetUploads: false,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('uploadAssets with single-asset uploads', () => {
  it('posts each file raw to /upload/<hash> when the token asks for it', async () => {
    const token = fakeJwt({ wrangler_single_asset_uploads: true });
    const html = byPath('/index.html');
    const png = byPath('/img/logo.png');
    const unknown = byPath('/data.unknownext');
    const { fetch, calls } = mockFetch((call) => cloudflareOk(call.url.endsWith(png.hash) ? { jwt: 'done' } : null));

    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: token,
      buckets: [[html.hash, png.hash], [unknown.hash]],
      files,
      fetch,
      sleep: noSleep,
    });

    expect(result).toMatchObject({ completionToken: 'done', uploadedFiles: 3, singleAssetUploads: true });
    expect(calls.map((call) => call.url).sort()).toEqual(
      [html, png, unknown].map((file) => `${UPLOAD_URL}/${file.hash}`).sort(),
    );
    for (const [file, type] of [
      [html, 'text/html; charset=utf-8'],
      [png, 'image/png'],
      [unknown, 'application/null'],
    ] as const) {
      const call = calls.find((candidate) => candidate.url.endsWith(file.hash)) as Call;
      expect(call.init.method).toBe('POST');
      const headers = new Headers(call.init.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(headers.get('content-type')).toBe(type);
      expect(Buffer.from(call.init.body as Uint8Array)).toEqual(contentsOf(file));
    }
  });

  it('retries single uploads too', async () => {
    const sleep = vi.fn(noSleep);
    const token = fakeJwt({ wrangler_single_asset_uploads: true });
    const { fetch, calls } = mockFetch((_call, index) =>
      index === 0
        ? new Response('busy', { status: 503, headers: { 'Retry-After': '2' } })
        : cloudflareOk({ jwt: 'done' }),
    );
    const result = await uploadAssets({
      accountId: 'acc123',
      uploadToken: token,
      buckets: [[byPath('/app.js').hash]],
      files,
      fetch,
      sleep,
    });
    expect(result.completionToken).toBe('done');
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls).toEqual([[2000]]);
  });

  it('limits parallel uploads to the token edge_kv_upload_concurrency', async () => {
    const token = fakeJwt({ wrangler_single_asset_uploads: true, edge_kv_upload_concurrency: 2 });
    const gates = files.map(() => deferred());
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetch, calls } = mockFetch(async (_call, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[index]?.promise;
      inFlight--;
      return cloudflareOk(index === 0 ? { jwt: 'done' } : null);
    });
    const upload = uploadAssets({
      accountId: 'acc123',
      uploadToken: token,
      buckets: [files.map((file) => file.hash)],
      files,
      fetch,
      sleep: noSleep,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    for (const gate of gates) gate.resolve();
    await expect(upload).resolves.toMatchObject({ uploadedFiles: 4 });
    expect(maxInFlight).toBe(2);
  });
});

describe('decodeJwtPayload', () => {
  it('decodes the payload without verifying it', () => {
    expect(decodeJwtPayload(fakeJwt({ wrangler_single_asset_uploads: true, n: 1 }))).toEqual({
      wrangler_single_asset_uploads: true,
      n: 1,
    });
  });

  it('returns undefined for anything that is not a JWT', () => {
    expect(decodeJwtPayload('opaque')).toBeUndefined();
    expect(decodeJwtPayload('a.###.c')).toBeUndefined();
    expect(decodeJwtPayload(`a.${Buffer.from('[1]').toString('base64url')}.c`)).toBeUndefined();
  });
});
