import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bundleWorker,
  type CommandRunner,
  collectModules,
  hasLocalWrangler,
  moduleContentType,
  PLACEHOLDER_WORKER_NAME,
  resolveMainModule,
  runCommand,
  wranglerArgs,
} from '../src/bundle';
import { makeTempDir, writeTree } from './helpers';

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('moduleContentType', () => {
  it.each([
    ['index.js', 'application/javascript+module'],
    ['chunks/a.mjs', 'application/javascript+module'],
    ['legacy.cjs', 'application/javascript'],
    ['index.js.map', 'application/source-map'],
    ['add.wasm', 'application/wasm'],
    ['blob.bin', 'application/octet-stream'],
    ['schema.sql', 'text/plain'],
    ['page.html', 'text/plain'],
    ['notes.txt', 'text/plain'],
  ])('%s is %s', (name, type) => {
    expect(moduleContentType(name)).toBe(type);
  });
});

describe('collectModules', () => {
  it('reads every file except the README wrangler writes, with POSIX names', async () => {
    await writeTree(dir, {
      'README.md': 'This folder contains the built output assets for the worker',
      'index.js': 'export default {}',
      'index.js.map': '{"version":3}',
      'chunks/b.js': 'export const b = 1',
      'add.wasm': Uint8Array.from([0, 97, 115, 109]),
      'docs/README.md': 'a text module',
    });
    const modules = await collectModules(dir);
    expect(modules.map((module) => [module.name, module.contentType])).toEqual([
      ['add.wasm', 'application/wasm'],
      ['chunks/b.js', 'application/javascript+module'],
      ['docs/README.md', 'text/plain'],
      ['index.js', 'application/javascript+module'],
      ['index.js.map', 'application/source-map'],
    ]);
    expect(Buffer.from(modules[0]?.content ?? []).toJSON().data).toEqual([0, 97, 115, 109]);
  });
});

describe('resolveMainModule', () => {
  it('maps the entry to the .js file wrangler writes', () => {
    expect(resolveMainModule('/p/src/index.ts', ['index.js', 'index.js.map'])).toBe('index.js');
    expect(resolveMainModule('/p/src/worker.mjs', ['worker.js'])).toBe('worker.js');
  });

  it('accepts the entry copied as is (no_bundle)', () => {
    expect(resolveMainModule('/p/dist/server.mjs', ['server.mjs', 'chunk.mjs'])).toBe('server.mjs');
  });

  it('fails when the entry module is missing', () => {
    expect(() => resolveMainModule('/p/src/index.ts', ['other.js'])).toThrow(
      'wrangler did not write the entry module index.js for main "index.ts" (it wrote: other.js).',
    );
  });
});

describe('wranglerArgs', () => {
  it('runs a dry-run deploy into the outdir with the validated config', () => {
    expect(wranglerArgs('/tmp/out', '/p/wrangler.jsonc', 'site')).toEqual([
      '--yes',
      'wrangler',
      'deploy',
      '--dry-run',
      '--outdir',
      '/tmp/out',
      '--config',
      '/p/wrangler.jsonc',
    ]);
  });

  it('passes a placeholder name when the config has none, as wrangler requires one', () => {
    expect(wranglerArgs('/o', '/p/wrangler.jsonc', null).slice(-2)).toEqual(['--name', PLACEHOLDER_WORKER_NAME]);
  });
});

describe('bundleWorker', () => {
  it('bundles into a temporary outdir, reads the modules and removes the outdir', async () => {
    let outdir = '';
    const run = vi.fn<CommandRunner>(async (_command, args) => {
      outdir = args[args.indexOf('--outdir') + 1] as string;
      await writeTree(outdir, {
        'README.md': 'note',
        'index.js': 'export default { fetch() {} }',
        'index.js.map': '{}',
      });
      return 0;
    });
    const configPath = join(dir, 'wrangler.jsonc');
    const bundle = await bundleWorker({
      workingDirectory: dir,
      configPath,
      main: join(dir, 'src', 'index.ts'),
      workerName: 'site',
      run,
    });

    expect(run).toHaveBeenCalledWith('npx', wranglerArgs(outdir, configPath, 'site'), dir);
    expect(bundle.mainModule).toBe('index.js');
    expect(bundle.modules.map((module) => module.name)).toEqual(['index.js', 'index.js.map']);
    expect(existsSync(outdir)).toBe(false);
  });

  it('reports a failed wrangler run and still removes the outdir', async () => {
    let outdir = '';
    const run = vi.fn<CommandRunner>(async (_command, args) => {
      outdir = args[args.indexOf('--outdir') + 1] as string;
      return 1;
    });
    await expect(
      bundleWorker({ workingDirectory: dir, configPath: 'w.jsonc', main: 'src/index.ts', workerName: null, run }),
    ).rejects.toThrow('wrangler deploy --dry-run failed with exit code 1; see its output above.');
    expect(existsSync(outdir)).toBe(false);
  });

  it('explains a missing npx', async () => {
    const run = vi.fn<CommandRunner>(async () => {
      throw new Error('spawn npx ENOENT');
    });
    await expect(
      bundleWorker({ workingDirectory: dir, configPath: 'w.jsonc', main: 'src/index.ts', workerName: null, run }),
    ).rejects.toThrow('Could not run npx (spawn npx ENOENT). Set up Node.js (actions/setup-node) before this action.');
  });

  it('notes when npx has to download wrangler', async (context) => {
    // npx would find a wrangler installed above the temp directory (e.g. in the home folder).
    if (hasLocalWrangler(dir)) context.skip();
    const log = vi.fn();
    const run = vi.fn<CommandRunner>(async (_command, args) => {
      await writeTree(args[args.indexOf('--outdir') + 1] as string, { 'index.js': '' });
      return 0;
    });
    await bundleWorker({ workingDirectory: dir, configPath: 'w.jsonc', main: 'index.js', workerName: 'x', run, log });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('wrangler is not installed in this project'));

    log.mockClear();
    await writeTree(dir, { 'node_modules/wrangler/package.json': '{}' });
    await bundleWorker({ workingDirectory: dir, configPath: 'w.jsonc', main: 'index.js', workerName: 'x', run, log });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('hasLocalWrangler', () => {
  it('finds wrangler in the directory or a parent', async () => {
    await writeTree(dir, { 'node_modules/wrangler/package.json': '{}', 'apps/site/package.json': '{}' });
    expect(hasLocalWrangler(dir)).toBe(true);
    expect(hasLocalWrangler(join(dir, 'apps', 'site'))).toBe(true);
  });
});

describe('runCommand', () => {
  it('resolves with the exit code', async () => {
    await expect(runCommand('node', ['-e', 'process.exit(3)'], dir)).resolves.toBe(3);
    await expect(runCommand('node', ['-e', 'process.exit(0)'], dir)).resolves.toBe(0);
  });
});
