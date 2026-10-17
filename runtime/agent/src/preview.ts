import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PREVIEW_CONFIG_PATH, type PreviewConfig, type PreviewStopReason, previewConfigSchema } from '@bohr/shared';
import { Checkout } from './git';
import { type Logger, silentLogger } from './log';
import { connectLoopback } from './preview-proxy';
import { errorMessage, stripControl, tail, truncate } from './text';

export type PreviewStatus = 'starting' | 'running' | 'failed' | 'stopped';

export interface PreviewState {
  status: PreviewStatus;
  port?: number;
  /** Why it is stopped, when bohr stopped it for a reason of its own (no checkout, no or a bad config). */
  reason?: PreviewStopReason;
  /** Recent output of the install and dev server commands, or why the preview is stopped. */
  log: string;
}

/** What a preview.status event carries. */
export interface PreviewStatusChange {
  status: PreviewStatus;
  port?: number;
  reason?: PreviewStopReason;
  log?: string;
}

export interface PreviewManagerOptions {
  workspace: string;
  onStatus?: (change: PreviewStatusChange) => void;
  log?: Logger;
  /** How long the dev server has to accept connections on its port. */
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Between SIGTERM and SIGKILL when stopping a command. */
  killGraceMs?: number;
  installTimeoutMs?: number;
  maxLogLines?: number;
  /** How a configured command runs; `bash -lc <command>` by default. */
  shell?: (command: string) => { file: string; args: string[] };
  env?: NodeJS.ProcessEnv;
  gitEnv?: NodeJS.ProcessEnv;
}

/** Manifests and lockfiles: when one changes, dependencies are installed again and the dev server restarts. */
const DEPENDENCY_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.npmrc',
  'requirements*.txt',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'Pipfile',
  'Pipfile.lock',
  'Gemfile',
  'Gemfile.lock',
  'go.mod',
  'go.sum',
  'composer.json',
  'composer.lock',
  'Cargo.toml',
  'Cargo.lock',
];

export function isDependencyFile(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? '';
  return DEPENDENCY_FILES.includes(name) || /^requirements.*\.txt$/.test(name);
}

const NOT_CHECKED_OUT = 'The repository is not checked out yet.';

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface Proc {
  child: ChildProcess;
  /** Settles once the process exited and its output was read. */
  done: Promise<Exit>;
}

/**
 * Runs the project's dev server from .bohr/preview.json: installs dependencies when they changed, starts the
 * command in its own process group, and reports `running` once the port accepts connections.
 */
export class PreviewManager {
  private state: { status: PreviewStatus; port?: number; reason?: PreviewStopReason } = { status: 'stopped' };
  private lines: string[] = [];
  private generation = 0;
  private server: Proc | undefined;
  private installer: Proc | undefined;
  /** Dependencies and install command of the last install that succeeded. */
  private installedKey: string | undefined;
  /** Config and dependencies the current dev server started with. */
  private started: { config: string; deps: string } | undefined;
  private installDone: Promise<void> = Promise.resolve();
  private releaseInstall: () => void = () => {};
  private lastNotified: string | undefined;
  private readonly checkout: Checkout;
  private readonly log: Logger;
  private readonly readyTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly killGraceMs: number;
  private readonly installTimeoutMs: number;
  private readonly maxLogLines: number;
  private readonly shell: (command: string) => { file: string; args: string[] };

  constructor(private readonly options: PreviewManagerOptions) {
    this.checkout = new Checkout(options.workspace, options.gitEnv);
    this.log = options.log ?? silentLogger;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 3 * 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.killGraceMs = options.killGraceMs ?? 5000;
    this.installTimeoutMs = options.installTimeoutMs ?? 15 * 60_000;
    this.maxLogLines = options.maxLogLines ?? 200;
    this.shell = options.shell ?? ((command) => ({ file: 'bash', args: ['-lc', command] }));
  }

  status(): PreviewState {
    return { ...this.state, log: this.lines.join('\n') };
  }

  /** Starts the preview if the repository is checked out; otherwise reports it stopped. */
  async boot(): Promise<void> {
    if (await this.checkout.exists()) return this.restart();
    this.stopWith(NOT_CHECKED_OUT, 'no_checkout');
  }

  /** Stops whatever runs and starts again; resolves once the preview runs, failed, or was superseded. */
  restart(): Promise<void> {
    const generation = ++this.generation;
    this.releaseInstall();
    let release = () => {};
    this.installDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releaseInstall = release;
    return this.relaunch(generation, release);
  }

  /**
   * Restarts the preview when its config or dependencies changed, or when it is not running; otherwise leaves
   * it alone, since dev servers reload on their own. Resolves once that is decided.
   */
  async refresh(): Promise<void> {
    const config = await this.readConfig();
    if (!config.ok) {
      if (this.state.status === 'stopped' && this.lines.join('\n') === config.reason) return;
      await this.stop(config.reason, config.code);
      return;
    }
    const deps = await this.dependencyKey();
    const active = this.state.status === 'starting' || this.state.status === 'running';
    if (active && this.started?.config === JSON.stringify(config.config) && this.started.deps === deps) return;
    void this.restart();
  }

