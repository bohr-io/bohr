import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSwappingPackages, withNodeSidesOfPackages } from '../src/node-compat';

let dir: string;

const ICONV = JSON.stringify(
  { name: 'iconv-lite', version: '0.6.3', browser: { './lib/extend-node': false, './lib/streams': false, x: 'y' } },
  null,
  2,
);

async function put(path: string, content: string) {
  await mkdir(join(dir, path, '..'), { recursive: true });
  await writeFile(join(dir, path), content);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bohr-node-compat-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the Node.js side of packages Workers run with nodejs_compat', () => {
  it('finds iconv-lite in a backend folder, nested under Express, and in pnpm and scoped layouts', async () => {
    await put('api/core/node_modules/iconv-lite/package.json', ICONV);
    await put('api/core/node_modules/express/node_modules/raw-body/node_modules/iconv-lite/package.json', ICONV);
    await put('node_modules/.pnpm/iconv-lite@0.4.24/node_modules/iconv-lite/package.json', ICONV);
    await put('node_modules/@scope/pkg/node_modules/iconv-lite/package.json', ICONV);
    await put('node_modules/left-pad/package.json', '{"name":"left-pad"}');
    await put('.git/node_modules/iconv-lite/package.json', ICONV);
    const found = (await findSwappingPackages(dir)).map((path) => path.slice(dir.length + 1).replaceAll('\\', '/'));
    expect(found.sort()).toEqual([
      'api/core/node_modules/express/node_modules/raw-body/node_modules/iconv-lite',
      'api/core/node_modules/iconv-lite',
      'node_modules/.pnpm/iconv-lite@0.4.24/node_modules/iconv-lite',
      'node_modules/@scope/pkg/node_modules/iconv-lite',
    ]);
  });

  it('takes out only the swaps while wrangler bundles, then puts the files back exactly', async () => {
    await put('api/core/node_modules/iconv-lite/package.json', ICONV);
    const path = join(dir, 'api/core/node_modules/iconv-lite/package.json');
    const logs: string[] = [];
    const during = await withNodeSidesOfPackages(
      dir,
      async () => JSON.parse(await readFile(path, 'utf8')).browser,
      (line) => logs.push(line),
    );
    expect(during).toEqual({ x: 'y' });
    expect(await readFile(path, 'utf8')).toBe(ICONV);
    expect(logs[0]).toContain('1 package(s)');
  });

  it('puts the files back when the bundling fails', async () => {
    await put('node_modules/iconv-lite/package.json', ICONV);
    await expect(
      withNodeSidesOfPackages(dir, async () => {
        throw new Error('wrangler failed');
      }),
    ).rejects.toThrow('wrangler failed');
    expect(await readFile(join(dir, 'node_modules/iconv-lite/package.json'), 'utf8')).toBe(ICONV);
  });
});
