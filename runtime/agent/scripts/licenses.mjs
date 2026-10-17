// The license of every package esbuild put in a bundle, read from its metafile; shared by the image-files
// scripts of runtime/agent and runtime/claude-login.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** THIRD_PARTY_LICENSES.txt's text for `bundle` (the file name), and how many packages it lists. */
export function bundleLicenses(metafile, bundle) {
  // The innermost node_modules/<name> (or node_modules/@scope/name) of each bundled file
  const { inputs } = JSON.parse(readFileSync(metafile, 'utf8'));
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
  return {
    text: `${bundle} bundles the packages below.\n\n${unique.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
    count: unique.length,
  };
}
