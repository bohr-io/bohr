import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateConfig, parseConfig, UNSUPPORTED_BINDINGS } from '../src/config';
import { makeTempDir, writeTree } from './helpers';

const CONFIG_PATH = resolve('/project/wrangler.jsonc');
const parse = (config: Record<string, unknown>) => parseConfig(JSON.stringify(config), CONFIG_PATH);
const base = { compatibility_date: '2026-10-01' };

describe('parseConfig', () => {
  it('reads JSONC with comments and trailing commas', () => {
    const config = parseConfig(
      `{
        // The Worker
        "name": "site",
        "main": "./src/index.ts", /* bundled by wrangler */
        "compatibility_date": "2026-10-01",
        "compatibility_flags": ["nodejs_compat",],
        "vars": { "PUBLIC_URL": "https://example.com", },
        "assets": {
          "directory": "./dist",
          "binding": "ASSETS",
          "not_found_handling": "single-page-application",
          "html_handling": "auto-trailing-slash",
          "run_worker_first": ["/api/*", "!/api/docs/*"],
        },
      }`,
      CONFIG_PATH,
    );
    expect(config).toEqual({
      configPath: CONFIG_PATH,
      name: 'site',
      main: resolve('/project/src/index.ts'),
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      vars: { PUBLIC_URL: 'https://example.com' },
      assets: {
        directory: resolve('/project/dist'),
        binding: 'ASSETS',
        notFoundHandling: 'single-page-application',
        htmlHandling: 'auto-trailing-slash',
        runWorkerFirst: ['/api/*', '!/api/docs/*'],
      },
      warnings: [],
    });
  });

  it('supports assets-only projects (no main)', () => {
    const config = parse({ ...base, assets: { directory: 'public' } });
    expect(config.main).toBeNull();
    expect(config.name).toBeNull();
    expect(config.assets).toEqual({ directory: resolve('/project/public'), binding: null });
    expect(config.compatibilityFlags).toEqual([]);
    expect(config.vars).toEqual({});
  });

  it('supports Workers without assets', () => {
    const config = parse({ ...base, main: 'worker.js' });
    expect(config.assets).toBeNull();
    expect(config.main).toBe(resolve('/project/worker.js'));
  });

  it('accepts run_worker_first: true', () => {
    expect(
      parse({ ...base, main: 'w.js', assets: { directory: 'd', run_worker_first: true } }).assets?.runWorkerFirst,
    ).toBe(true);
  });

  it('refuses bindings with the documented message', () => {
    expect(() => parse({ ...base, main: 'w.js', kv_namespaces: [{ binding: 'KV', id: 'x' }] })).toThrow(
      'bohr.io Cloud managed projects support static assets, vars and secrets for now; kv_namespaces is not supported.',
    );
  });

  it.each(UNSUPPORTED_BINDINGS.map((key) => [key]))('refuses %s', (key) => {
    const value = key === 'ai' || key === 'browser' ? { binding: 'X' } : [{ binding: 'X' }];
    expect(() => parse({ ...base, main: 'w.js', [key]: value })).toThrow(`; ${key} is not supported.`);
  });

  it('lists every refused binding, one per line', () => {
    expect(() =>
      parse({
        ...base,
        main: 'w.js',
        d1_databases: [{ binding: 'DB' }],
        durable_objects: { bindings: [{ name: 'A' }] },
      }),
    ).toThrow(/d1_databases is not supported\.\n.*durable_objects is not supported\./);
  });

  it('allows empty binding sections, as generated configs contain', () => {
    const config = parse({
      ...base,
      main: 'w.js',
      kv_namespaces: [],
      durable_objects: { bindings: [] },
      queues: { producers: [], consumers: [] },
      unsafe: {},
      routes: [],
      triggers: { crons: [] },
    });
    expect(config.main).toBe(resolve('/project/w.js'));
    expect(config.warnings).toEqual([]);
  });

  it('accepts string vars only', () => {
    expect(() => parse({ ...base, main: 'w.js', vars: { DEBUG: true } })).toThrow(
      'vars.DEBUG in wrangler.jsonc is a boolean; bohr.io Cloud managed projects support string vars only.',
    );
    expect(() => parse({ ...base, main: 'w.js', vars: { LIMIT: 10 } })).toThrow(
      'vars.LIMIT in wrangler.jsonc is a number',
    );
    expect(() => parse({ ...base, main: 'w.js', vars: { CONFIG: { a: 1 } } })).toThrow(
      'vars.CONFIG in wrangler.jsonc is an object',
    );
  });

  it('requires a compatibility_date', () => {
    expect(() => parse({ main: 'w.js' })).toThrow('Set compatibility_date in wrangler.jsonc');
    expect(() => parse({ main: 'w.js', compatibility_date: '1 Oct 2026' })).toThrow('Set compatibility_date');
  });

  it('validates assets settings', () => {
    expect(() => parse({ ...base, assets: { binding: 'ASSETS' } })).toThrow('Set assets.directory in wrangler.jsonc');
    expect(() => parse({ ...base, assets: { directory: 'd', not_found_handling: 'spa' } })).toThrow(
      'assets.not_found_handling in wrangler.jsonc must be one of: single-page-application, 404-page, none.',
    );
    expect(() => parse({ ...base, assets: { directory: 'd', html_handling: 'trailing' } })).toThrow(
      'assets.html_handling',
    );
    expect(() => parse({ ...base, main: 'w.js', assets: { directory: 'd', run_worker_first: '/api/*' } })).toThrow(
      'assets.run_worker_first in wrangler.jsonc must be true, false or a list of route patterns.',
    );
  });

  it('refuses run_worker_first without a Worker, like wrangler', () => {
    expect(() => parse({ ...base, assets: { directory: 'd', run_worker_first: ['/api/*'] } })).toThrow(
      'assets.run_worker_first in wrangler.jsonc needs a Worker script',
    );
    expect(parse({ ...base, assets: { directory: 'd', run_worker_first: false } }).assets?.runWorkerFirst).toBe(false);
  });

  it('needs main or assets', () => {
    expect(() => parse(base)).toThrow('Nothing to deploy: wrangler.jsonc sets neither main');
  });

  it('points Pages configs at assets', () => {
    expect(() => parse({ ...base, pages_build_output_dir: 'dist' })).toThrow(/Cloudflare Pages config/);
  });

  it('warns about settings bohr.io Cloud ignores', () => {
    const config = parse({
      ...base,
      main: 'w.js',
      routes: [{ pattern: 'example.com/*', zone_name: 'example.com' }],
      triggers: { crons: ['0 * * * *'] },
      env: { staging: { vars: { A: 'b' } } },
      assets: { directory: 'd', base_path: '/docs/' },
    });
    expect(config.warnings).toEqual([
      'routes in wrangler.jsonc are ignored: bohr.io Cloud serves the project on the hostnames set in the bohr panel.',
      'triggers.crons in wrangler.jsonc are ignored: bohr.io Cloud does not run cron triggers yet.',
      'env sections in wrangler.jsonc are ignored: the top-level configuration is deployed.',
      'assets.base_path in wrangler.jsonc is ignored: bohr.io Cloud serves assets from the root path.',
    ]);
  });

  it('reports JSON syntax errors with a position', () => {
    expect(() => parseConfig('{\n  "main": "w.js"\n  "compatibility_date": "2026-10-01"\n}', CONFIG_PATH)).toThrow(
      /wrangler\.jsonc:3:3: invalid JSON \(CommaExpected\)/,
    );
    expect(() => parseConfig('[]', CONFIG_PATH)).toThrow('wrangler.jsonc must contain a JSON object.');
  });
});

