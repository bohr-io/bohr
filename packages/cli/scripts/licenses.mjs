// Writes dist/THIRD_PARTY_LICENSES.txt with the license of every package esbuild put in the bundle.
// Usage: node scripts/licenses.mjs <esbuild metafile>
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const metafile = process.argv[2];
if (!metafile) throw new Error('usage: node scripts/licenses.mjs <metafile>');
const { inputs } = JSON.parse(readFileSync(metafile, 'utf8'));

// The innermost node_modules/<name> (or node_modules/@scope/name) of each bundled file
const packageDirs = new Set();
for (const input of Object.keys(inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll(path.sep, '/'));
  if (match) packageDirs.add(match[1]);
}

const sections = [];
for (const dir of [...packageDirs].sort()) {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(dir).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  const text = licenseFile ? readFileSync(path.join(dir, licenseFile), 'utf8').trim() : `License: ${pkg.license}`;
  sections.push(`${pkg.name}@${pkg.version} (${pkg.license})\n\n${text}`);
}
const unique = [...new Set(sections)];
writeFileSync(
  'dist/THIRD_PARTY_LICENSES.txt',
  `dist/bohr.mjs bundles the packages below.\n\n${unique.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
);
rmSync(metafile);
console.log(`dist/THIRD_PARTY_LICENSES.txt: ${unique.length} packages`);
