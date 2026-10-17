// Bundles the CLI into one file with no dependencies to install (dist/bohr.mjs), so `npx bohr` starts fast, then
// writes the licenses of the bundled packages next to it (dist/THIRD_PARTY_LICENSES.txt).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [path.join(root, 'src/bin.ts')],
  outfile: path.join(root, 'dist/bohr.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  mainFields: ['module', 'main'],
  // Some bundled packages are CommonJS and call require()
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __bohrCreateRequire } from 'node:module'; const require = __bohrCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  // Smaller to download on every `npx bohr`; names are kept, so stack traces (BOHR_DEBUG=1) stay readable
  minifyWhitespace: true,
  minifySyntax: true,
  metafile: true,
  logLevel: 'warning',
});
writeFileSync(path.join(root, 'dist/meta.json'), JSON.stringify(result.metafile));
execFileSync(process.execPath, [path.join(root, 'scripts/licenses.mjs'), 'dist/meta.json'], {
  cwd: root,
  stdio: 'inherit',
});