describe('locateConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds wrangler.jsonc', async () => {
    await writeTree(dir, { 'wrangler.jsonc': '{}' });
    expect(locateConfig(dir)).toEqual({ path: join(dir, 'wrangler.jsonc'), redirected: false });
  });

  it('prefers wrangler.json over wrangler.jsonc, like wrangler', async () => {
    await writeTree(dir, { 'wrangler.jsonc': '{}', 'wrangler.json': '{}' });
    expect(locateConfig(dir).path).toBe(join(dir, 'wrangler.json'));
  });

  it('asks for wrangler.jsonc when only wrangler.toml exists', async () => {
    await writeTree(dir, { 'wrangler.toml': 'name = "x"' });
    expect(() => locateConfig(dir)).toThrow(
      'Found wrangler.toml, but this action reads wrangler.jsonc. Convert the config to wrangler.jsonc',
    );
  });

  it('explains a missing config', () => {
    expect(() => locateConfig(dir)).toThrow(/No wrangler\.jsonc or wrangler\.json in .*working-directory/);
  });

  it('follows .wrangler/deploy/config.json to the config generated by the build', async () => {
    await writeTree(dir, {
      'wrangler.jsonc': '{}',
      '.wrangler/deploy/config.json': '{ "configPath": "../../dist/site/wrangler.json" }',
      'dist/site/wrangler.json': '{}',
    });
    expect(locateConfig(dir)).toEqual({ path: join(dir, 'dist', 'site', 'wrangler.json'), redirected: true });
  });

  it('rejects a redirect to a missing config', async () => {
    await writeTree(dir, { '.wrangler/deploy/config.json': '{ "configPath": "../../dist/wrangler.json" }' });
    expect(() => locateConfig(dir)).toThrow(/which does not exist/);
  });
});
