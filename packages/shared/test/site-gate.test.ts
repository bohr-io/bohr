import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { gateSetupScript, isBypassed, SITE_PASSWORD_ITERATIONS, type SiteAuthUser } from '../src/index';

// workerd adds timingSafeEqual to WebCrypto; Node does not
beforeAll(() => {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
});

async function user(username: string, password: string): Promise<SiteAuthUser> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: SITE_PASSWORD_ITERATIONS },
      key,
      256,
    ),
  );
  return {
    username,
    salt: Buffer.from(salt).toString('base64'),
    hash: Buffer.from(hash).toString('base64'),
    iterations: SITE_PASSWORD_ITERATIONS,
  };
}

/** Runs the workflow's setup in a project folder and loads the gate it wrote. */
async function gateFor(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'bohr-gate-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  const out = execFileSync(process.execPath, ['-e', gateSetupScript()], { cwd: dir, encoding: 'utf8' });
  if (out === '') return { dir, config: null, gate: null };
  const config = JSON.parse(readFileSync(join(dir, out), 'utf8')) as Record<string, unknown>;
  const module = (await import(pathToFileURL(join(dir, out, '..', '.bohr-gate.mjs')).href)) as {
    default: { fetch: (request: Request, env: Record<string, unknown>) => Promise<Response> };
    Room?: unknown;
  };
  return { dir, config, gate: module };
}

const basic = (username: string, password: string) => `Basic ${btoa(`${username}:${password}`)}`;

describe('site gate', () => {
  it('wraps the site: protection only with BOHR_SITE_AUTH, bypass paths, named exports kept', async () => {
    const { config, gate } = await gateFor({
      'wrangler.jsonc': '// site\n{ "name": "loja", "main": "src/index.js", "assets": { "directory": "dist" } }',
      'src/index.js':
        "export default { fetch: (request) => new Response('site ' + new URL(request.url).pathname) };\nexport class Room {}\n",
    });
    expect(config).toMatchObject({
      name: 'loja',
      main: '.bohr-gate.mjs',
      assets: { directory: 'dist', binding: 'ASSETS', run_worker_first: true },
    });
    expect(gate?.Room).toBeTypeOf('function');
    const fetch = (path: string, env: Record<string, unknown>, authorization?: string) =>
      gate?.default.fetch(
        new Request(
          `https://loja.example.com${path}`,
          authorization ? { headers: { Authorization: authorization } } : {},
        ),
        env,
      ) as Promise<Response>;

    expect(await (await fetch('/', {})).text()).toBe('site /');
    const auth = JSON.stringify({ users: [await user('cliente', 's3nh@')], bypassPaths: ['/health', '/api/public/*'] });
    const locked = await fetch('/', { BOHR_SITE_AUTH: auth });
    expect(locked.status).toBe(401);
    expect(locked.headers.get('WWW-Authenticate')).toBe('Basic realm="loja.example.com", charset="UTF-8"');
    expect((await fetch('/', { BOHR_SITE_AUTH: auth }, basic('cliente', 'errada'))).status).toBe(401);
    expect(await (await fetch('/', { BOHR_SITE_AUTH: auth }, basic('cliente', 's3nh@'))).text()).toBe('site /');
    expect(await (await fetch('/health', { BOHR_SITE_AUTH: auth })).text()).toBe('site /health');
    expect(await (await fetch('/api/public/x', { BOHR_SITE_AUTH: auth })).text()).toBe('site /api/public/x');
    expect((await fetch('/api/private', { BOHR_SITE_AUTH: auth })).status).toBe(401);
  });

  it('serves the static assets of a site without code, and skips what it cannot wrap', async () => {
    const { gate } = await gateFor({ 'wrangler.json': '{ "name": "landing", "assets": { "directory": "public" } }' });
    const assets = { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) };
    const response = await gate?.default.fetch(new Request('https://landing.example.com/index.html'), {
      ASSETS: assets,
    });
    expect(await response?.text()).toBe('asset /index.html');

    expect((await gateFor({ 'wrangler.toml': 'name = "toml"' })).config).toBeNull();
    expect((await gateFor({ 'wrangler.jsonc': '{ "name": "py", "main": "src/entry.py" }' })).config).toBeNull();
  });

  it('matches bypass paths exactly or by prefix', () => {
    expect(isBypassed('/health', ['/health'])).toBe(true);
    expect(isBypassed('/healthz', ['/health'])).toBe(false);
    expect(isBypassed('/api/public/a/b', ['/api/public/*'])).toBe(true);
    expect(isBypassed('/api', [])).toBe(false);
  });
});
