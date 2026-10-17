import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLambdaWorker, type LambdaContext, type LambdaFunctionUrlEvent, type LambdaHandler } from '../src/index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERIC_ERROR = '{"message":"Internal Server Error"}';

const isApi = (url: URL) => url.pathname === '/api' || url.pathname.startsWith('/api/');
const request = (path = '/', init?: RequestInit) => new Request(`https://example.com${path}`, init);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createLambdaWorker', () => {
  it('runs an async handler for a JSON POST', async () => {
    const worker = createLambdaWorker(async (event) => {
      const input = JSON.parse(event.body ?? '{}') as { name: string };
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ greeting: `Hello, ${input.name}`, method: event.requestContext.http.method }),
      };
    });

    const response = await worker.fetch(
      request('/greet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ada' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ greeting: 'Hello, Ada', method: 'POST' });
  });

  it('round-trips a binary upload and a binary response', async () => {
    const flags: boolean[] = [];
    const worker = createLambdaWorker(async (event) => {
      flags.push(event.isBase64Encoded);
      const reversed = Buffer.from(event.body ?? '', 'base64').reverse();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: reversed.toString('base64'),
        isBase64Encoded: true,
      };
    });
    const upload = Uint8Array.from({ length: 256 }, (_, index) => index);

    const response = await worker.fetch(
      request('/reverse', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: upload }),
    );

    expect(flags).toEqual([true]);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(upload.slice().reverse());
  });

  it('returns string and object bodies', async () => {
    const shorthand = createLambdaWorker(async () => 'pong');
    const objectBody = createLambdaWorker(async () => ({ statusCode: 200, body: { pong: true } }));

    const quoted = await shorthand.fetch(request('/ping'));
    const json = await objectBody.fetch(request('/ping'));

    expect(quoted.headers.get('content-type')).toBe('application/json');
    expect(await quoted.text()).toBe('"pong"');
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(await json.json()).toEqual({ pong: true });
  });

  it('answers 200 with a JSON null when an async handler returns nothing', async () => {
    const worker = createLambdaWorker(async () => undefined);

    const response = await worker.fetch(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('null');
  });

  it('sends multiValueHeaders and cookies', async () => {
    const worker = createLambdaWorker(async () => ({
      statusCode: 200,
      multiValueHeaders: { 'X-Tag': ['a', 'b'] },
      cookies: ['session=1; HttpOnly; Secure', 'theme=dark; Path=/'],
      body: 'ok',
    }));

    const response = await worker.fetch(request());

    expect(response.headers.get('x-tag')).toBe('a, b');
    expect(response.headers.getSetCookie()).toEqual(['session=1; HttpOnly; Secure', 'theme=dark; Path=/']);
  });

  it('supports callback-style handlers', async () => {
    const worker = createLambdaWorker((event, _context, callback) => {
      setTimeout(() => callback(null, { statusCode: 200, body: `callback ${event.rawPath}` }), 1);
    });

    const response = await worker.fetch(request('/legacy'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('callback /legacy');
  });

  it('ignores the synchronous return value of a callback-style handler, as the Node.js runtime does', async () => {
    const worker = createLambdaWorker((_event, _context, callback) => {
      queueMicrotask(() => callback(null, { statusCode: 200, body: 'from callback' }));
      return { statusCode: 500, body: 'ignored' };
    });

    expect(await (await worker.fetch(request())).text()).toBe('from callback');
  });

  it('settles with the first completion', async () => {
    const worker = createLambdaWorker(async (_event, context, callback) => {
      callback(null, { statusCode: 200, body: 'first' });
      context.succeed({ statusCode: 201, body: 'second' });
      return { statusCode: 202, body: 'third' };
    });

    const response = await worker.fetch(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('first');
  });

  it('supports context.succeed, context.done and context.fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const succeed = createLambdaWorker((_event, context) => context.succeed({ statusCode: 202, body: 'accepted' }));
    const done = createLambdaWorker((_event, context) => context.done(null, { statusCode: 200, body: 'done' }));
    const fail = createLambdaWorker((_event, context) => context.fail(new Error('nope')));

    expect((await succeed.fetch(request())).status).toBe(202);
    expect(await (await done.fetch(request())).text()).toBe('done');
    expect((await fail.fetch(request())).status).toBe(502);
  });

  it('returns a generic 502 when the handler throws, and logs the error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('connection string postgres://admin:hunter2@db');
    const worker = createLambdaWorker(async () => {
      throw error;
    });

    const response = await worker.fetch(request('/boom?token=abc'));

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe(GENERIC_ERROR);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('GET /boom failed'), error);
    expect(consoleError.mock.calls[0]?.[0]).not.toContain('token=abc');
  });

  it.each<[string, LambdaHandler]>([
    [
      'it throws synchronously',
      () => {
        throw new Error('sync');
      },
    ],
    ['it rejects without a reason', () => Promise.reject()],
    ['it passes an error to the callback', (_event, _context, callback) => callback(new Error('callback'))],
    ['it returns an invalid statusCode', async () => ({ statusCode: 'abc' })],
    ['it returns a body that is not base64', async () => ({ statusCode: 200, body: '%%%', isBase64Encoded: true })],
  ])('returns a generic 502 when %s', async (_name, handler) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await createLambdaWorker(handler).fetch(request());

    expect(response.status).toBe(502);
    expect(await response.text()).toBe(GENERIC_ERROR);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('provides a Lambda-like context', async () => {
    const calls: { event: LambdaFunctionUrlEvent; context: LambdaContext }[] = [];
    const worker = createLambdaWorker(
      async (event, context) => {
        calls.push({ event, context });
        return { statusCode: 204 };
      },
      { functionName: 'orders-api', timeoutMs: 10_000 },
    );

    await worker.fetch(request());
    await worker.fetch(request());
    const [first, second] = calls;

    expect(first?.context).toMatchObject({
      functionName: 'orders-api',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:auto:000000000000:function:orders-api',
      memoryLimitInMB: '128',
      logGroupName: '/aws/lambda/orders-api',
      callbackWaitsForEmptyEventLoop: true,
    });
    expect(first?.context.awsRequestId).toMatch(UUID);
    expect(first?.context.awsRequestId).toBe(first?.event.requestContext.requestId);
    expect(second?.context.awsRequestId).not.toBe(first?.context.awsRequestId);
    expect(first?.context.logStreamName).toMatch(/^\d{4}\/\d{2}\/\d{2}\/\[\$LATEST\][0-9a-f]{32}$/);
    expect(second?.context.logStreamName).toBe(first?.context.logStreamName);
    expect(first?.context.getRemainingTimeInMillis()).toBeGreaterThan(0);
    expect(first?.context.getRemainingTimeInMillis()).toBeLessThanOrEqual(10_000);
  });

  it('names the function "bohr-function" by default', async () => {
    const names: string[] = [];
    const worker = createLambdaWorker(async (_event, context) => {
      names.push(context.functionName);
      return { statusCode: 204 };
    });

    await worker.fetch(request());

    expect(names).toEqual(['bohr-function']);
  });

  it('counts getRemainingTimeInMillis down from timeoutMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const readings: number[] = [];
    const worker = createLambdaWorker(
      async (_event, context) => {
        readings.push(context.getRemainingTimeInMillis());
        vi.setSystemTime(Date.now() + 2_000);
        readings.push(context.getRemainingTimeInMillis());
        vi.setSystemTime(Date.now() + 10_000);
        readings.push(context.getRemainingTimeInMillis());
        return { statusCode: 204 };
      },
      { timeoutMs: 5_000 },
    );

    await worker.fetch(request());

    expect(readings).toEqual([5_000, 3_000, 0]);
  });

  it('strips the prefix once before the handler sees the path', async () => {
    const paths: string[] = [];
    const worker = createLambdaWorker(
      async (event) => {
        paths.push(event.rawPath);
        return { statusCode: 204 };
      },
      { stripPrefix: '/api' },
    );

    for (const path of ['/api/api/x', '/apix', '/api', '/api/users/1']) {
      await worker.fetch(request(path));
    }

    expect(paths).toEqual(['/api/x', '/apix', '/', '/users/1']);
  });

  it('sends requests that do not match to the ASSETS binding', async () => {
    const assets = { fetch: vi.fn(async (asset: Request) => new Response(`asset ${new URL(asset.url).pathname}`)) };
    const handler = vi.fn(async (event: LambdaFunctionUrlEvent) => ({ statusCode: 200, body: `api ${event.rawPath}` }));
    const worker = createLambdaWorker(handler, { match: isApi, stripPrefix: '/api' });
    const env = { ASSETS: assets };
    const page = request('/about');

    const pageResponse = await worker.fetch(page, env);
    const apixResponse = await worker.fetch(request('/apix'), env);
    const apiResponse = await worker.fetch(request('/api/users'), env);
    const rootResponse = await worker.fetch(request('/api'), env);

    expect(assets.fetch).toHaveBeenCalledTimes(2);
    expect(assets.fetch).toHaveBeenNthCalledWith(1, page);
    expect(await pageResponse.text()).toBe('asset /about');
    expect(await apixResponse.text()).toBe('asset /apix');
    expect(await apiResponse.text()).toBe('api /users');
    expect(await rootResponse.text()).toBe('api /');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('answers 404 to requests that do not match when there is no ASSETS binding', async () => {
    const handler = vi.fn(async () => ({ statusCode: 200 }));
    const worker = createLambdaWorker(handler, { match: isApi });

    expect((await worker.fetch(request('/about'), {})).status).toBe(404);
    expect((await worker.fetch(request('/about'))).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it('sends every request to the handler by default', async () => {
    const assets = { fetch: vi.fn(async () => new Response('asset')) };
    const worker = createLambdaWorker(async (event) => ({ statusCode: 200, body: event.rawPath }));

    const response = await worker.fetch(request('/any/page.html'), { ASSETS: assets });

    expect(await response.text()).toBe('/any/page.html');
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('rejects a handler that is not a function', () => {
    expect(() => createLambdaWorker(undefined as unknown as LambdaHandler)).toThrow(TypeError);
  });
});

describe('cors: "v1"', () => {
  const echo = vi.fn(async (event: LambdaFunctionUrlEvent) => ({
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'X-Method': event.requestContext.http.method },
    body: 'ok',
  }));
  const worker = createLambdaWorker(echo, { cors: 'v1', match: isApi, stripPrefix: '/api' });

  afterEach(() => echo.mockClear());

  it('answers preflights from https origins without calling the handler', async () => {
    const response = await worker.fetch(
      request('/api/items', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.org',
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type, x-token',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(echo).not.toHaveBeenCalled();
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'access-control-allow-origin': 'https://app.example.org',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'PUT',
      'access-control-allow-headers': 'content-type, x-token',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
  });

  it('replaces the CORS headers the handler sets and keeps the others', async () => {
    const response = await worker.fetch(request('/api/items', { headers: { Origin: 'https://app.example.org' } }));

    expect(await response.text()).toBe('ok');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.org');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('x-method')).toBe('GET');
  });

  it('leaves requests from other origins, and without one, to the handler', async () => {
    const insecure = await worker.fetch(
      request('/api/items', {
        method: 'OPTIONS',
        headers: { Origin: 'http://app.example.org', 'Access-Control-Request-Method': 'PUT' },
      }),
    );
    const noOrigin = await worker.fetch(request('/api/items'));

    expect(echo).toHaveBeenCalledTimes(2);
    expect(insecure.headers.get('x-method')).toBe('OPTIONS');
    expect(insecure.headers.get('access-control-allow-origin')).toBe('*');
    expect(noOrigin.headers.get('access-control-allow-origin')).toBe('*');
    expect(noOrigin.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('passes a plain OPTIONS request, without Access-Control-Request-Method, to the handler', async () => {
    const response = await worker.fetch(
      request('/api/items', { method: 'OPTIONS', headers: { Origin: 'https://app.example.org' } }),
    );

    expect(echo).toHaveBeenCalledOnce();
    expect(response.headers.get('x-method')).toBe('OPTIONS');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.org');
  });

  it('adds CORS headers to the generic error response', async () => {
    const failing = createLambdaWorker(
      async () => {
        throw new Error('boom');
      },
      { cors: 'v1' },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await failing.fetch(request('/', { headers: { Origin: 'https://app.example.org' } }));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe(GENERIC_ERROR);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.org');
  });

  it('is off by default', async () => {
    const plain = createLambdaWorker(echo);

    const response = await plain.fetch(
      request('/', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.org', 'Access-Control-Request-Method': 'PUT' },
      }),
    );

    expect(echo).toHaveBeenCalledOnce();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('process.env population', () => {
  const STRING = 'LAMBDA_ADAPTER_TEST_STRING';
  const NUMBER = 'LAMBDA_ADAPTER_TEST_NUMBER';
  const OBJECT = 'LAMBDA_ADAPTER_TEST_OBJECT';

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of [STRING, NUMBER, OBJECT]) delete process.env[name];
  });

  it('copies string bindings into process.env once, before the handler runs', async () => {
    const seen: (string | undefined)[] = [];
    const worker = createLambdaWorker(async () => {
      seen.push(process.env[STRING]);
      return { statusCode: 204 };
    });

    await worker.fetch(request(), {
      [STRING]: 'secret-value',
      [NUMBER]: 42,
      [OBJECT]: { nested: true },
      ASSETS: { fetch: async () => new Response('') },
    });
    process.env[STRING] = 'changed at runtime';
    await worker.fetch(request(), { [STRING]: 'secret-value' });

    expect(seen).toEqual(['secret-value', 'changed at runtime']);
    expect(process.env[NUMBER]).toBeUndefined();
    expect(process.env[OBJECT]).toBeUndefined();
  });

  it('leaves process.env alone when populateProcessEnv is false', async () => {
    const worker = createLambdaWorker(async () => ({ statusCode: 204 }), { populateProcessEnv: false });

    await worker.fetch(request(), { [STRING]: 'secret-value' });

    expect(process.env[STRING]).toBeUndefined();
  });

  it('works without a global process object', async () => {
    const worker = createLambdaWorker(async () => ({ statusCode: 200, body: 'ok' }));

    // Only the synchronous start of fetch, where the copy happens, runs without process.
    vi.stubGlobal('process', undefined);
    const pending = worker.fetch(request(), { [STRING]: 'secret-value' });
    vi.unstubAllGlobals();

    expect(await (await pending).text()).toBe('ok');
    expect(process.env[STRING]).toBeUndefined();
  });
});

describe('a lambda-api style handler', () => {
  interface ApiRequest {
    params: Record<string, string>;
    query: Record<string, string>;
    body: unknown;
    ip: string;
    cookies: Record<string, string>;
    id: string;
  }
  type Route = (req: ApiRequest) => { status: number; body: unknown; cookies?: string[] };

  // A tiny router that reads payload 2.0 events the way lambda-api does.
  function createApi() {
    const routes: { method: string; pattern: RegExp; keys: string[]; route: Route }[] = [];
    const add = (method: string) => (path: string, route: Route) => {
      const keys: string[] = [];
      const source = path.replace(/:(\w+)/g, (_match, key: string) => {
        keys.push(key);
        return '([^/]+)';
      });
      routes.push({ method, pattern: new RegExp(`^${source}$`), keys, route });
    };
    const respond = (statusCode: number, payload: unknown, cookies: string[] = []) => ({
      statusCode,
      headers: { 'content-type': 'application/json' },
      cookies,
      body: JSON.stringify(payload),
      isBase64Encoded: false,
    });

    return {
      get: add('GET'),
      post: add('POST'),
      async run(event: LambdaFunctionUrlEvent, context: LambdaContext) {
        const legacy = event as LambdaFunctionUrlEvent & { httpMethod?: string; path?: string };
        const method = (legacy.httpMethod ?? event.requestContext.http.method).toUpperCase();
        const path = event.version === '2.0' ? event.rawPath : (legacy.path ?? '/');
        const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body;
        const isJson = event.headers['content-type']?.includes('application/json') ?? false;

        const candidates = routes.filter((entry) => entry.pattern.test(path));
        const match = candidates.find((entry) => entry.method === method);
        if (!match) {
          return candidates.length > 0
            ? respond(405, { error: 'Method not allowed' })
            : respond(404, { error: 'Not found' });
        }
        const values = path.match(match.pattern)?.slice(1) ?? [];
        const result = match.route({
          params: Object.fromEntries(match.keys.map((key, index) => [key, values[index] ?? ''])),
          query: { ...event.queryStringParameters },
          body: isJson && rawBody ? JSON.parse(rawBody) : rawBody,
          ip: event.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '',
          cookies: Object.fromEntries((event.cookies ?? []).map((cookie) => cookie.split('=', 2))),
          id: context.awsRequestId,
        });
        return respond(result.status, result.body, result.cookies);
      },
    };
  }

  const api = createApi();
  api.get('/users/:id', (req) => ({
    status: 200,
    body: { id: req.params.id, fields: req.query.fields, ip: req.ip, theme: req.cookies.theme, requestId: req.id },
  }));
  api.post('/users', (req) => ({
    status: 201,
    body: { created: (req.body as { name: string }).name },
    cookies: ['last_user=Ada; Path=/'],
  }));
  const worker = createLambdaWorker(async (event, context) => api.run(event, context), {
    match: isApi,
    stripPrefix: '/api',
  });

  it('routes on requestContext.http.method and rawPath', async () => {
    const response = await worker.fetch(
      request('/api/users/42?fields=name', { headers: { 'CF-Connecting-IP': '203.0.113.9', Cookie: 'theme=dark' } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: '42',
      fields: 'name',
      ip: '203.0.113.9',
      theme: 'dark',
      requestId: expect.stringMatching(UUID),
    });
  });

  it('parses JSON bodies and sets cookies', async () => {
    const response = await worker.fetch(
      request('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ada' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: 'Ada' });
    expect(response.headers.getSetCookie()).toEqual(['last_user=Ada; Path=/']);
  });

  it("returns the router's 404 and 405 responses", async () => {
    expect((await worker.fetch(request('/api/orders'))).status).toBe(404);
    expect((await worker.fetch(request('/api/users/42', { method: 'DELETE' }))).status).toBe(405);
  });
});
