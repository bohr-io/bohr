import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSETS_IGNORE_FILE, v1Excluded } from '@bohr/shared';
import { assetContentType, hashAsset } from './hash';
import { createIgnoreMatcher } from './ignore';
import { formatBytes, printable } from './log';

/** Cloudflare Workers reject assets larger than 25 MiB. */
export const MAX_ASSET_SIZE = 25 * 1024 * 1024;
/** bohr v1 left out files of 24 MiB or more, saying "too big". */
export const V1_MAX_ASSET_SIZE = 24 * 1024 * 1024;
export { ASSETS_IGNORE_FILE };
/**
 * Set to "true" for the deploy step by the build plan's prepare step (build-plan.ts): the project was migrated
 * from bohr v1, and its assets are published with v1's rules (v1Excluded, V1_MAX_ASSET_SIZE).
 */
export const V1_ASSETS_ENV = 'BOHR_V1_ASSETS';

/** Files wrangler never uploads as assets: the ignore file and the routing metafiles. */
const DEFAULT_IGNORES = [`/${ASSETS_IGNORE_FILE}`, '/_redirects', '/_headers'];
/** A Cloudflare Pages advanced-mode Worker; deploying it as an asset would publish server code. */
const PAGES_WORKER = '_worker.js';

/**
 * Never published, whatever .assetsignore says: a repository's git data (a static site deployed from the
 * repository root) and environment files (.env, .env.production…), files or folders, at any depth. The
 * dispatcher refuses to serve the same paths.
 */
const PRIVATE_NAME = /^\.(git|env)(\..+)?$/i;

export function isPrivatePath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => PRIVATE_NAME.test(segment));
}

/** The files bohr v1 never published (shared with the move to the owner's account, which writes them out). */
export { v1Excluded };

export interface AssetFile {
  /** Manifest key: "/" + POSIX path relative to the assets directory. */
  path: string;
  absolutePath: string;
  hash: string;
  size: number;
  /** Null when the type is unknown; uploads then send application/null. */
  contentType: string | null;
}

export type AssetManifest = Record<string, { hash: string; size: number }>;

export interface AssetsBuild {
  manifest: AssetManifest;
  /** Every file in the manifest, sorted by path. */
  files: AssetFile[];
  totalBytes: number;
  warnings: string[];
  /** Contents of _redirects and _headers at the root of the directory; wrangler sends them with the assets config. */
  redirects?: string;
  headers?: string;
  /** With v1 rules: how many files v1 never published were left out (v1Excluded). */
  v1Skipped: number;
}

export interface ManifestOptions {
  maxAssetSize?: number;
  /**
   * A project migrated from bohr v1 publishes what v1 published: files v1Excluded matches are left out, and files
   * of V1_MAX_ASSET_SIZE or more are skipped with a warning instead of failing the deploy.
   */
  v1?: boolean;
  v1MaxAssetSize?: number;
}

/** Walks the assets directory and builds the manifest exactly like wrangler 4. */
export async function buildAssetManifest(directory: string, options: ManifestOptions = {}): Promise<AssetsBuild> {
  const maxAssetSize = options.maxAssetSize ?? MAX_ASSET_SIZE;
  const v1MaxAssetSize = options.v1MaxAssetSize ?? V1_MAX_ASSET_SIZE;
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(
      `The assets directory ${directory} does not exist. Run the project's build before this action, or fix assets.directory in the wrangler config.`,
    );
  }

  const ignoreFile = await readOptional(join(directory, ASSETS_IGNORE_FILE));
  const userPatterns = ignoreFile === undefined ? [] : ignoreFile.replace(/^﻿/, '').split('\n');
  const isIgnored = createIgnoreMatcher([...DEFAULT_IGNORES, ...userPatterns]);

  const files: AssetFile[] = [];
  const warnings: string[] = [];
  let v1Skipped = 0;

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      const absolutePath = join(absoluteDir, entry.name);
      const key = `/${relativePath}`;

      // The walk never enters a private folder, so the entry's own name is enough
      if (PRIVATE_NAME.test(entry.name)) {
        if (/^\.env/i.test(entry.name))
          warnings.push(`Skipped ${printable(key)}: environment files are never published.`);
        continue;
      }
      if (entry.isSymbolicLink()) {
        if (!isIgnored(relativePath, false) && !isIgnored(relativePath, true)) {
          warnings.push(`Skipped ${printable(key)}: symbolic links are not deployed.`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (isIgnored(relativePath, true)) continue;
        if (relativePath === PAGES_WORKER) {
          warnings.push(`Skipped ${key}/: a Pages _worker.js directory is server code, not an asset.`);
          continue;
        }
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnored(relativePath, false)) continue;
      if (relativePath === PAGES_WORKER) {
        warnings.push(`Skipped ${key}: a Pages _worker.js file is server code, not an asset.`);
        continue;
      }
      if (options.v1 && v1Excluded(relativePath)) {
        v1Skipped++;
        continue;
      }

      const { size } = await stat(absolutePath);
      if (options.v1 && size >= v1MaxAssetSize) {
        warnings.push(
          `Skipped ${printable(key)} (${formatBytes(size)}): bohr v1 did not publish files of ${formatBytes(v1MaxAssetSize)} or more, and neither does this migrated project.`,
        );
        continue;
      }
      if (size > maxAssetSize) throw tooLarge(key, size, maxAssetSize);
      const contents = await readFile(absolutePath);
      if (contents.byteLength > maxAssetSize) throw tooLarge(key, contents.byteLength, maxAssetSize);

      files.push({
        path: key,
        absolutePath,
        hash: hashAsset(contents, relativePath),
        size: contents.byteLength,
        contentType: assetContentType(key),
      });
    }
  };
  await walk(directory, '');

  // bohr v1 opened index.shtm as a folder's page when it had no index.html: the same page goes up as index.html too
  if (options.v1) {
    const paths = new Set(files.map((file) => file.path));
    for (const file of [...files]) {
      if (!/(^|\/)index\.shtm$/i.test(file.path)) continue;
      const alias = file.path.replace(/index\.shtm$/i, 'index.html');
      if (paths.has(alias)) continue;
      const contents = await readFile(file.absolutePath);
      files.push({ ...file, path: alias, hash: hashAsset(contents, alias), contentType: assetContentType(alias) });
      paths.add(alias);
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  const manifest: AssetManifest = {};
  let totalBytes = 0;
  for (const file of files) {
    manifest[file.path] = { hash: file.hash, size: file.size };
    totalBytes += file.size;
  }
  // Read even when .assetsignore lists them, as wrangler does
  const redirects = await readOptional(join(directory, '_redirects'));
  const headers = await readOptional(join(directory, '_headers'));
  return {
    manifest,
    files,
    totalBytes,
    warnings,
    v1Skipped,
    ...(redirects !== undefined ? { redirects } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}

function tooLarge(key: string, size: number, limit: number): Error {
  return new Error(
    `Asset too large: ${printable(key)} is ${size} bytes (${formatBytes(size)}), and Cloudflare Workers accept assets of up to ${limit} bytes (${formatBytes(limit)}). Remove it from the assets directory or list it in ${ASSETS_IGNORE_FILE}.`,
  );
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
