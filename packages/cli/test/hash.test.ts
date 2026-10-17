import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { assetContentType, hashAsset } from '../src/hash';

/** wrangler's hashFile, restated: BLAKE3(base64(contents) + extension), first 32 hex chars. */
function wranglerHash(contents: Uint8Array, extension: string): string {
  const input = new TextEncoder().encode(Buffer.from(contents).toString('base64') + extension);
  return bytesToHex(blake3(input)).slice(0, 32);
}

describe('hashAsset', () => {
  it('matches known-answer vectors computed once with wrangler 4.149 (blake3-wasm hashFile)', () => {
    expect(hashAsset(Buffer.from('<!doctype html><title>bohr</title>\n'), 'index.html')).toBe(
      '68e1d7b81f1bfccd241e757700260a26',
    );
    expect(
      hashAsset(
        Uint8Array.from({ length: 256 }, (_, i) => i),
        'bytes.bin',
      ),
    ).toBe('04c51b7bb2984817f8bb7099dde4021f');
    expect(hashAsset(new Uint8Array(0), 'empty.txt')).toBe('f9bc91770fa5e997cbd47fba833629fc');
    expect(hashAsset(Buffer.from('deny from all\n'), '.htaccess')).toBe('2686804f8c3ebffe96cf428e116c09c2');
    expect(hashAsset(Buffer.from('gz'), 'archive.tar.gz')).toBe('e465ea83f604df976e0ce8d25ada4637');
  });

  it.each([
    ['index.html', '<html></html>', 'html'],
    ['assets/app.3f2a.js', 'export default 1;', 'js'],
    ['styles/site.CSS', 'body{}', 'CSS'],
    ['LICENSE', 'MIT', ''],
    ['.well-known/security.txt', 'Contact: x', 'txt'],
    ['notes/día.café', 'olá', 'café'],
    ['empty.txt', '', 'txt'],
  ])('hashes %s like wrangler', (path, text, extension) => {
    const contents = Buffer.from(text, 'utf8');
    expect(hashAsset(contents, path)).toBe(wranglerHash(contents, extension));
    expect(hashAsset(contents, path)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashes binary contents through base64', () => {
    const contents = Uint8Array.from([0, 255, 128, 10, 13, 0xfe]);
    expect(hashAsset(contents, '/img/logo.png')).toBe(wranglerHash(contents, 'png'));
  });

  it('depends on the extension but not on the directory or base name', () => {
    const contents = Buffer.from('same bytes');
    expect(hashAsset(contents, 'a/one.txt')).toBe(hashAsset(contents, 'b/two.txt'));
    expect(hashAsset(contents, 'one.txt')).not.toBe(hashAsset(contents, 'one.html'));
  });

  it('hashes a .shtm page as .html, so a copy Cloudflare stored without a type goes up again as text/html', () => {
    const contents = Buffer.from('<h1>visa</h1>');
    expect(hashAsset(contents, '/cartoes/visa/index.shtm')).toBe(wranglerHash(contents, 'html'));
    expect(hashAsset(contents, '/cartoes/visa/INDEX.SHTM')).toBe(wranglerHash(contents, 'html'));
    expect(hashAsset(contents, '/cartoes/visa/index.shtm')).not.toBe(wranglerHash(contents, 'shtm'));
  });

  it('reads only the bytes of a view with an offset', () => {
    const view = Buffer.from('xxhello').subarray(2);
    expect(hashAsset(view, 'a.txt')).toBe(wranglerHash(Buffer.from('hello'), 'txt'));
  });
});

describe('assetContentType', () => {
  it.each([
    ['/index.html', 'text/html; charset=utf-8'],
    ['/style.css', 'text/css; charset=utf-8'],
    ['/app.js', 'text/javascript; charset=utf-8'],
    ['/robots.txt', 'text/plain; charset=utf-8'],
    ['/data.json', 'application/json'],
    ['/logo.png', 'image/png'],
    ['/LOGO.PNG', 'image/png'],
    ['/image.svg', 'image/svg+xml'],
    ['/font.woff2', 'font/woff2'],
    ['/nested/dir/site.webmanifest', 'application/manifest+json'],
    ['/cartoes/visa/index.shtm', 'text/html; charset=utf-8'],
    ['/INDEX.SHTM', 'text/html; charset=utf-8'],
    ['/page.shtml', 'text/html; charset=utf-8'],
  ])('%s is %s', (path, type) => {
    expect(assetContentType(path)).toBe(type);
  });

  it.each(['/file.unknownext', '/README', '/.htaccess', '/dir.with.dots/LICENSE'])('%s has no type', (path) => {
    expect(assetContentType(path)).toBeNull();
  });
});
