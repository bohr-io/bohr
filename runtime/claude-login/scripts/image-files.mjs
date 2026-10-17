// Writes the files the container image installs next to dist/server.mjs:
// - dist/package.json, which installs only the Claude Code CLI: the Agent SDK's native linux-x64 package, at the
//   version the agent's SDK pins (the binary the agent runs, found the same way);
// - dist/THIRD_PARTY_LICENSES.txt, the license of every package esbuild put in the bundle.
// Usage: node scripts/image-files.mjs <esbuild metafile>
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { bundleLicenses } from '../../agent/scripts/licenses.mjs';

const SDK = '@anthropic-ai/claude-agent-sdk';
// Cloudflare Containers run linux/amd64 images
const NATIVE = `${SDK}-linux-x64`;
const metafile = process.argv[2];
if (!metafile) throw new Error('usage: node scripts/image-files.mjs <metafile>');

const own = JSON.parse(readFileSync('package.json', 'utf8'));
const agent = JSON.parse(readFileSync('../agent/package.json', 'utf8'));
const sdkVersion = agent.dependencies[SDK];
// The SDK pins its native packages; they are released with the same version
let nativeVersion = sdkVersion;
try {
  const sdk = JSON.parse(readFileSync(`../agent/node_modules/${SDK}/package.json`, 'utf8'));
  nativeVersion = sdk.optionalDependencies?.[NATIVE] ?? sdkVersion;
} catch {
  // Not installed: the SDK's own version
}
const manifest = {
  name: 'bohr-claude-login',
  version: own.version,
  private: true,
  license: own.license,
  dependencies: { [NATIVE]: nativeVersion },
};
writeFileSync('dist/package.json', `${JSON.stringify(manifest, null, 2)}\n`);

const licenses = bundleLicenses(metafile, 'server.mjs');
writeFileSync('dist/THIRD_PARTY_LICENSES.txt', licenses.text);
rmSync(metafile);
console.log(`dist/package.json: ${NATIVE}@${nativeVersion}; THIRD_PARTY_LICENSES.txt: ${licenses.count}`);
