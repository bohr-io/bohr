import { describe, expect, it } from 'vitest';
import { fromLambdaResult } from '../src/index';

describe('fromLambdaResult', () => {
  it('sends a structured response with its status, headers and string body', async () => {
    const response = fromLambdaResult({
      statusCode: 201,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Custom': 'value' },
      body: 'created',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-custom')).toBe('value');
    expect(await response.text()).toBe('created');
  });

  it('serializes an object body as JSON with a JSON content type', async () => {
    const response = fromLambdaResult({ statusCode: 200, body: { ok: true, items: [1, 2] } });

    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ ok: true, items: [1, 2] });
  });

  it('keeps the content type the handler set for an object body', async () => {
    const response = fromLambdaResult({
      statusCode: 200,
      headers: { 'content-type': 'application/vnd.api+json' },
      body: { data: [] },
    });

    expect(response.headers.get('content-type')).toBe('application/vnd.api+json');
    expect(await response.text()).toBe('{"data":[]}');
  });

  it('defaults the content type of a string body to application/json, as Function URLs do', async () => {
    const response = fromLambdaResult({ statusCode: 200, body: '{"a":1}' });

    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"a":1}');
  });

  it('sends a plain string result JSON-quoted with status 200, as Function URLs do', async () => {
    const response = fromLambdaResult('Hello, world!');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('"Hello, world!"');
  });

  it('sends an object without statusCode as the JSON body', async () => {
    const response = fromLambdaResult({ message: 'Hello', headers: { 'x-ignored': '1' }, body: 'not used' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.has('x-ignored')).toBe(false);
    expect(await response.json()).toEqual({ message: 'Hello', headers: { 'x-ignored': '1' }, body: 'not used' });
  });

  it.each([
    [undefined, 'null'],
    [null, 'null'],
    [42, '42'],
    [[1, 'two'], '[1,"two"]'],
  ])('sends the result %j as the JSON body %s', async (result, expected) => {
    const response = fromLambdaResult(result);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });

  it('decodes a base64 body into bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const response = fromLambdaResult({
      statusCode: 200,
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.from(png).toString('base64'),
      isBase64Encoded: true,
    });

    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it('only decodes when isBase64Encoded is exactly true', async () => {
    const response = fromLambdaResult({ statusCode: 200, body: 'aGk=', isBase64Encoded: 'true' });

    expect(await response.text()).toBe('aGk=');
  });

  it('merges multiValueHeaders and turns cookies into Set-Cookie headers', async () => {
    const response = fromLambdaResult({
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store', 'X-Values': 'replaced', 'Set-Cookie': 'a=1; Path=/' },
      multiValueHeaders: { 'X-Values': ['one', 'two'], Vary: ['Accept', 'Origin'] },
      cookies: ['b=2; HttpOnly', 'c=3; Max-Age=60'],
      body: 'ok',
    });

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-values')).toBe('one, two');
    expect(response.headers.get('vary')).toBe('Accept, Origin');
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; HttpOnly', 'c=3; Max-Age=60']);
    expect(await response.text()).toBe('ok');
  });

  it('stringifies header values and skips null ones', () => {
    const response = fromLambdaResult({
      statusCode: 200,
      headers: { 'X-Count': 5, 'X-Flag': true, 'X-Null': null, 'X-Undefined': undefined, 'X-List': ['a', 'b'] },
    });

    expect(response.headers.get('x-count')).toBe('5');
    expect(response.headers.get('x-flag')).toBe('true');
    expect(response.headers.has('x-null')).toBe(false);
    expect(response.headers.has('x-undefined')).toBe(false);
    expect(response.headers.get('x-list')).toBe('a, b');
  });

  it('drops framing headers the runtime sets itself', () => {
    const response = fromLambdaResult({
      statusCode: 200,
      headers: {
        'Content-Length': '999',
        'Transfer-Encoding': 'chunked',
        Connection: 'close',
        'Keep-Alive': 'timeout=5',
      },
      body: 'abc',
    });

    for (const name of ['content-length', 'transfer-encoding', 'connection', 'keep-alive']) {
      expect(response.headers.has(name)).toBe(false);
    }
  });

  it('sends no body and no content type when the result has no body', async () => {
    const response = fromLambdaResult({ statusCode: 302, headers: { Location: '/login' } });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.has('content-type')).toBe(false);
    expect(response.body).toBeNull();
  });

  it.each([204, 205, 304])('drops the body of a %i response', async (statusCode) => {
    const response = fromLambdaResult({ statusCode, body: 'ignored' });

    expect(response.status).toBe(statusCode);
    expect(response.body).toBeNull();
  });

  it('accepts a numeric string statusCode', () => {
    expect(fromLambdaResult({ statusCode: '404', body: 'missing' }).status).toBe(404);
  });

  it.each([99, 100, 199, 600, 200.5, 'abc', true, {}])('rejects the statusCode %j', (statusCode) => {
    expect(() => fromLambdaResult({ statusCode })).toThrow(TypeError);
  });

  it('rejects a body that is not valid base64', () => {
    expect(() => fromLambdaResult({ statusCode: 200, body: '%%%', isBase64Encoded: true })).toThrow();
  });
});
