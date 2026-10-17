import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth';
import type { BasicAuthUser } from '../src/routes';
import {
  basicHeader,
  call,
  echo,
  expectSecurityHeaders,
  fakeDispatcher,
  makeEnv,
  putRoute,
  recordingKv,
  route,
  SCRIPT,
  uniqueLabel,
} from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('routing', () => {
  it('dispatches an exact hostname match to its script with the original request', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route());
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });

    const response = await call(makeEnv(dispatcher), `https://${host}/hello?x=1`, {
      method: 'POST',
      headers: { 'X-Visitor': 'yes' },
      body: 'payload',
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`${SCRIPT} POST /hello?x=1`);
    expect(dispatcher.calls).toHaveLength(1);
    const forwarded = dispatcher.calls[0]?.request;
    expect(forwarded?.url).toBe(`https://${host}/hello?x=1`);
    expect(forwarded?.headers.get('X-Visitor')).toBe('yes');
    expect(await forwarded?.text()).toBe('payload');
  });

  it('falls back to wildcard records, the most specific one first', async () => {
    const tld = uniqueLabel();
    await putRoute(`*.b.example.co.${tld}`, route({ script: 'p-b' }));
    await putRoute(`*.example.co.${tld}`, route({ script: 'p-example' }));
    await putRoute(`*.co.${tld}`, route({ script: 'p-co' }));
    await putRoute(`exact.example.co.${tld}`, route({ script: 'p-exact' }));
    const env = makeEnv(
      fakeDispatcher({
        'p-b': echo('p-b'),
        'p-example': echo('p-example'),
        'p-co': echo('p-co'),
        'p-exact': echo('p-exact'),
      }),
    );

    const servedBy = async (host: string) => (await (await call(env, `https://${host}/`)).text()).split(' ')[0];
    expect(await servedBy(`a.b.example.co.${tld}`)).toBe('p-b');
    expect(await servedBy(`c.example.co.${tld}`)).toBe('p-example');
    expect(await servedBy(`d.other.co.${tld}`)).toBe('p-co');
    expect(await servedBy(`exact.example.co.${tld}`)).toBe('p-exact');
  });

  it('reads the exact key, then wildcards down to two labels, never a single-label wildcard', async () => {
    const tld = uniqueLabel();
    await putRoute(`*.${tld}`, route());
    const { kv, reads } = recordingKv();
    const env = makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) }), kv);

    expect((await call(env, `https://a.b.example.co.${tld}/`)).status).toBe(404);
    expect(reads).toEqual([`a.b.example.co.${tld}`, `*.b.example.co.${tld}`, `*.example.co.${tld}`, `*.co.${tld}`]);

    reads.length = 0;
    expect((await call(env, `https://example.${tld}/`)).status).toBe(404);
    expect(reads).toEqual([`example.${tld}`]);
  });

  it('stops at the exact key when it exists', async () => {
    const host = `${uniqueLabel()}.example.com`;
    await putRoute(host, route());
    const { kv, reads } = recordingKv();
    const response = await call(makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) }), kv), `https://${host}/`);
    expect(response.status).toBe(200);
    expect(reads).toEqual([host]);
  });

  it('redirects an unknown www hostname to the bare domain, keeping path and query', async () => {
    const domain = `${uniqueLabel()}.example`;
    const response = await call(makeEnv(fakeDispatcher()), `https://www.${domain}/a/b?x=1&y=two`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(`https://${domain}/a/b?x=1&y=two`);
    expectSecurityHeaders(response);
  });

  it('serves a www hostname from a matching wildcard instead of redirecting', async () => {
    const domain = `${uniqueLabel()}.example`;
    await putRoute(`*.${domain}`, route());
    const response = await call(makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) })), `https://www.${domain}/`);
    expect(response.status).toBe(200);
  });

  it('answers the 404 page for unknown hostnames', async () => {
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });
    const response = await call(makeEnv(dispatcher), `https://${uniqueLabel()}.example.com/anything`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html).toContain('Site not found');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('#180B02');
    expect(html).toContain('radial-gradient(50vw 50vw at center 800px, #E8485533 0%, #0E171D33 50vw)');
    expect(html).toContain('linear-gradient(180deg, #F26419 0%, #E84855 100%)');
    expect(html.match(/href="[^"]*"/g)).toEqual(['href="https://bohr.io"']);
    expectSecurityHeaders(response);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('redirects a project that moved to its owner account, keeping path and query', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ movedTo: 'https://store.example.com' }));
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });

    const response = await call(makeEnv(dispatcher), `https://${host}/products?page=2`);

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://store.example.com/products?page=2');
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("passes requests on to the owner's Worker when the hostname's zone stayed with bohr", async () => {
    const host = `${uniqueLabel()}.example.com`;
    await putRoute(host, route({ proxyTo: 'https://api.ana.workers.dev' }));
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });
    const seen: { url: string; method: string; body: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({
        url: request.url,
        method: request.method,
        body: await request.text(),
        auth: request.headers.get('Authorization'),
      });
      return new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const response = await call(makeEnv(dispatcher), `https://${host}/api/login?x=1`, {
        method: 'POST',
        headers: { Authorization: 'Basic YTpi', 'Content-Type': 'application/json' },
        body: '{"USUARIO":"ana"}',
      });
      expect(response.status).toBe(201);
      expect(await response.text()).toBe('{"ok":true}');
      expectSecurityHeaders(response);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([
      {
        url: 'https://api.ana.workers.dev/api/login?x=1',
        method: 'POST',
        body: '{"USUARIO":"ana"}',
        auth: 'Basic YTpi',
      },
    ]);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('never serves .git or .env files, whatever the case or encoding', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route());
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });

    for (const path of [
      '/.git/HEAD',
      '/.GIT/config',
      '/%2egit/HEAD',
      '/a/.git/objects/x',
      '/%2Egit%2Fconfig',
      '/.env',
      '/.ENV.production',
      '/api/.env.local',
      '/%2eenv',
    ]) {
      const response = await call(makeEnv(dispatcher), `https://${host}${path}`);
      expect(response.status, path).toBe(404);
    }
    expect(dispatcher.calls).toHaveLength(0);

    const allowed = await call(makeEnv(dispatcher), `https://${host}/.gitignore`);
    expect((await call(makeEnv(dispatcher), `https://${host}/.environment.js`)).status).toBe(200);
    expect(allowed.status).toBe(200);
  });

  it('answers 503 without calling the customer Worker when suspended', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ suspended: true, headers: { 'X-Robots-Tag': 'noindex' } }));
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });

    const response = await call(makeEnv(dispatcher), `https://${host}/`);

    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Site suspended');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expectSecurityHeaders(response);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('answers 404 when the script is missing from the namespace', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ script: 'p3k9x0a7qd2m-gone', headers: { 'X-Custom': '1' } }));

    const response = await call(makeEnv(fakeDispatcher()), `https://${host}/`);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Site not found');
    expect(response.headers.get('X-Custom')).toBe('1');
    expectSecurityHeaders(response);
  });

  it('answers 404 when the fetch itself rejects with "Worker not found"', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route());
    const dispatcher = fakeDispatcher({
      [SCRIPT]: () => {
        throw new Error('Worker not found.');
      },
    });
    expect((await call(makeEnv(dispatcher), `https://${host}/`)).status).toBe(404);
  });

  it('answers 502 and logs when the customer Worker throws, without leaking details', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route());
    const error = new Error('database password is hunter2');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispatcher = fakeDispatcher({
      [SCRIPT]: () => {
        throw error;
      },
    });

    const response = await call(makeEnv(dispatcher), `https://${host}/`);

    expect(response.status).toBe(502);
    const html = await response.text();
    expect(html).toContain('Something went wrong');
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('Error');
    expect(html).not.toMatch(/\bat\s+\S+\s*\(/);
    expectSecurityHeaders(response);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toContain(error);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['an unknown version', JSON.stringify({ ...route(), v: 2 })],
    ['an unknown auth type', JSON.stringify(route({ auth: { type: 'oauth' } as never }))],
  ])('fails closed with 502 for a record with %s', async (_name, value) => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, value);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });

    const response = await call(makeEnv(dispatcher), `https://${host}/`);

    expect(response.status).toBe(502);
    expectSecurityHeaders(response);
    expect(dispatcher.calls).toHaveLength(0);
  });
});

