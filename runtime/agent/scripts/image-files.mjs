// Writes the files the container image installs next to dist/runner.mjs:
// - dist/package.json, which installs only the Claude Agent SDK, at the version this package pins;
// - dist/THIRD_PARTY_LICENSES.txt, the license of every package esbuild put in the bundle.
// Usage: node scripts/image-files.mjs <esbuild metafile>
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { bundleLicenses } from './licenses.mjs';

const SDK = '@anthropic-ai/claude-agent-sdk';
const metafile = process.argv[2];
if (!metafile) throw new Error('usage: node scripts/image-files.mjs <metafile>');

const own = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = {
  name: 'bohr-agent-runner',
  version: own.version,
  private: true,
  license: own.license,
  dependencies: { [SDK]: own.dependencies[SDK] },
};
writeFileSync('dist/package.json', `${JSON.stringify(manifest, null, 2)}\n`);

const licenses = bundleLicenses(metafile, 'runner.mjs');
writeFileSync('dist/THIRD_PARTY_LICENSES.txt', licenses.text);
rmSync(metafile);
console.log(`dist/package.json: ${SDK}@${manifest.dependencies[SDK]}; THIRD_PARTY_LICENSES.txt: ${licenses.count}`);
