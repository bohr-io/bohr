import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { AGENT_PORT } from '@bohr/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreviewManager, type PreviewManagerOptions, type PreviewStatusChange } from '../src/preview';
import { git, gitAvailable, isolatedGitEnv, removeDir, tempDir, waitFor } from './helpers';

const SCRIPTS: Record<string, string> = {
  'server.cjs': `
const http = require('node:http');
const fs = require('node:fs');
fs.appendFileSync('pids.log', process.pid + '\\n');
const port = Number(process.env.PORT);
http.createServer((req, res) => res.end('ok')).listen(port, '0.0.0.0', () => {
  console.log('listening on ' + port + ' HOST=' + process.env.HOST + ' CI=' + process.env.CI + ' GREETING=' + process.env.GREETING);
  if (process.env.CRASH_AFTER_MS) setTimeout(() => { console.error('crashing now'); process.exit(5); }, Number(process.env.CRASH_AFTER_MS));
});
`,
  'fail.cjs': `console.error("Error: Cannot find module 'vite'"); process.exit(3);`,
  'silent.cjs': `require('node:fs').appendFileSync('pids.log', process.pid + '\\n'); setInterval(() => {}, 1000);`,
  'install.cjs': `
setTimeout(() => {
  require('node:fs').appendFileSync('install.log', 'installed\\n');
  console.log('added 1 package');
}, Number(process.env.INSTALL_DELAY_MS || 0));
`,
};

/** Runs "server.cjs" as `node server.cjs`, the same way on every OS. */
const nodeShell = (command: string) => ({ file: process.execPath, args: command.split(' ') });

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return (await response.text()) === 'ok';
  } catch {
    return false;
  }
}

