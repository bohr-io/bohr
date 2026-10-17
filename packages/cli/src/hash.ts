import { extname } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import mime from 'mime';

/** Content type sent for assets whose type is unknown; Cloudflare reads it as "no Content-Type". */
export const NULL_CONTENT_TYPE = 'application/null';

/**
 * Extensions `mime` does not know that sites served as HTML: bohr v1 served `.shtm` pages as text/html. Their
 * hash uses the extension of their type (`html`), so files Cloudflare stored before they had a type go up again.
 */
const EXTRA_TYPES: Record<string, { type: string; hashExtension: string }> = {
  shtm: { type: 'text/html', hashExtension: 'html' },
};

/**
 * Hashes an asset exactly like wrangler 4: the first 32 hex chars of
 * BLAKE3(base64(contents) + extension without the dot), with EXTRA_TYPES' extensions mapped. Matching hashes let
 * Cloudflare skip files it already stores.
 */
export function hashAsset(contents: Uint8Array, filePath: string): string {
  const base64 = Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength).toString('base64');
  const extension = extname(filePath).slice(1);
  const hashed = EXTRA_TYPES[extension.toLowerCase()]?.hashExtension ?? extension;
  return bytesToHex(blake3(Buffer.from(base64 + hashed, 'utf8'))).slice(0, 32);
}

/**
 * Content type of an asset as wrangler computes it: `mime` lookup by extension (plus EXTRA_TYPES),
 * with `; charset=utf-8` added to text types. Null when the type is unknown.
 */
export function assetContentType(filePath: string): string | null {
  const type = mime.getType(filePath) ?? EXTRA_TYPES[extname(filePath).slice(1).toLowerCase()]?.type ?? null;
  if (type?.startsWith('text/') && !type.includes('charset')) {
    return `${type}; charset=utf-8`;
  }
  return type;
}
