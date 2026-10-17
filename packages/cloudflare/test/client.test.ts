import { describe, expect, it } from 'vitest';
import {
  CloudflareClient,
  CloudflareError,
  createDispatchAssetsUploadSession,
  findZoneForHostname,
  putDispatchScript,
  putDispatchScriptSecret,
  upsertWorkerRoute,
} from '../src';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// Records every request and answers from a queue of { status, body } envelopes
function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers, body: init?.body });
    const next = responses.shift() ?? { status: 500, body: { success: false, errors: [] } };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (result: unknown) => ({ body: { success: true, errors: [], result } });

describe('CloudflareClient', () => {
  it('identifies bohr in the User-Agent of every call', async () => {
    const { calls, fetchImpl } = mockFetch([ok(null), ok(null)]);
    await new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl }).request('GET', '/x');
    await new CloudflareClient({
      apiToken: 'token',
      accountId: 'acc',
      fetch: fetchImpl,
      userAgent: 'bohr/2.0.0 (+https://bohr.io)',
    }).request('GET', '/x');
    expect(calls.map((call) => call.headers['user-agent'])).toEqual([
      'bohr (+https://bohr.io)',
      'bohr/2.0.0 (+https://bohr.io)',
    ]);
  });

  it('sends the bearer token and unwraps the envelope', async () => {
    const { calls, fetchImpl } = mockFetch([ok({ jwt: 'upload-jwt', buckets: [['a', 'b']] })]);
    const client = new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl });

    const session = await createDispatchAssetsUploadSession(client, 'bohr-cloud', 'p1-main', {
      '/index.html': { hash: 'a'.repeat(32), size: 10 },
    });

    expect(session).toEqual({ jwt: 'upload-jwt', buckets: [['a', 'b']] });
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/workers/dispatch/namespaces/bohr-cloud/scripts/p1-main/assets-upload-session',
    );
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.authorization).toBe('Bearer token');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      manifest: { '/index.html': { hash: 'a'.repeat(32), size: 10 } },
    });
  });

  it('throws CloudflareError with the API errors', async () => {
    const { fetchImpl } = mockFetch([
      { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Auth' }] } },
    ]);
    const client = new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl });

    const error = await putDispatchScriptSecret(client, 'ns', 's', 'KEY', 'value').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareError);
    expect((error as CloudflareError).status).toBe(403);
    expect((error as CloudflareError).hasCode(10000)).toBe(true);
  });

  it('uploads scripts as multipart with metadata and typed modules', async () => {
    const { calls, fetchImpl } = mockFetch([ok({ id: 'p1-main' })]);
    const client = new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl });

    await putDispatchScript(
      client,
      'ns',
      'p1-main',
      { main_module: 'index.js', compatibility_date: '2026-10-01', keep_bindings: ['secret_text'] },
      [{ name: 'index.js', content: 'export default {}', type: 'application/javascript+module' }],
    );

    const form = calls[0]?.body as FormData;
    expect(calls[0]?.method).toBe('PUT');
    expect(JSON.parse(await (form.get('metadata') as Blob).text())).toMatchObject({ main_module: 'index.js' });
    const module = form.get('index.js') as File;
    expect(module.type).toBe('application/javascript+module');
    expect(await module.text()).toBe('export default {}');
  });

  it('retargets an existing route instead of creating a duplicate', async () => {
    const { calls, fetchImpl } = mockFetch([
      ok([{ id: 'r1', pattern: 'example.com/*', script: 'bohr-tunnel' }]),
      ok({ id: 'r1', pattern: 'example.com/*', script: 'bohr-dispatcher' }),
    ]);
    const client = new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl });

    const route = await upsertWorkerRoute(client, 'zone1', 'example.com/*', 'bohr-dispatcher');

    expect(route.script).toBe('bohr-dispatcher');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone1/workers/routes/r1');
  });

  it('finds the zone of a hostname by walking up its labels', async () => {
    const { calls, fetchImpl } = mockFetch([ok([]), ok([{ id: 'z1', name: 'example.com', status: 'active' }])]);
    const client = new CloudflareClient({ apiToken: 'token', accountId: 'acc', fetch: fetchImpl });

    const zone = await findZoneForHostname(client, 'www.example.com');

    expect(zone?.id).toBe('z1');
    expect(new URL(calls[0]?.url ?? '').searchParams.get('name')).toBe('www.example.com');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('name')).toBe('example.com');
  });
});
