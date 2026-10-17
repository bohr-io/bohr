// Wrangler resolves packages the way browsers do, so a package's "browser" field swaps parts of it for empty
// modules. With nodejs_compat a Worker runs the Node side of some packages anyway: iconv-lite (Express's body
// parser) finds require('stream') working, then calls its swapped-out ./lib/streams ("require_streams(...) is not a
// function") and the Worker fails to start. While wrangler bundles, those swaps are taken out of the package.json
// files that make them, and the files are put back as they were afterwards.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Package name: the "browser" field entries that swap out code a Worker with nodejs_compat runs. */
export const BROWSER_SWAPS: Record<string, string[]> = {
  'iconv-lite': ['./lib/streams', './lib/extend-node'],
};

/** Folders never searched for node_modules. */
const SKIPPED = new Set(['.git', '.wrangler', 'dist', '.turbo']);
const MAX_DEPTH = 6;

/** Every installed copy of the packages in BROWSER_SWAPS under `root` (nested and pnpm layouts included). */
export async function findSwappingPackages(root: string): Promise<string[]> {
  const found: string[] = [];
  const list = async (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

  // A node_modules folder: its packages (scoped too), pnpm's store, and each package's own node_modules
  const scanModules = async (modules: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    for (const entry of await list(modules)) {
      if (!entry.isDirectory()) continue;
      const path = join(modules, entry.name);
      if (entry.name === '.pnpm') {
        for (const store of await list(path)) {
          if (store.isDirectory()) await scanModules(join(path, store.name, 'node_modules'), depth + 1);
        }
      } else if (entry.name.startsWith('@')) {
        for (const scoped of await list(path)) {
          if (scoped.isDirectory()) await scanModules(join(path, scoped.name, 'node_modules'), depth + 1);
        }
      } else {
        if (entry.name in BROWSER_SWAPS) found.push(path);
        await scanModules(join(path, 'node_modules'), depth + 1);
      }
    }
  };

  // The project's folders, down to their node_modules (a backend in api/core has its own)
  const scanProject = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    for (const entry of await list(dir)) {
      if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.name === 'node_modules') await scanModules(path, 0);
      else await scanProject(path, depth + 1);
    }
  };

  await scanProject(root, 0);
  return [...new Set(found)];
}

/**
 * Runs `work` (wrangler's bundling) with the swaps of BROWSER_SWAPS taken out of the installed packages under
 * `root`, then puts every package.json back exactly as it was, whatever `work` did.
 */
export async function withNodeSidesOfPackages<T>(
  root: string,
  work: () => Promise<T>,
  log?: (message: string) => void,
): Promise<T> {
  const restore: { path: string; original: string }[] = [];
  try {
    for (const dir of await findSwappingPackages(root)) {
      const path = join(dir, 'package.json');
      const original = await readFile(path, 'utf8').catch(() => null);
      if (original === null) continue;
      let manifest: { name?: string; browser?: unknown };
      try {
        manifest = JSON.parse(original);
      } catch {
        continue;
      }
      const swaps = BROWSER_SWAPS[manifest.name ?? ''];
      const browser = manifest.browser;
      if (swaps === undefined || browser === null || typeof browser !== 'object') continue;
      const field = browser as Record<string, unknown>;
      const taken = swaps.filter((key) => key in field || `${key}.js` in field);
      if (taken.length === 0) continue;
      for (const key of taken) {
        delete field[key];
        delete field[`${key}.js`];
      }
      restore.push({ path, original });
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    if (restore.length > 0) {
      log?.(
        `Bundling the Node.js side of ${restore.length} package(s) that Workers run with nodejs_compat (iconv-lite).`,
      );
    }
    return await work();
  } finally {
    for (const { path, original } of restore) await writeFile(path, original).catch(() => {});
  }
}