  async stop(reason = 'The preview was stopped.', code?: PreviewStopReason): Promise<void> {
    const generation = ++this.generation;
    this.releaseInstall();
    await this.killProcesses();
    if (generation !== this.generation) return;
    this.started = undefined;
    this.stopWith(reason, code);
  }

  /** Resolves once no dependency install is running (or `signal` aborts, rejecting). */
  waitForInstall(signal?: AbortSignal): Promise<void> {
    const done = this.installDone;
    if (!signal) return done;
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      void done.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  private async relaunch(generation: number, release: () => void): Promise<void> {
    try {
      await this.killProcesses();
      if (generation === this.generation) await this.launch(generation, release);
    } catch (error) {
      if (generation === this.generation) {
        this.append(`[bohr] ${errorMessage(error)}`);
        this.setState('failed', this.state.port);
      }
    } finally {
      release();
    }
  }

  private async launch(generation: number, release: () => void): Promise<void> {
    const current = () => generation === this.generation;
    const config = await this.readConfig();
    if (!current()) return;
    if (!config.ok) {
      this.started = undefined;
      this.stopWith(config.reason, config.code);
      return;
    }
    const preview = config.config;
    const deps = await this.dependencyKey();
    if (!current()) return;
    this.lines = [];
    this.started = { config: JSON.stringify(preview), deps };
    this.setState('starting', preview.port);
    const env = this.commandEnv(preview);
    if (preview.install) {
      const installKey = JSON.stringify([deps, preview.install, preview.env ?? {}]);
      if (installKey !== this.installedKey) {
        const installed = await this.install(preview.install, env);
        if (!current()) return;
        if (!installed) {
          this.setState('failed', preview.port);
          return;
        }
        this.installedKey = installKey;
      }
    }
    release();

    await this.waitForFreePort(preview.port, generation);
    if (!current()) return;
    this.append(`$ ${preview.command}`);
    const server = this.spawn(preview.command, env);
    this.server = server;
    void server.done.then((exit) => {
      if (this.server !== server || !current() || this.state.status !== 'running') return;
      this.append(exitLine('The dev server', exit));
      this.setState('failed', preview.port);
    });
    const readiness = await this.waitUntilReady(server, preview.port, generation);
    if (!current()) return;
    if (readiness === 'ready') {
      this.setState('running', preview.port);
      return;
    }
    if (readiness === 'timeout') {
      const seconds = Math.round(this.readyTimeoutMs / 1000);
      this.append(`[bohr] Nothing accepted connections on port ${preview.port} within ${seconds} s.`);
      this.server = undefined;
      await stopTree(server, this.killGraceMs);
    } else {
      this.append(exitLine('The dev server', await server.done));
    }
    if (current()) this.setState('failed', preview.port);
  }

  private install(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    this.append(`$ ${command}`);
    const installer = this.spawn(command, env);
    this.installer = installer;
    const timer = setTimeout(() => {
      this.append(
        `[bohr] The install command did not finish within ${Math.round(this.installTimeoutMs / 60_000)} min.`,
      );
      void stopTree(installer, this.killGraceMs);
    }, this.installTimeoutMs);
    return installer.done.then((exit) => {
      clearTimeout(timer);
      if (this.installer === installer) this.installer = undefined;
      if (exit.code === 0) return true;
      this.append(exitLine('The install command', exit));
      return false;
    });
  }

  private spawn(command: string, env: NodeJS.ProcessEnv): Proc {
    const { file, args } = this.shell(command);
    const child = spawn(file, args, {
      cwd: this.options.workspace,
      env,
      // Its own process group, so stopping it also stops whatever it started.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      stream.setEncoding('utf8');
      let partial = '';
      stream.on('data', (chunk: string) => {
        const parts = (partial + chunk).split('\n');
        partial = parts.pop() ?? '';
        for (const line of parts) this.append(line);
        if (partial.length > 4000) {
          this.append(partial);
          partial = '';
        }
      });
      stream.on('end', () => {
        if (partial) this.append(partial);
        partial = '';
      });
    }
    const done = new Promise<Exit>((resolve) => {
      let closeTimer: NodeJS.Timeout | undefined;
      const finish = () => {
        clearTimeout(closeTimer);
        resolve({ code: child.exitCode, signal: child.signalCode });
      };
      child.once('close', finish);
      // A background process can keep the output pipes open after the command itself exited.
      child.once('exit', () => {
        closeTimer = setTimeout(finish, 1000);
      });
      child.once('error', (error) => {
        this.append(`[bohr] Could not run the command: ${errorMessage(error)}`);
        finish();
      });
    });
    return { child, done };
  }

  private async waitUntilReady(
    server: Proc,
    port: number,
    generation: number,
  ): Promise<'ready' | 'exited' | 'timeout' | 'superseded'> {
    let exited = false;
    void server.done.then(() => {
      exited = true;
    });
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (generation !== this.generation) return 'superseded';
      if (exited) return 'exited';
      if (await canConnect(port)) return 'ready';
      await Promise.race([sleep(this.pollIntervalMs), server.done]);
    }
    return 'timeout';
  }

  /** Gives a dev server that is still shutting down a moment to release the port. */
  private async waitForFreePort(port: number, generation: number): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (generation !== this.generation || !(await canConnect(port))) return;
      await sleep(200);
    }
    this.append(`[bohr] Port ${port} is still in use by another process.`);
  }

  private async killProcesses(): Promise<void> {
    const running = [this.installer, this.server].filter((proc): proc is Proc => proc !== undefined);
    this.installer = undefined;
    this.server = undefined;
    await Promise.all(running.map((proc) => stopTree(proc, this.killGraceMs)));
  }

  private commandEnv(preview: PreviewConfig): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.options.env,
      ...preview.env,
      PORT: String(preview.port),
      HOST: '0.0.0.0',
      BROWSER: 'none',
      CI: '1',
    };
  }

  private async readConfig(): Promise<
    { ok: true; config: PreviewConfig } | { ok: false; reason: string; code: PreviewStopReason }
  > {
    if (!(await this.checkout.exists())) return { ok: false, reason: NOT_CHECKED_OUT, code: 'no_checkout' };
    let text: string;
    try {
      text = await readFile(path.join(this.options.workspace, PREVIEW_CONFIG_PATH), 'utf8');
    } catch {
      return {
        ok: false,
        reason: `${PREVIEW_CONFIG_PATH} was not found, so there is no preview yet.`,
        code: 'not_configured',
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^﻿/, ''));
    } catch (error) {
      return { ok: false, reason: `${PREVIEW_CONFIG_PATH} is not valid JSON: ${errorMessage(error)}`, code: 'invalid' };
    }
    const parsed = previewConfigSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`);
      return { ok: false, reason: `${PREVIEW_CONFIG_PATH} is invalid: ${issues.join('; ')}`, code: 'invalid' };
    }
    return { ok: true, config: parsed.data };
  }

  /** A hash of every dependency manifest and lockfile in the checkout (ignored directories excluded). */
  private async dependencyKey(): Promise<string> {
    let files: string[];
    try {
      const listed = await this.checkout.listFiles(DEPENDENCY_FILES.map((name) => `:(glob)**/${name}`));
      files = listed.filter((file) => !file.split('/').includes('node_modules'));
    } catch {
      files = (await readdir(this.options.workspace).catch(() => [])).filter(isDependencyFile);
    }
    const hash = createHash('sha256');
    for (const file of files.sort()) {
      hash.update(`${file}\0`);
      hash.update(await readFile(path.join(this.options.workspace, file)).catch(() => '-'));
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  private append(raw: string): void {
    // Progress bars redraw with \r; keep what a terminal would show.
    const visible = raw.split('\r').filter(Boolean).at(-1) ?? '';
    this.lines.push(truncate(stripControl(visible), 2000));
    if (this.lines.length > this.maxLogLines) this.lines.splice(0, this.lines.length - this.maxLogLines);
  }

  private stopWith(reason: string, code?: PreviewStopReason): void {
    this.lines = [reason];
    this.setState('stopped', undefined, code);
  }

  private setState(status: PreviewStatus, port?: number, reason?: PreviewStopReason): void {
    this.state = { status, ...(port === undefined ? {} : { port }), ...(reason === undefined ? {} : { reason }) };
    const change: PreviewStatusChange = { ...this.state };
    if (status === 'failed' || status === 'stopped') {
      const log = tail(this.lines.join('\n'), 4000);
      if (log) change.log = log;
    }
    // One event per failure, however many lines its output gains afterwards.
    const key = JSON.stringify(status === 'failed' ? this.state : change);
    if (key === this.lastNotified) return;
    this.lastNotified = key;
    this.log.info('preview status', { status, port });
    this.options.onStatus?.(change);
  }
}

function exitLine(what: string, exit: Exit): string {
  if (exit.signal) return `[bohr] ${what} stopped (${exit.signal}).`;
  if (exit.code === null) return `[bohr] ${what} could not run.`;
  return `[bohr] ${what} exited with code ${exit.code}.`;
}

/** Stops a command and everything it started: SIGTERM to its process group, SIGKILL after the grace period. */
async function stopTree(proc: Proc, graceMs: number): Promise<void> {
  const pid = proc.child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    if (proc.child.exitCode === null && proc.child.signalCode === null) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    await Promise.race([proc.done, sleep(graceMs)]);
    return;
  }
  signalGroup(pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && groupAlive(pid)) await sleep(100);
  if (groupAlive(pid)) signalGroup(pid, 'SIGKILL');
  await Promise.race([proc.done, sleep(1000)]);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already.
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether something accepts connections on the loopback (IPv4 or IPv6: "localhost" may be either). */
async function canConnect(port: number, timeoutMs = 1000): Promise<boolean> {
  const socket = await connectLoopback(port, timeoutMs);
  socket?.destroy();
  return socket !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
