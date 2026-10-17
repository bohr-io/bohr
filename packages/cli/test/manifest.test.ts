import { mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assetsIgnoreFile } from '@bohr/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashAsset } from '../src/hash';
import { buildAssetManifest, isPrivatePath, MAX_ASSET_SIZE, V1_MAX_ASSET_SIZE, v1Excluded } from '../src/manifest';
import { makeTempDir, writeTree } from './helpers';

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildAssetManifest', () => {
  it('keys every file by "/" + its POSIX path, with wrangler hashes and byte sizes', async () => {
    await writeTree(dir, {
      'index.html': '<h1>bohr</h1>',
      'assets/app.js': 'console.log("hi")',
      'assets/img/logo.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      'docs/día.txt': 'olá',
    });
    const result = await buildAssetManifest(dir);

    expect(Object.keys(result.manifest)).toEqual([
      '/assets/app.js',
      '/assets/img/logo.png',
      '/docs/día.txt',
      '/index.html',
    ]);
    expect(result.manifest['/index.html']).toEqual({
      hash: hashAsset(Buffer.from('<h1>bohr</h1>'), 'index.html'),
      size: 13,
    });
    expect(result.manifest['/assets/img/logo.png']).toEqual({
      hash: hashAsset(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'logo.png'),
      size: 4,
    });
    expect(result.manifest['/docs/día.txt']?.size).toBe(Buffer.byteLength('olá'));
    expect(result.totalBytes).toBe(13 + 17 + 4 + 4);
    expect(result.warnings).toEqual([]);
  });

  it('records content types and absolute paths for the upload', async () => {
    await writeTree(dir, { 'index.html': 'x', 'data.unknownext': 'y', LICENSE: 'z', 'css/site.css': 'w' });
    const { files } = await buildAssetManifest(dir);
    expect(files.map((file) => [file.path, file.contentType])).toEqual([
      ['/LICENSE', null],
      ['/css/site.css', 'text/css; charset=utf-8'],
      ['/data.unknownext', null],
      ['/index.html', 'text/html; charset=utf-8'],
    ]);
    expect(files[1]?.absolutePath).toBe(join(dir, 'css', 'site.css'));
  });

  it('honours .assetsignore and never uploads the ignore file itself', async () => {
    await writeTree(dir, {
      '.assetsignore': [
        '# build leftovers',
        '*.map',
        '!keep.map',
        '/private/',
        'drafts/',
        '/secret.txt',
        'logs/**',
        '!logs/keep.log',
        '',
      ].join('\r\n'),
      'index.html': 'home',
      'app.js': 'js',
      'app.js.map': 'map',
      'keep.map': 'kept',
      'private/key.txt': 'no',
      'nested/private/ok.txt': 'yes',
      'drafts/post.html': 'no',
      'blog/drafts/post.html': 'no',
      'secret.txt': 'no',
      'nested/secret.txt': 'yes',
      'logs/a.log': 'no',
      'logs/keep.log': 'yes',
    });
    const { manifest } = await buildAssetManifest(dir);
    expect(Object.keys(manifest)).toEqual([
      '/app.js',
      '/index.html',
      '/keep.map',
      '/logs/keep.log',
      '/nested/private/ok.txt',
      '/nested/secret.txt',
    ]);
  });

  it('reads _redirects and _headers instead of uploading them, and skips a root _worker.js file', async () => {
    await writeTree(dir, {
      _redirects: '/a /b 301',
      _headers: '/*\n  X-Frame-Options: DENY',
      '_worker.js': 'export default {}',
      'js/_worker.js': 'a regular asset',
      'nested/_headers': 'a regular asset too',
      'index.html': 'home',
    });
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/index.html', '/js/_worker.js', '/nested/_headers']);
    expect(result.redirects).toBe('/a /b 301');
    expect(result.headers).toBe('/*\n  X-Frame-Options: DENY');
    expect(result.warnings).toEqual(['Skipped /_worker.js: a Pages _worker.js file is server code, not an asset.']);
  });

  it('has no routing files when the directory has none', async () => {
    await writeTree(dir, { 'index.html': 'home' });
    const result = await buildAssetManifest(dir);
    expect(result).not.toHaveProperty('redirects');
    expect(result).not.toHaveProperty('headers');
  });

  it('skips a root _worker.js directory', async () => {
    await writeTree(dir, { '_worker.js/index.js': 'export default {}', 'index.html': 'home' });
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/index.html']);
    expect(result.warnings).toEqual([
      'Skipped /_worker.js/: a Pages _worker.js directory is server code, not an asset.',
    ]);
  });

  it('uploads _headers when .assetsignore re-includes it', async () => {
    await writeTree(dir, { '.assetsignore': '!_headers', _headers: 'x', 'index.html': 'y' });
    const { manifest } = await buildAssetManifest(dir);
    expect(Object.keys(manifest)).toEqual(['/_headers', '/index.html']);
  });

  it('stays quiet about _worker.js when .assetsignore lists it', async () => {
    await writeTree(dir, { '.assetsignore': '_worker.js', '_worker.js': 'server', 'index.html': 'y' });
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/index.html']);
    expect(result.warnings).toEqual([]);
  });

  it('accepts a file at the size limit and rejects a larger one', async () => {
    await writeTree(dir, { 'ok.bin': new Uint8Array(10) });
    await expect(buildAssetManifest(dir, { maxAssetSize: 10 })).resolves.toMatchObject({
      manifest: { '/ok.bin': { size: 10 } },
    });
    await writeTree(dir, { 'nested/big.bin': new Uint8Array(11) });
    await expect(buildAssetManifest(dir, { maxAssetSize: 10 })).rejects.toThrow(/Asset too large: \/nested\/big\.bin/);
  });

  it('rejects files over 25 MiB by default', async () => {
    expect(MAX_ASSET_SIZE).toBe(25 * 1024 * 1024);
    const handle = await open(join(dir, 'video.mp4'), 'w');
    await handle.truncate(MAX_ASSET_SIZE + 1);
    await handle.close();
    await expect(buildAssetManifest(dir)).rejects.toThrow(
      'Asset too large: /video.mp4 is 26214401 bytes (25 MiB), and Cloudflare Workers accept assets of up to 26214400 bytes (25 MiB).',
    );
  });

  it('skips symbolic links to directories with a warning', async () => {
    await writeTree(dir, { 'real/a.txt': 'real' });
    // A junction on Windows (no extra rights needed), a plain symlink elsewhere.
    await symlink(join(dir, 'real'), join(dir, 'linked'), 'junction');
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/real/a.txt']);
    expect(result.warnings).toEqual(['Skipped /linked: symbolic links are not deployed.']);
  });

  it('skips symbolic links to files with a warning', async (context) => {
    await writeTree(dir, { 'real.txt': 'real' });
    try {
      await symlink(join(dir, 'real.txt'), join(dir, 'link.txt'));
    } catch {
      context.skip(); // file symlinks need extra rights on Windows
    }
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/real.txt']);
    expect(result.warnings).toEqual(['Skipped /link.txt: symbolic links are not deployed.']);
  });

  it('does not warn about an ignored symbolic link', async () => {
    await writeTree(dir, { '.assetsignore': 'node_modules/', 'shared/a.txt': 'x', 'index.html': 'y' });
    await symlink(join(dir, 'shared'), join(dir, 'node_modules'), 'junction');
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/index.html', '/shared/a.txt']);
    expect(result.warnings).toEqual([]);
  });

  it('never publishes git data, at the root or below', async () => {
    await writeTree(dir, {
      '.git/HEAD': 'ref: refs/heads/main',
      '.git/objects/pack/p.pack': 'x',
      'vendor/lib/.git': 'gitdir: ../../.git/modules/lib',
      '.gitignore': 'node_modules',
      'index.html': 'y',
    });
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/.gitignore', '/index.html']);
  });

  it('never publishes environment files, whatever .assetsignore says, and says so', async () => {
    await writeTree(dir, {
      '.env': 'SECRET=1',
      '.ENV.production': 'SECRET=2',
      'api/.env.local': 'SECRET=3',
      'nested/.env/inside.txt': 'x',
      '.git.bak/config': 'x',
      '.envrc': 'kept: not an env file',
      'config.env': 'kept: only bohr v1 skipped these',
      // A negation in .assetsignore cannot bring them back
      '.assetsignore': '!.env\n!.env.*',
      'index.html': 'y',
    });
    const result = await buildAssetManifest(dir);
    expect(Object.keys(result.manifest)).toEqual(['/.envrc', '/config.env', '/index.html']);
    expect(result.warnings).toEqual([
      'Skipped /.ENV.production: environment files are never published.',
      'Skipped /.env: environment files are never published.',
      'Skipped /api/.env.local: environment files are never published.',
      'Skipped /nested/.env: environment files are never published.',
    ]);
    expect(isPrivatePath('a/.env.test/b.txt')).toBe(true);
    expect(isPrivatePath('.github/x.yml')).toBe(false);
  });

  describe('with bohr v1 rules (projects migrated from v1)', () => {
    const V1_TREE = {
      'index.html': 'home',
      'README.md': 'v1 published it: its rule compared a lowercased path',
      'docs/readme.md': 'same',
      'package.json': '{}',
      'sub/package-lock.json': '{}',
      'yarn.lock': '',
      '.yarnrc': '',
      '.gitignore': '',
      'production.env': 'X=1',
      'next.conf.js': '',
      'api/handler.js': 'v1 functions',
      'dist-api/index.js': '',
      'apis/kept.js': 'only /api/ itself',
      'node_modules/pkg/index.js': '',
      'app/node_modules/pkg/index.js': '',
      '.github/workflows/bohr.yml': '',
      '.turbo/cache.json': '',
      '.worker/index.js': '',
      'turborepo-cache/x': '',
      'assets/Package.JSON': 'matched case-insensitively',
    };

    it('leaves out what v1 never published, and only with them', async () => {
      await writeTree(dir, V1_TREE);
      const v1 = await buildAssetManifest(dir, { v1: true });
      expect(Object.keys(v1.manifest)).toEqual(['/README.md', '/apis/kept.js', '/docs/readme.md', '/index.html']);
      expect(v1.v1Skipped).toBe(16);
      expect(v1.warnings).toEqual([]);
      for (const path of ['/', '/api/', '/dist-api/x', '/a/package.json', '/a.env', '/x/next.conf.js']) {
        expect(v1Excluded(path.slice(1)), path).toBe(path !== '/');
      }

      const regular = await buildAssetManifest(dir);
      expect(Object.keys(regular.manifest)).toHaveLength(Object.keys(V1_TREE).length);
      expect(regular.v1Skipped).toBe(0);
    });

    it('leaves out the same files with the .assetsignore the move to the owner account writes', async () => {
      await writeTree(dir, {
        ...V1_TREE,
        '.assetsignore': assetsIgnoreFile(),
        'wrangler.jsonc': '{}',
        '.bohr/x.mjs': '',
      });
      const ignored = await buildAssetManifest(dir);
      expect(Object.keys(ignored.manifest)).toEqual(['/README.md', '/apis/kept.js', '/docs/readme.md', '/index.html']);
    });

    it('skips files of 24 MiB or more with a warning instead of failing', async () => {
      expect(V1_MAX_ASSET_SIZE).toBe(24 * 1024 * 1024);
      await writeTree(dir, {
        'index.html': 'y',
        'video.mp4': new Uint8Array(12),
        'just-under.pdf': new Uint8Array(11),
      });
      const result = await buildAssetManifest(dir, { v1: true, v1MaxAssetSize: 12, maxAssetSize: 11 });
      expect(Object.keys(result.manifest)).toEqual(['/index.html', '/just-under.pdf']);
      expect(result.warnings).toEqual([
        'Skipped /video.mp4 (12 B): bohr v1 did not publish files of 12 B or more, and neither does this migrated project.',
      ]);
      // A regular v2 project still fails on it
      await expect(buildAssetManifest(dir, { maxAssetSize: 11 })).rejects.toThrow(/Asset too large: \/video\.mp4/);
    });

    it('skips a file larger than Cloudflare accepts (86 MiB video)', async () => {
      const handle = await open(join(dir, 'video.mp4'), 'w');
      await handle.truncate(86 * 1024 * 1024);
      await handle.close();
      await writeTree(dir, { 'index.html': 'y' });
      const result = await buildAssetManifest(dir, { v1: true });
      expect(Object.keys(result.manifest)).toEqual(['/index.html']);
      expect(result.warnings).toEqual([
        'Skipped /video.mp4 (86 MiB): bohr v1 did not publish files of 24 MiB or more, and neither does this migrated project.',
      ]);
    });

    it('publishes .shtm pages as HTML, and a folder whose page is index.shtm opens it like v1 did', async () => {
      await writeTree(dir, {
        'cartoes/visa/index.shtm': '<h1>visa</h1>',
        'both/index.shtm': 'shtm',
        'both/index.html': 'html',
      });
      const result = await buildAssetManifest(dir, { v1: true });
      expect(Object.keys(result.manifest)).toEqual([
        '/both/index.html',
        '/both/index.shtm',
        '/cartoes/visa/index.html',
        '/cartoes/visa/index.shtm',
      ]);
      const page = result.files.find((file) => file.path === '/cartoes/visa/index.shtm');
      const alias = result.files.find((file) => file.path === '/cartoes/visa/index.html');
      expect(page?.contentType).toBe('text/html; charset=utf-8');
      expect(alias?.contentType).toBe('text/html; charset=utf-8');
      expect(alias?.absolutePath).toBe(page?.absolutePath);
      // Without v1 rules, no alias
      expect(Object.keys((await buildAssetManifest(dir)).manifest)).not.toContain('/cartoes/visa/index.html');
    });
  });

  it('returns an empty manifest for an empty directory', async () => {
    await mkdir(join(dir, 'empty-subdir'));
    const result = await buildAssetManifest(dir);
    expect(result.manifest).toEqual({});
    expect(result.files).toEqual([]);
  });

  it('explains a missing assets directory', async () => {
    await expect(buildAssetManifest(join(dir, 'dist'))).rejects.toThrow(/does not exist. Run the project's build/);
    await writeFile(join(dir, 'file'), 'x');
    await expect(buildAssetManifest(join(dir, 'file'))).rejects.toThrow(/does not exist/);
  });
});