describe('response headers', () => {
  it('adds the security headers and then the record headers to customer responses', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(
      host,
      route({
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Site': 'acme' },
      }),
    );
    const dispatcher = fakeDispatcher({
      [SCRIPT]: () =>
        new Response('created', {
          status: 201,
          headers: {
            'Content-Type': 'text/plain',
            'Cross-Origin-Opener-Policy': 'unsafe-none',
            'Strict-Transport-Security': 'max-age=0',
            'X-From': 'customer',
          },
        }),
    });

    const response = await call(makeEnv(dispatcher), `https://${host}/`);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('created');
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('X-From')).toBe('customer');
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('X-Site')).toBe('acme');
    expectSecurityHeaders(response);
  });

  it('re-wraps customer responses whose headers are immutable', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ headers: { 'X-Site': 'acme' } }));
    const dispatcher = fakeDispatcher({ [SCRIPT]: () => Response.redirect('https://elsewhere.example/', 302) });

    const response = await call(makeEnv(dispatcher), `https://${host}/`);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://elsewhere.example/');
    expect(response.headers.get('X-Site')).toBe('acme');
    expectSecurityHeaders(response);
  });
});

describe('basic auth', () => {
  let users: BasicAuthUser[];

  beforeAll(async () => {
    users = [
      { username: 'client', ...(await hashPassword('correct horse')) },
      { username: 'josé', ...(await hashPassword('pässwörd ✓')) },
    ];
  });

  async function protectedSite(bypassPaths?: string[]) {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ auth: { type: 'basic', users, bypassPaths }, headers: { 'X-Site': 'acme' } }));
    const dispatcher = fakeDispatcher({ [SCRIPT]: echo(SCRIPT) });
    return { host, dispatcher, env: makeEnv(dispatcher) };
  }

  it('asks for credentials when none are sent', async () => {
    const { host, dispatcher, env } = await protectedSite();

    const response = await call(env, `https://${host}/`);

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(`Basic realm="${host}", charset="UTF-8"`);
    expect(response.headers.get('X-Site')).toBe('acme');
    expectSecurityHeaders(response);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('dispatches requests with valid credentials, including UTF-8 ones', async () => {
    const { host, dispatcher, env } = await protectedSite();
    const valid = await call(env, `https://${host}/`, {
      headers: { Authorization: basicHeader('client', 'correct horse') },
    });
    expect(valid.status).toBe(200);
    const utf8 = await call(env, `https://${host}/`, { headers: { Authorization: basicHeader('josé', 'pässwörd ✓') } });
    expect(utf8.status).toBe(200);
    expect(dispatcher.calls).toHaveLength(2);
  });

  it('rejects a wrong password or an unknown user', async () => {
    const { host, dispatcher, env } = await protectedSite();
    for (const header of [basicHeader('client', 'wrong'), basicHeader('nobody', 'correct horse')]) {
      const response = await call(env, `https://${host}/`, { headers: { Authorization: header } });
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBe(`Basic realm="${host}", charset="UTF-8"`);
    }
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('rejects malformed Authorization headers', async () => {
    const { host, dispatcher, env } = await protectedSite();
    for (const header of ['Basic', 'Basic !!!!', `Bearer ${btoa('client:correct horse')}`, `Basic ${btoa('client')}`]) {
      const response = await call(env, `https://${host}/`, { headers: { Authorization: header } });
      expect(response.status).toBe(401);
    }
    expect(dispatcher.calls).toHaveLength(0);
  });

  it('skips auth only for paths listed in bypassPaths, matched exactly', async () => {
    const { host, env } = await protectedSite(['/health']);
    expect((await call(env, `https://${host}/health`)).status).toBe(200);
    expect((await call(env, `https://${host}/health?verbose=1`)).status).toBe(200);
    expect((await call(env, `https://${host}/health/`)).status).toBe(401);
    expect((await call(env, `https://${host}/healthz`)).status).toBe(401);
    expect((await call(env, `https://${host}/`)).status).toBe(401);
  });

  it('skips auth for every path under a bypass path ending in "*"', async () => {
    const { host, env } = await protectedSite(['/api/public/*']);
    expect((await call(env, `https://${host}/api/public/items`)).status).toBe(200);
    expect((await call(env, `https://${host}/api/public/`)).status).toBe(200);
    expect((await call(env, `https://${host}/api/private`)).status).toBe(401);
  });

  it('serves sites with auth type "none" without credentials', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route({ auth: { type: 'none' } }));
    const response = await call(makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) })), `https://${host}/`);
    expect(response.status).toBe(200);
  });

  it('runs PBKDF2 once for repeated requests from the same visitor', async () => {
    const { host, env } = await protectedSite();
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    const headers = { Authorization: basicHeader('client', 'correct horse') };
    for (let i = 0; i < 3; i++) {
      expect((await call(env, `https://${host}/page-${i}`, { headers })).status).toBe(200);
    }
    expect(deriveBits).toHaveBeenCalledTimes(1);
  });
});

describe('route cache', () => {
  it('reuses a record found in KV for 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const host = `${uniqueLabel()}.bohr.io`;
    await putRoute(host, route());
    const env = makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) }));

    expect((await call(env, `https://${host}/`)).status).toBe(200);
    await testEnv.ROUTES.delete(host);
    vi.setSystemTime(start + 29_000);
    expect((await call(env, `https://${host}/`)).status).toBe(200);
    vi.setSystemTime(start + 30_000);
    expect((await call(env, `https://${host}/`)).status).toBe(404);
  });

  it('remembers a miss for no more than 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const host = `${uniqueLabel()}.bohr.io`;
    const env = makeEnv(fakeDispatcher({ [SCRIPT]: echo(SCRIPT) }));

    expect((await call(env, `https://${host}/`)).status).toBe(404);
    await putRoute(host, route());
    vi.setSystemTime(start + 4_000);
    expect((await call(env, `https://${host}/`)).status).toBe(404);
    vi.setSystemTime(start + 5_000);
    expect((await call(env, `https://${host}/`)).status).toBe(200);
  });
});
