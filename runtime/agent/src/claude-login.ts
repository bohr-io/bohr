import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { claudeLoginCodeSchema } from '@bohr/shared';
import { type Logger, silentLogger } from './log';
import { errorMessage, oneLine, truncate } from './text';

// Connects the owner's Claude subscription with the official Claude Code CLI: `claude setup-token` runs here,
// in the project's own container or in the instance's dedicated sign-in container (runtime/claude-login, which
// reuses this module), and performs the whole OAuth flow itself. bohr only relays the
// authorization URL the CLI prints and the code the user pastes back, and reads the long-lived token the CLI
// prints at the end. The CLI's output and the token are never logged.

export type ClaudeLoginErrorStatus = 400 | 404 | 409 | 422 | 502 | 504;

export class ClaudeLoginError extends Error {
  constructor(
    readonly status: ClaudeLoginErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeLoginError';
  }
}

const SDK = '@anthropic-ai/claude-agent-sdk';

/** Linux without glibc (Alpine): the SDK prefers its musl build there. */
function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return report !== undefined && report.header?.glibcVersionRuntime === undefined;
}

export interface BinaryLookup {
  platform?: string;
  arch?: string;
  musl?: boolean;
  /** Resolves a module path; from the SDK's own directory by default. */
  resolve?: (id: string) => string;
  exists?: (file: string) => boolean;
}

/**
 * The official CLI the Agent SDK runs: the native binary in the SDK's optional dependency for this platform,
 * found the way the SDK finds it (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude`).
 */
export function resolveClaudeBinary(lookup: BinaryLookup = {}): string {
  const platform = lookup.platform ?? process.platform;
  const arch = lookup.arch ?? process.arch;
  const musl = lookup.musl ?? isMusl();
  const exists = lookup.exists ?? existsSync;
  let resolve = lookup.resolve;
  if (resolve === undefined) {
    // From the SDK's directory, like the SDK itself, so pnpm's nested layout works too
    const sdkEntry = createRequire(import.meta.url).resolve(SDK);
    resolve = createRequire(sdkEntry).resolve;
  }
  const linux = [`${SDK}-linux-${arch}`, `${SDK}-linux-${arch}-musl`];
  const packages = platform === 'linux' ? (musl ? linux.reverse() : linux) : [`${SDK}-${platform}-${arch}`];
  const file = platform === 'win32' ? 'claude.exe' : 'claude';
  for (const name of packages) {
    try {
      const candidate = resolve(`${name}/${file}`);
      if (exists(candidate)) return candidate;
    } catch {
      // Not installed for this variant; try the next one
    }
  }
  throw new Error(`The Claude Code CLI for ${platform}-${arch} is not installed (${SDK}'s native dependency).`);
}

export type LoginCommand = (cliPath: string) => { file: string; args: string[] };

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * setup-token draws an interactive terminal interface and prints nothing without a terminal: util-linux
 * `script` gives it a pseudo-terminal, wide enough that the long authorization URL and the token never wrap.
 */
export const pseudoTerminalCommand: LoginCommand = (cliPath) => ({
  file: 'script',
  args: ['-qfec', `stty cols 4000 rows 50; exec ${shellQuote(cliPath)} setup-token`, '/dev/null'],
});

/**
 * The CLI's environment: a fresh HOME (no stored credentials or settings), no browser, and nothing that would
 * make it authenticate differently or talk to other endpoints (every ANTHROPIC_* and CLAUDE* variable goes,
 * including the agent's placeholders and OAuth endpoint overrides).
 */
