import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// GitHub refuses to load an action whose action.yml has unknown keys (every run of every repository using it
// fails at "Set up job"), so the file's shape is checked here.
const lines = readFileSync(new URL('../action.yml', import.meta.url), 'utf8').split(/\r?\n/);

/** The keys indented by two spaces under a top-level key. */
function keysUnder(section: string): string[] {
  const start = lines.indexOf(`${section}:`);
  if (start === -1) return [];
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}([A-Za-z0-9_-]+):/.exec(line)?.[1];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

describe('action.yml', () => {
  it('only has the keys GitHub accepts', () => {
    const top = lines.map((line) => /^([A-Za-z0-9_-]+):/.exec(line)?.[1]).filter((key) => key !== undefined);
    expect(
      top.every((key) => ['name', 'description', 'author', 'branding', 'inputs', 'outputs', 'runs'].includes(key)),
    ).toBe(true);
    expect(keysUnder('runs').sort()).toEqual(['main', 'using']);
  });

  it('keeps the inputs and outputs workflows use (the CLI behind it reads and sets these)', () => {
    expect(keysUnder('inputs')).toEqual(['instance-url', 'working-directory', 'credentials', 'build-plan', 'phase']);
    expect(keysUnder('outputs')).toEqual([
      'url',
      'deployment-id',
      'cloudflare-api-token',
      'cloudflare-account-id',
      'found',
      'node-version',
      'install',
      'build',
      'live',
    ]);
    expect(lines).toContain('  using: node24');
    expect(lines).toContain('  main: dist/index.js');
  });

  it('declares every output once', () => {
    const outputs = keysUnder('outputs');
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(outputs).toEqual(expect.arrayContaining(['found', 'node-version', 'install', 'build', 'live']));
  });
});
