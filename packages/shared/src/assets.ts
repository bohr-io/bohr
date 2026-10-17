/** The file wrangler reads, in the assets directory, for the files it must not publish (gitignore syntax). */
export const ASSETS_IGNORE_FILE = '.assetsignore';

/**
 * The files bohr v1 never published, by their path from the assets directory: its deploy walked the folder and
 * skipped these (cli/src/commands/deploy.ts in bohr v1). The bohr CLI applies them to projects migrated from v1
 * (BOHR_V1_ASSETS), and the move to the owner's account writes them into an .assetsignore for wrangler.
 */
export const V1_ASSET_EXCLUSIONS = {
  /** Folders left out at any depth. */
  folders: ['.git', '.github', '.worker', '.turbo', 'node_modules', 'turborepo-cache'],
  /** Folders left out at the root of the assets directory only. */
  rootFolders: ['api', 'dist-api'],
  /** Path endings left out; one starting with "/" is a whole file name. */
  endings: ['.env', '/package.json', '/package-lock.json', '/yarn.lock', '/.yarnrc', '/.gitignore', 'next.conf.js'],
} as const;

/**
 * Whether bohr v1 left a file out (V1_ASSET_EXCLUSIONS). It compared a lowercased path, so its "README.md" rule
 * never matched anything, and README.md files were published: they still are.
 */
export function v1Excluded(relativePath: string): boolean {
  const path = `/${relativePath}`.toLowerCase();
  return (
    V1_ASSET_EXCLUSIONS.folders.some((folder) => path.includes(`/${folder}/`)) ||
    V1_ASSET_EXCLUSIONS.rootFolders.some((folder) => path.startsWith(`/${folder}/`)) ||
    V1_ASSET_EXCLUSIONS.endings.some((end) => path.endsWith(end))
  );
}

/**
 * The .assetsignore bohr writes into the assets directory of a site moving to its owner's account: what is
 * never public (git data, environment files, dependencies, workflows, bohr's and wrangler's own files) and what
 * bohr v1 never published. wrangler matches it case-insensitively, as v1 did.
 */
export function assetsIgnoreFile(): string {
  const lines = [
    '# Written by bohr when the site moved to your Cloudflare account: files `wrangler deploy` does not publish.',
    '# bohr never changes this file again; edit it freely.',
    '.git',
    '.env*',
    '.dev.vars*',
    'node_modules',
    '.github',
    '.bohr',
    '.wrangler',
    'wrangler.json*',
    'wrangler.toml',
    '# What bohr v1 never published',
    ...V1_ASSET_EXCLUSIONS.folders.map((folder) => `${folder}/`),
    ...V1_ASSET_EXCLUSIONS.rootFolders.map((folder) => `/${folder}/`),
    ...V1_ASSET_EXCLUSIONS.endings.map((end) => (end.startsWith('/') ? end.slice(1) : `*${end}`)),
  ];
  return `${lines.join('\n')}\n`;
}