export function loginEnvironment(inherited: NodeJS.ProcessEnv, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  const dropped = new Set(['HOME', 'USERPROFILE', 'BROWSER', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']);
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined || dropped.has(name) || /^(ANTHROPIC_|CLAUDE)/i.test(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    // There is no browser in the container; the user opens the link in the panel
    BROWSER: 'true',
    TERM: 'xterm-256color',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

const ESC = '\u001b';
const BEL = '\u0007';
/** Operating system commands, such as hyperlinks (the URL is also printed as text). */
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*([@-~])`, 'g');
const OTHER_ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]?`, 'g');
const CONTROL = /[^\P{Cc}\n\t]/gu;

/** Terminal output as plain lines: hyperlinks and colors removed, cursor movements turned into line breaks. */
export function terminalText(raw: string): string {
  return raw
    .replace(OSC, '')
    .replace(CSI, (_, final: string) => (final === 'm' ? '' : final === 'C' ? ' ' : '\n'))
    .replace(OTHER_ESCAPE, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '');
}

/** The authorization URL: claude.ai, claude.com or platform.claude.com, whichever the CLI uses. */
const AUTHORIZE_URL = /https:\/\/[^\s"'<>]*\/oauth\/authorize\?[^\s"'<>]+(?=\s)/;
const TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/;
const PASTE_PROMPT = /paste code/i;
const ERROR_LINE = /\b(error|failed|failure|invalid|expired|denied|unable)\b/i;

export function findAuthorizeUrl(text: string): string | undefined {
  const match = AUTHORIZE_URL.exec(text)?.[0];
  if (match === undefined) return undefined;
  try {
    return new URL(match).protocol === 'https:' ? match : undefined;
  } catch {
    return undefined;
  }
}

const textLines = (text: string) =>
  text
    .split('\n')
    .map((line) => oneLine(line))
    .filter((line) => line !== '');

/**
 * The last line of the CLI's output that explains a failure, without anything secret in it. Lines in
 * `ignore` (what the screen showed before the code was sent) do not count.
 */
export function lastErrorLine(text: string, code?: string, ignore?: ReadonlySet<string>): string | undefined {
  const lines = textLines(text).filter(
    (line) => !/sk-ant-|https?:\/\//i.test(line) && (code === undefined || !line.includes(code)) && !ignore?.has(line),
  );
  const line = lines.filter((candidate) => ERROR_LINE.test(candidate)).at(-1);
  return line === undefined ? undefined : truncate(line, 300);
}

export interface ClaudeLoginOptions {
  /** The official CLI; the Agent SDK's native binary by default. */
  cliPath?: string | (() => string);
  /** How `setup-token` is started; inside a pseudo-terminal by default. */
  command?: LoginCommand;
  /** The environment the CLI's environment is derived from; the runner's by default. */
  env?: NodeJS.ProcessEnv;
  /** Parent of the temporary HOME directories; the OS temp directory by default. */
  tempRoot?: string;
  log?: Logger;
  /** How long start() waits for the authorization URL. */
  startTimeoutMs?: number;
  /** How long finish() waits for the token after sending the code. */
  finishTimeoutMs?: number;
  /** How long finish() waits for the CLI's code prompt before sending the code anyway. */
  promptTimeoutMs?: number;
  /** A sign-in the user does not finish ends after this long. */
  ttlMs?: number;
}

interface ActiveLogin {
  id: string;
  child: ChildProcess;
  home: string;
  /** Raw output (the most recent part), and the output since the code was sent. */
  output: string;
  sinceCode: string;
  exited: boolean;
  spawnError?: string;
  finishing: boolean;
  expiry: NodeJS.Timeout | undefined;
  closed: Promise<void>;
}

const MAX_OUTPUT = 256 * 1024;
const ENTER_DELAY_MS = 250;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The last lines of the CLI's screen, for diagnosing a sign-in that stalls: links, tokens and the user's code
 * are left out, so it is safe to log and to show.
 */
export function screenTail(text: string, code?: string, lines = 6): string {
  return textLines(text)
    .filter((line) => !/sk-ant-|https?:\/\//i.test(line) && (code === undefined || !line.includes(code)))
    .slice(-lines)
    .map((line) => truncate(line, 160))
    .join(' | ');
}
const keepTail = (text: string) => (text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text);

/** One `claude setup-token` at a time, from start (the URL) to finish (the token). */
export class ClaudeLogin {
  private active: ActiveLogin | undefined;
  private readonly log: Logger;

  constructor(private readonly options: ClaudeLoginOptions = {}) {
    this.log = options.log ?? silentLogger;
  }

  get running(): boolean {
    return this.active !== undefined;
  }

  /** Starts the CLI and answers with the authorization URL it prints. */
  async start(): Promise<{ loginId: string; url: string }> {
    if (this.active !== undefined) {
      throw new ClaudeLoginError(409, 'login_running', 'Another sign-in to Claude is in progress.');
    }
    let cliPath: string;
    try {
      const configured = this.options.cliPath;
      cliPath = typeof configured === 'function' ? configured() : (configured ?? resolveClaudeBinary());
    } catch (error) {
      throw new ClaudeLoginError(502, 'cli_unavailable', errorMessage(error));
    }
    const home = mkdtempSync(path.join(this.options.tempRoot ?? os.tmpdir(), 'bohr-claude-login-'));
    const { file, args } = (this.options.command ?? pseudoTerminalCommand)(cliPath);
    const posix = process.platform !== 'win32';
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: home,
        env: loginEnvironment(this.options.env ?? process.env, home),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group, so ending the sign-in also ends the CLI under `script`
        detached: posix,
        windowsHide: true,
      });
    } catch (error) {
      removeHome(home);
      throw new ClaudeLoginError(502, 'cli_failed', `Could not start the Claude Code CLI: ${errorMessage(error)}`);
    }
    const id = randomBytes(18).toString('base64url');
    const login: ActiveLogin = {
      id,
      child,
      home,
      output: '',
      sinceCode: '',
      exited: false,
      finishing: false,
      // Armed once the link is shown: the time the user has to authorize starts then (start() has its own limit)
      expiry: undefined,
      closed: new Promise((resolve) => {
        child.once('close', () => resolve());
        child.once('error', () => resolve());
      }),
    };
    this.active = login;
    const reader = () => {
      const decoder = new StringDecoder('utf8');
      return (chunk: Buffer) => {
        const text = decoder.write(chunk);
        login.output = keepTail(login.output + text);
        login.sinceCode = keepTail(login.sinceCode + text);
      };
    };
    child.stdout?.on('data', reader());
    child.stderr?.on('data', reader());
    child.stdin?.on('error', () => {});
    child.once('error', (error) => {
      login.spawnError = errorMessage(error);
      login.exited = true;
    });
    child.once('exit', () => {
      login.exited = true;
    });
    this.log.info('claude login started', { loginId: id });

    const found = await this.waitUntil(
      login,
      () => findAuthorizeUrl(terminalText(login.output)),
      this.options.startTimeoutMs ?? 30_000,
    );
    if (found === 'timeout' || found === 'exited') {
      const reason =
        login.spawnError !== undefined
          ? `Could not start the Claude Code CLI: ${login.spawnError}`
          : (lastErrorLine(terminalText(login.output)) ??
            'The Claude Code CLI stopped before showing the sign-in link.');
      await this.end(login);
      if (found === 'timeout') {
        throw new ClaudeLoginError(504, 'timeout', 'The Claude Code CLI did not show the sign-in link in time.');
      }
      throw new ClaudeLoginError(502, 'cli_failed', reason);
    }
    login.expiry = setTimeout(
      () => {
        this.log.info('claude login expired', { loginId: id });
        void this.end(login);
      },
      this.options.ttlMs ?? 10 * 60_000,
    );
    login.expiry.unref();
    return { loginId: id, url: found };
  }

  /** Sends the code the user pasted to the CLI and answers with the long-lived token it creates. */
  async finish(loginId: string, code: string): Promise<{ token: string }> {
    if (!claudeLoginCodeSchema.safeParse(code).success) {
      throw new ClaudeLoginError(400, 'invalid_code', 'Paste the code exactly as claude.ai shows it.');
    }
    const login = this.find(loginId);
    if (login.finishing) throw new ClaudeLoginError(409, 'login_busy', 'This sign-in is already being finished.');
    login.finishing = true;
    try {
      // The CLI shows its code prompt a few seconds after the link; what is typed before that is lost
      await this.waitUntil(
        login,
        () => (PASTE_PROMPT.test(terminalText(login.output)) ? true : undefined),
        this.options.promptTimeoutMs ?? 8000,
      );
      if (login.exited) {
        throw new ClaudeLoginError(422, 'code_rejected', 'The Claude Code CLI stopped; start the sign-in again.');
      }
      const before = new Set(textLines(terminalText(login.output)));
      login.sinceCode = '';
      // The CLI's input treats a multi-character chunk as a paste, where an Enter does not submit: the code
      // goes first and the Enter on its own, once more if the screen did not react
      login.child.stdin?.write(code);
      await delay(ENTER_DELAY_MS);
      login.child.stdin?.write('\r');
      const retryEnter = setTimeout(() => {
        if (!login.exited && this.active === login && login.sinceCode.length < 8) login.child.stdin?.write('\r');
      }, 3000);
      retryEnter.unref();
      let errorSeenAt: number | undefined;
      const outcome = await this.waitUntil(
        login,
        (): { token: string } | { error: string } | undefined => {
          const text = terminalText(login.sinceCode);
          const token = TOKEN.exec(text)?.[0];
          if (token !== undefined) return { token };
          const error = lastErrorLine(text, code, before);
          if (error === undefined) return undefined;
          // Let the rest of the error screen arrive, so the most specific line is the one reported
          errorSeenAt ??= Date.now();
          return Date.now() - errorSeenAt >= 300 ? { error } : undefined;
        },
        this.options.finishTimeoutMs ?? 35_000,
      );
      clearTimeout(retryEnter);
      if (outcome === 'timeout') {
        const screen = screenTail(terminalText(login.output), code);
        this.log.info('claude login timed out', { loginId, screen });
        throw new ClaudeLoginError(
          504,
          'timeout',
          `The Claude Code CLI did not create the token in time.${screen ? ` Its screen ended with: ${screen}` : ''}`,
        );
      }
      if (outcome === 'exited' || 'error' in outcome) {
        const reason =
          outcome !== 'exited'
            ? outcome.error
            : (lastErrorLine(terminalText(login.sinceCode), code, before) ??
              'The Claude Code CLI did not accept the code.');
        this.log.info('claude login refused', { loginId });
        throw new ClaudeLoginError(422, 'code_rejected', reason);
      }
      this.log.info('claude login finished', { loginId });
      return { token: outcome.token };
    } finally {
      await this.end(login);
    }
  }

  /** Ends the sign-in; false when no sign-in has this id. */
  async cancel(loginId: string): Promise<boolean> {
    const login = this.active;
    if (login === undefined || login.id !== loginId) return false;
    this.log.info('claude login cancelled', { loginId });
    await this.end(login);
    return true;
  }

  /** Ends whatever sign-in is running (the runner is shutting down). */
  async stop(): Promise<void> {
    if (this.active !== undefined) await this.end(this.active);
  }

  private find(loginId: string): ActiveLogin {
    const login = this.active;
    if (login === undefined || login.id !== loginId) {
      throw new ClaudeLoginError(404, 'unknown_login', 'This sign-in expired or does not exist; start again.');
    }
    return login;
  }

  /** Polls `check` until it returns a value, the CLI exits or the time runs out. */
  private async waitUntil<T>(
    login: ActiveLogin,
    check: () => T | undefined,
    timeoutMs: number,
  ): Promise<T | 'timeout' | 'exited'> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value !== undefined) return value;
      if (login.exited || this.active !== login) {
        // Output that arrived with the exit is still read once
        await new Promise((resolve) => setTimeout(resolve, 20));
        return check() ?? 'exited';
      }
      if (Date.now() >= deadline) return 'timeout';
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Stops the CLI and deletes its HOME (where it may have written the credentials). */
  private async end(login: ActiveLogin): Promise<void> {
    if (this.active === login) this.active = undefined;
    clearTimeout(login.expiry);
    if (!login.exited) {
      try {
        if (process.platform !== 'win32' && login.child.pid !== undefined) process.kill(-login.child.pid, 'SIGKILL');
        else login.child.kill('SIGKILL');
      } catch {
        login.child.kill('SIGKILL');
      }
    }
    await Promise.race([login.closed, new Promise((resolve) => setTimeout(resolve, 3000))]);
    login.output = '';
    login.sinceCode = '';
    removeHome(login.home);
  }
}

function removeHome(home: string): void {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // A leftover temporary directory is not worth failing the sign-in for
  }
}
