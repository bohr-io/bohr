import { afterEach, describe, expect, it, vi } from 'vitest';
import { toLambdaEvent } from '../src/index';

afterEach(() => {
  vi.useRealTimers();
});

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

describe('toLambdaEvent', () => {
  it('maps a GET with repeated query keys and cookies to a payload 2.0 event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2021-09-07T22:50:22.677Z'));
    const request = new Request('https://shop.example.com/api/items?tag=a&tag=b&page=2&q=hello%20world', {
      headers: {
        'User-Agent': 'test-agent/1.0',
        'CF-Connecting-IP': '203.0.113.7',
        Cookie: 'session=abc; theme=dark',
        'X-Custom': 'yes',
      },
    });

    const event = await toLambdaEvent(request, { requestId: 'req-1' });

    expect(event).toStrictEqual({
      version: '2.0',
      routeKey: '$default',
      rawPath: '/api/items',
      rawQueryString: 'tag=a&tag=b&page=2&q=hello%20world',
      cookies: ['session=abc', 'theme=dark'],
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'test-agent/1.0',
        'x-custom': 'yes',
        host: 'shop.example.com',
        'x-forwarded-for': '203.0.113.7',
        'x-forwarded-port': '443',
        'x-forwarded-proto': 'https',
      },
      queryStringParameters: { tag: 'a,b', page: '2', q: 'hello world' },
      requestContext: {
        accountId: 'anonymous',
        apiId: 'shop',
        domainName: 'shop.example.com',
        domainPrefix: 'shop',
        http: {
          method: 'GET',
          path: '/api/items',
          protocol: 'HTTP/1.1',
          sourceIp: '203.0.113.7',
          userAgent: 'test-agent/1.0',
        },
        requestId: 'req-1',
        routeKey: '$default',
        stage: '$default',
        time: '07/Sep/2021:22:50:22 +0000',
        timeEpoch: 1631055022677,
      },
      pathParameters: undefined,
      isBase64Encoded: false,
      stageVariables: undefined,
    });
  });

  it('pads the request time and uses English month names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T03:04:05.006Z'));

    const event = await toLambdaEvent(new Request('https://example.com/'));

    expect(event.requestContext.time).toBe('02/Jan/2026:03:04:05 +0000');
    expect(event.requestContext.timeEpoch).toBe(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
  });

  it('omits cookies, query parameters and body when the request has none', async () => {
    const event = await toLambdaEvent(new Request('https://example.com/health'));

    expect(event).not.toHaveProperty('cookies');
    expect(event).not.toHaveProperty('queryStringParameters');
    expect(event).not.toHaveProperty('body');
    expect(event.isBase64Encoded).toBe(false);
    expect(event.rawQueryString).toBe('');
    expect(event.requestContext.http.sourceIp).toBe('');
    expect(event.requestContext.http.userAgent).toBe('');
    expect(event.headers).not.toHaveProperty('x-forwarded-for');
  });

  it('generates a UUID request id by default', async () => {
    const event = await toLambdaEvent(new Request('https://example.com/'));

    expect(event.requestContext.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('lowercases header names, joins repeated headers and keeps cookies out of headers', async () => {
    const request = new Request('https://example.com/', {
      headers: [
        ['X-Multi', 'a'],
        ['x-multi', 'b'],
        ['Cookie', 'a=1'],
      ],
    });

    const event = await toLambdaEvent(request);

    // Fetch joins repeated headers with ", " before the Worker sees them.
    expect(event.headers['x-multi']).toBe('a, b');
    expect(event.headers).not.toHaveProperty('cookie');
    expect(event.cookies).toEqual(['a=1']);
  });

  it('keeps forwarding headers the client already sent', async () => {
    const request = new Request('https://example.com/', {
      headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '198.51.100.1', Host: 'public.example.com' },
    });

    const event = await toLambdaEvent(request);

    expect(event.headers['x-forwarded-for']).toBe('198.51.100.1');
    expect(event.headers.host).toBe('public.example.com');
    expect(event.requestContext.http.sourceIp).toBe('203.0.113.7');
  });

  it('describes plain HTTP URLs with an explicit port', async () => {
    const event = await toLambdaEvent(new Request('http://localhost:8787/x'));

    expect(event.headers).toMatchObject({
      host: 'localhost:8787',
      'x-forwarded-port': '8787',
      'x-forwarded-proto': 'http',
    });
    expect(event.requestContext.domainName).toBe('localhost');
    expect(event.requestContext.domainPrefix).toBe('localhost');
  });

  it('passes a JSON body as text', async () => {
    const payload = JSON.stringify({ name: 'Ada', emoji: '🚀' });
    const request = new Request('https://example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: payload,
    });

    const event = await toLambdaEvent(request);

    expect(event.requestContext.http.method).toBe('POST');
    expect(event.body).toBe(payload);
    expect(event.isBase64Encoded).toBe(false);
  });

  it.each([
    'text/plain',
    'text/csv; charset=utf-8',
    'application/xml',
    'application/javascript',
    'application/vnd.api+json',
    'image/svg+xml',
  ])('passes %s bodies as text', async (contentType) => {
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: 'plain text',
    });

    const event = await toLambdaEvent(request);

    expect(event.body).toBe('plain text');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('base64-encodes a binary upload', async () => {
    const upload = bytes(0, 1, 2, 127, 128, 253, 254, 255);
    const request = new Request('https://example.com/upload', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: upload,
    });

    const event = await toLambdaEvent(request);

    expect(event.isBase64Encoded).toBe(true);
    expect(event.body).toBe(Buffer.from(upload).toString('base64'));
  });

  it.each([
    ['a form post', 'application/x-www-form-urlencoded'],
    ['a multipart post', 'multipart/form-data; boundary=x'],
  ])('base64-encodes %s, as Function URLs do', async (_name, contentType) => {
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: 'name=Ada&lang=en',
    });

    const event = await toLambdaEvent(request);

    expect(event.isBase64Encoded).toBe(true);
    expect(Buffer.from(event.body ?? '', 'base64').toString()).toBe('name=Ada&lang=en');
  });

  it('base64-encodes a body without a content type', async () => {
    const event = await toLambdaEvent(new Request('https://example.com/', { method: 'POST', body: bytes(104, 105) }));

    expect(event.isBase64Encoded).toBe(true);
    expect(event.body).toBe('aGk=');
  });

  it('base64-encodes a text body that is not valid UTF-8 instead of corrupting it', async () => {
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=latin1' },
      body: bytes(0x63, 0x61, 0x66, 0xe9),
    });

    const event = await toLambdaEvent(request);

    expect(event.isBase64Encoded).toBe(true);
    expect(Buffer.from(event.body ?? '', 'base64')).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  });

  it('omits the body of a POST with an empty body', async () => {
    const event = await toLambdaEvent(new Request('https://example.com/', { method: 'POST', body: '' }));

    expect(event).not.toHaveProperty('body');
    expect(event.isBase64Encoded).toBe(false);
  });

  it.each([
    ['/api/users', '/users'],
    ['/api', '/'],
    ['/api/', '/'],
    ['/api/api/x', '/api/x'],
    ['/apix', '/apix'],
    ['/v1/api/x', '/v1/api/x'],
    ['/', '/'],
  ])('strips the prefix once from the start of %s', async (path, expected) => {
    const event = await toLambdaEvent(new Request(`https://example.com${path}?a=1`), { stripPrefix: '/api' });

    expect(event.rawPath).toBe(expected);
    expect(event.requestContext.http.path).toBe(expected);
    expect(event.rawQueryString).toBe('a=1');
  });

  it.each(['api', '/api/', 'api/'])('normalizes the prefix %s to /api', async (stripPrefix) => {
    const event = await toLambdaEvent(new Request('https://example.com/api/x'), { stripPrefix });

    expect(event.rawPath).toBe('/x');
  });

  it('ignores an empty or root prefix', async () => {
    const request = () => new Request('https://example.com/api/x');

    expect((await toLambdaEvent(request(), { stripPrefix: '' })).rawPath).toBe('/api/x');
    expect((await toLambdaEvent(request(), { stripPrefix: '/' })).rawPath).toBe('/api/x');
  });

  it('keeps a "__proto__" query key as an ordinary parameter', async () => {
    const event = await toLambdaEvent(new Request('https://example.com/?__proto__=x&a=1'));

    expect(Object.getPrototypeOf(event.queryStringParameters)).toBe(Object.prototype);
    expect(Object.hasOwn(event.queryStringParameters ?? {}, '__proto__')).toBe(true);
    expect(event.queryStringParameters?.a).toBe('1');
  });
});