describe.skipIf(!gitAvailable)('PreviewManager', () => {
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let changes: PreviewStatusChange[];
  let port: number;
  let manager: PreviewManager | undefined;

  beforeEach(async () => {
    workspace = tempDir('bohr-preview-');
    env = isolatedGitEnv(workspace);
    git(['init', '--quiet'], workspace, env);
    mkdirSync(path.join(workspace, '.bohr'));
    for (const [name, script] of Object.entries(SCRIPTS)) writeFileSync(path.join(workspace, name), script);
    writeFileSync(path.join(workspace, 'package.json'), '{ "name": "site" }\n');
    changes = [];
    port = await freePort();
  });

  afterEach(async () => {
    await manager?.stop();
    manager = undefined;
    removeDir(workspace);
  });

  function create(options: Partial<PreviewManagerOptions> = {}): PreviewManager {
    manager = new PreviewManager({
      workspace,
      onStatus: (change) => changes.push(change),
      shell: nodeShell,
      readyTimeoutMs: 20_000,
      pollIntervalMs: 50,
      killGraceMs: 2000,
      gitEnv: env,
      ...options,
    });
    return manager;
  }

  const configure = (config: unknown) =>
    writeFileSync(path.join(workspace, '.bohr', 'preview.json'), JSON.stringify(config));
  const pids = () =>
    existsSync(path.join(workspace, 'pids.log'))
      ? readFileSync(path.join(workspace, 'pids.log'), 'utf8').split('\n').filter(Boolean).map(Number)
      : [];
  const installs = () =>
    existsSync(path.join(workspace, 'install.log'))
      ? readFileSync(path.join(workspace, 'install.log'), 'utf8').split('\n').filter(Boolean).length
      : 0;

  it('is stopped, with the reason, until there is a checkout and a valid config', async () => {
    const bare = tempDir('bohr-preview-empty-');
    try {
      const empty = new PreviewManager({ workspace: bare, onStatus: (change) => changes.push(change) });
      await empty.boot();
      const stopped = { status: 'stopped', reason: 'no_checkout', log: 'The repository is not checked out yet.' };
      expect(empty.status()).toEqual(stopped);
      expect(changes).toEqual([stopped]);
    } finally {
      removeDir(bare);
    }

    const preview = create();
    await preview.refresh();
    expect(preview.status().log).toBe('.bohr/preview.json was not found, so there is no preview yet.');
    // The project Worker tells "not set up yet" apart from a preview that is starting
    expect(changes.at(-1)).toMatchObject({ status: 'stopped', reason: 'not_configured' });
    configure({ command: 'server.cjs', port: AGENT_PORT });
    await preview.refresh();
    expect(preview.status()).toMatchObject({ status: 'stopped', reason: 'invalid' });
    expect(preview.status().log).toMatch(/^\.bohr\/preview\.json is invalid: port: Port 4840 is reserved/);
    writeFileSync(path.join(workspace, '.bohr', 'preview.json'), '{ nope');
    await preview.refresh();
    expect(preview.status().log).toMatch(/is not valid JSON/);
    expect(changes.every((change) => change.status === 'stopped')).toBe(true);
  });

  it('starts the dev server with the config env and reports it running', async () => {
    configure({ command: 'server.cjs', port, env: { GREETING: 'hi' } });
    const preview = create();
    await preview.boot();

    expect(preview.status()).toMatchObject({ status: 'running', port });
    expect(changes).toEqual([
      { status: 'starting', port },
      { status: 'running', port },
    ]);
    expect(await answers(port)).toBe(true);
    await waitFor(() => preview.status().log.includes('GREETING=hi'), 5000, 'the server output');
    expect(preview.status().log).toContain(`listening on ${port} HOST=0.0.0.0 CI=1 GREETING=hi`);
    expect(preview.status().log.startsWith('$ server.cjs')).toBe(true);

    await preview.stop();
    expect(preview.status().status).toBe('stopped');
    expect(changes.at(-1)).toEqual({ status: 'stopped', log: 'The preview was stopped.' });
    expect(await answers(port)).toBe(false);
    await waitFor(() => pids().every((pid) => !alive(pid)), 5000, 'the server to exit');
  });

  it('restarts on request, replacing the old process', async () => {
    configure({ command: 'server.cjs', port });
    const preview = create();
    await preview.boot();
    await preview.restart();

    expect(preview.status()).toMatchObject({ status: 'running', port });
    expect(changes.map((change) => change.status)).toEqual(['starting', 'running', 'starting', 'running']);
    const [first, second] = pids();
    expect(first && alive(first)).toBe(false);
    expect(second && alive(second)).toBe(true);
    expect(await answers(port)).toBe(true);
  });

  it('installs dependencies at the first start and again only when they change', async () => {
    configure({ install: 'install.cjs', command: 'server.cjs', port });
    const preview = create();
    await preview.boot();
    expect(installs()).toBe(1);
    expect(preview.status().log).toContain('$ install.cjs');

    await preview.restart();
    expect(installs()).toBe(1);

    await preview.refresh();
    expect(pids()).toHaveLength(2);

    writeFileSync(path.join(workspace, 'package.json'), '{ "name": "site", "dependencies": { "vue": "3.5.0" } }\n');
    await preview.refresh();
    await waitFor(() => pids().length === 3 && preview.status().status === 'running', 20_000, 'the restart');
    expect(installs()).toBe(2);

    configure({ install: 'install.cjs', command: 'server.cjs', port, env: { GREETING: 'changed' } });
    await preview.refresh();
    await waitFor(() => preview.status().log.includes('GREETING=changed'), 20_000, 'the new config');
  });

  it('lets a job wait for an install in progress', async () => {
    configure({ install: 'install.cjs', command: 'server.cjs', port, env: { INSTALL_DELAY_MS: '800' } });
    const preview = create();
    const started = preview.restart();
    await waitFor(() => preview.status().log.includes('$ install.cjs'), 5000, 'the install');
    expect(installs()).toBe(0);
    await preview.waitForInstall();
    expect(installs()).toBe(1);
    await started;

    // A changed install environment means installing again; a cancelled job stops waiting for it.
    configure({ install: 'install.cjs', command: 'server.cjs', port, env: { INSTALL_DELAY_MS: '1500' } });
    const restarting = preview.restart();
    await waitFor(() => preview.status().status === 'starting', 5000, 'the second install');
    const job = new AbortController();
    const waiting = preview.waitForInstall(job.signal);
    job.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
    await restarting;
    expect(installs()).toBe(2);
  });

  it('fails with the output when the dev server exits before it is ready', async () => {
    configure({ command: 'fail.cjs', port });
    const preview = create();
    await preview.boot();

    expect(preview.status().status).toBe('failed');
    const failure = changes.at(-1);
    expect(failure).toMatchObject({ status: 'failed', port });
    expect(failure?.log).toContain("Error: Cannot find module 'vite'");
    expect(failure?.log).toContain('[bohr] The dev server exited with code 3.');
  });

  it('fails when nothing accepts connections in time, and stops the command', async () => {
    configure({ command: 'silent.cjs', port });
    const preview = create({ readyTimeoutMs: 1500 });
    await preview.boot();

    expect(preview.status().status).toBe('failed');
    expect(preview.status().log).toContain(`Nothing accepted connections on port ${port} within 2 s.`);
    await waitFor(() => pids().length === 1 && !alive(pids()[0] ?? 0), 5000, 'the command to stop');
  });

  it('reports a dev server that crashes after it was running', async () => {
    configure({ command: 'server.cjs', port, env: { CRASH_AFTER_MS: '700' } });
    const preview = create();
    await preview.boot();
    expect(preview.status().status).toBe('running');
    await waitFor(() => preview.status().status === 'failed', 10_000, 'the crash');
    expect(changes.at(-1)?.log).toContain('crashing now');
    expect(changes.at(-1)?.log).toContain('[bohr] The dev server exited with code 5.');

    // A refresh after a crash starts it again.
    configure({ command: 'server.cjs', port });
    await preview.refresh();
    await waitFor(() => preview.status().status === 'running', 20_000, 'the new start');
  });

  it.skipIf(process.platform === 'win32')('runs commands with bash and stops their whole process group', async () => {
    const node = JSON.stringify(process.execPath);
    configure({ command: `${node} server.cjs & wait`, port });
    const preview = create({ shell: undefined });
    await preview.boot();
    expect(preview.status().status).toBe('running');
    const [server] = pids();
    expect(server && alive(server)).toBe(true);

    await preview.stop();
    await waitFor(() => !alive(server ?? 0), 5000, 'the background server to stop');
    expect(await answers(port)).toBe(false);
  });
});
