import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_PACKAGE, cliEntry, installation, invocation, run } from '../src/main';

const RUNNER_NODE = join('/runner', 'externals', 'node24', 'bin', 'node');
const BUNDLED_NPM = join('/runner', 'externals', 'node24', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

describe('the action wrapper', () => {
  it("installs the latest CLI with the npm of the runner's own Node.js, into the given folder", () => {
    const install = installation(
      '/tmp/bohr-cli-x',
      { PATH: '/usr/bin' },
      {
        execPath: RUNNER_NODE,
        exists: (path) => path === BUNDLED_NPM,
      },
    );
    expect(CLI_PACKAGE).toBe('bohr@latest');
    expect(install).toMatchObject({
      command: RUNNER_NODE,
      args: [
        BUNDLED_NPM,
        'install',
        '--prefix',
        '/tmp/bohr-cli-x',
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        'bohr@latest',
      ],
      shell: false,
    });
  });

  it('falls back to npm on PATH, through a shell on Windows, and installs another release when asked', () => {
    const install = installation(
      'D:\\t',
      { BOHR_CLI_PACKAGE: 'bohr@4.0.0' },
      {
        execPath: 'C:\\runner\\node.exe',
        platform: 'win32',
        exists: () => false,
      },
    );
    expect(install).toMatchObject({ command: 'npm', shell: true });
    expect(install.args.at(-1)).toBe('bohr@4.0.0');
  });

  it("starts the installed CLI's action command with this Node.js, no shell, and the step's environment", () => {
    const prefix = '/tmp/p';
    const entry = cliEntry(prefix, () => JSON.stringify({ bin: { bohr: 'dist/bohr.mjs' } }));
    expect(entry).toBe(join(prefix, 'node_modules', 'bohr', 'dist', 'bohr.mjs'));
    const env = { PATH: '/usr/bin', 'INPUT_BUILD-PLAN': 'true', GITHUB_OUTPUT: '/tmp/out' };
    const start = invocation(entry, env, { execPath: RUNNER_NODE, cwd: '/home/runner/work/site' });
    expect(start).toMatchObject({ command: RUNNER_NODE, args: [entry, 'action'], shell: false });
    expect(start.env).toMatchObject({
      'INPUT_BUILD-PLAN': 'true',
      GITHUB_OUTPUT: '/tmp/out',
      BOHR_ACTION_CWD: '/home/runner/work/site',
      BOHR_ACTION_PATH: '/usr/bin',
    });
  });

  it('delivers inputs whose names have a hyphen (sh would drop them) to the CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bohr-wrapper-'));
    const script = join(dir, 'cli.mjs');
    const out = join(dir, 'out.json');
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: process.argv.slice(2), plan: process.env['INPUT_BUILD-PLAN'], url: process.env['INPUT_INSTANCE-URL'] }));`,
    );
    const env = { ...process.env, 'INPUT_BUILD-PLAN': 'true', 'INPUT_INSTANCE-URL': 'https://bohr.example' };
    expect(await run(invocation(script, env))).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      args: ['action'],
      plan: 'true',
      url: 'https://bohr.example',
    });
  });

  it("fails the step with the CLI's exit code, or when the command cannot start", async () => {
    const node = process.execPath;
    expect(await run({ command: node, args: ['-e', 'process.exit(3)'], env: process.env, shell: false })).toBe(3);
    expect(await run({ command: node, args: ['-e', ''], env: process.env, shell: false })).toBe(0);
    expect(await run({ command: join(__dirname, 'no-such-node'), args: [], env: process.env, shell: false })).toBe(1);
  });
});
