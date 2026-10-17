// Bundles provision-spike.ts (it imports packages/cloudflare's TypeScript) and runs it with Node.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const out = mkdtempSync(path.join(tmpdir(), 'bohr-spike-'));
const file = path.join(out, 'spike.mjs');
await build({
  entryPoints: [path.join(here, 'provision-spike.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: file,
  logLevel: 'warning',
});
try {
  await import(pathToFileURL(file).href);
} finally {
  rmSync(out, { recursive: true, force: true });
}
