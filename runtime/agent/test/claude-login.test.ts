import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeLogin,
  type ClaudeLoginOptions,
  findAuthorizeUrl,
  lastErrorLine,
  loginEnvironment,
  pseudoTerminalCommand,
  resolveClaudeBinary,
  terminalText,
} from '../src/claude-login';
import type { Logger } from '../src/log';
import { removeDir, tempDir, waitFor } from './helpers';

const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const TOKEN = `sk-ant-oat01-${'Ab3_'.repeat(12)}-fake`;
const URL_PREFIX = 'https://claude.com/cai/oauth/authorize?code=true&client_id=test-client';
const ESC = '\u001b';

type Mode = 'ok' | 'silent' | 'exit' | 'hang';

function recordingLogger() {
  const lines: unknown[] = [];
  const logger: Logger = {
    info: (message, data) => lines.push({ message, data }),
    warn: (message, data) => lines.push({ message, data }),
    error: (message, data) => lines.push({ message, data }),
  };
  return { logger, text: () => JSON.stringify(lines) };
}

const roots: string[] = [];
const logins: ClaudeLogin[] = [];

/** A login manager that runs the fake CLI (with node, no pseudo-terminal) under its own temp directory. */
function fakeLogin(mode: Mode = 'ok', options: Partial<ClaudeLoginOptions> = {}) {
  const tempRoot = tempDir('bohr-login-test-');
  roots.push(tempRoot);
  const log = recordingLogger();
  const login = new ClaudeLogin({
    cliPath: FAKE_CLI,
    command: (cli) => ({ file: process.execPath, args: [cli, mode, 'setup-token'] }),
    tempRoot,
    log: log.logger,
    ...options,
  });
  logins.push(login);
  return { login, tempRoot, log, homes: () => readdirSync(tempRoot) };
}

afterEach(async () => {
  for (const login of logins.splice(0)) await login.stop();
  for (const root of roots.splice(0)) removeDir(root);
});

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { status: number; code: string; message: string };
  }
  throw new Error('Expected a rejection.');
};

describe('terminal output', () => {
  it('reads the authorization URL out of colors, hyperlinks and cursor movements', () => {
    const url = 'https://claude.ai/oauth/authorize?code=true&client_id=x&state=abc';
    const raw = `${ESC}[2K${ESC}[1A${ESC}]8;;${url}\u0007${ESC}[2m${url}${ESC}[22m${ESC}]8;;\u0007\r\nPaste code`;
    expect(terminalText(raw)).toBe(`\n\n${url}\nPaste code`);
    expect(findAuthorizeUrl(terminalText(raw))).toBe(url);
    expect(findAuthorizeUrl('https://platform.claude.com/oauth/authorize?client_id=x\n')).toBe(
      'https://platform.claude.com/oauth/authorize?client_id=x',
    );
    // Not until the URL is complete (followed by a line break), and only https
    expect(findAuthorizeUrl(url)).toBeUndefined();
    expect(findAuthorizeUrl('http://claude.ai/oauth/authorize?x=1\n')).toBeUndefined();
    expect(findAuthorizeUrl('https://claude.ai/login\n')).toBeUndefined();
  });

  it('reports the last error line without secrets or the code', () => {
    const text = [
      'Paste code here if prompted > ',
      'OAuth error: Invalid authorization code abc#def',
      `Error: token ${TOKEN} failed`,
      'Error: see https://example.com/failed',
      'Token exchange failed (400): Bad Request',
      'Press Enter to retry.',
    ].join('\n');
    expect(lastErrorLine(text, 'abc#def')).toBe('Token exchange failed (400): Bad Request');
    expect(lastErrorLine(text, 'abc#def', new Set(['Token exchange failed (400): Bad Request']))).toBeUndefined();
    expect(lastErrorLine('all good\n')).toBeUndefined();
  });
});

describe('resolveClaudeBinary', () => {
  const sdk = '@anthropic-ai/claude-agent-sdk';
  const lookup = (installed: string[], extra: Parameters<typeof resolveClaudeBinary>[0] = {}) =>
    resolveClaudeBinary({
      arch: 'x64',
      resolve: (id) => {
        if (!installed.includes(id)) throw new Error(`Cannot find module ${id}`);
        return `/opt/bohr/node_modules/${id}`;
      },
      exists: () => true,
      ...extra,
    });

  it("finds the SDK's native CLI for the platform, glibc before musl on Linux", () => {
    const both = [`${sdk}-linux-x64/claude`, `${sdk}-linux-x64-musl/claude`];
    expect(lookup(both, { platform: 'linux', musl: false })).toBe(`/opt/bohr/node_modules/${sdk}-linux-x64/claude`);
    expect(lookup(both, { platform: 'linux', musl: true })).toBe(`/opt/bohr/node_modules/${sdk}-linux-x64-musl/claude`);
    expect(lookup([`${sdk}-linux-x64-musl/claude`], { platform: 'linux', musl: false })).toContain('-musl/claude');
    expect(lookup([`${sdk}-win32-x64/claude.exe`], { platform: 'win32' })).toContain('win32-x64/claude.exe');
    expect(() => lookup([], { platform: 'linux', musl: false })).toThrow(/not installed/);
  });

  it('finds the binary installed in this workspace', () => {
    // The SDK installs only the binary of the machine running the tests
    let binary: string | undefined;
    try {
      binary = resolveClaudeBinary();
    } catch {
      return;
    }
    expect(existsSync(binary)).toBe(true);
    expect(path.basename(binary)).toMatch(/^claude(\.exe)?$/);
  });

  it('runs setup-token in a wide pseudo-terminal by default', () => {
    expect(pseudoTerminalCommand("/opt/it's/claude")).toEqual({
      file: 'script',
      args: ['-qfec', `stty cols 4000 rows 50; exec '/opt/it'\\''s/claude' setup-token`, '/dev/null'],
    });
  });
});

describe('loginEnvironment', () => {
  it('gives the CLI a fresh HOME, no browser and no credentials or endpoints', () => {
    const env = loginEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/root',
        NODE_EXTRA_CA_CERTS: '/etc/ca.crt',
        ANTHROPIC_API_KEY: 'sk-ant-bohr-placeholder',
        ANTHROPIC_BASE_URL: 'https://llm.example.com',
        ANTHROPIC_AUTH_TOKEN: 'x',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-old',
        CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://evil.example.com',
        CLAUDE_CONFIG_DIR: '/root/.claude',
        CLAUDECODE: '1',
        BROWSER: 'firefox',
      },
      '/tmp/login-home',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      NODE_EXTRA_CA_CERTS: '/etc/ca.crt',
      HOME: '/tmp/login-home',
      USERPROFILE: '/tmp/login-home',
      XDG_CONFIG_HOME: path.join('/tmp/login-home', '.config'),
      BROWSER: 'true',
      TERM: 'xterm-256color',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
  });
});

describe('ClaudeLogin', () => {
  it('relays the URL and the code, returns the token and cleans up', async () => {
    const { login, homes, log } = fakeLogin('ok');
    const { loginId, url } = await login.start();
    expect(loginId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(url.startsWith(URL_PREFIX)).toBe(true);
    expect(url.endsWith('&state=xyz')).toBe(true);
    expect(login.running).toBe(true);
    expect(homes()).toHaveLength(1);

    expect(await login.finish(loginId, 'good-code#state')).toEqual({ token: TOKEN });
    expect(login.running).toBe(false);
    // The temporary HOME (where the CLI may keep credentials) is gone
    expect(homes()).toEqual([]);
    // Neither the token nor the code reaches the runner's log
    expect(log.text()).not.toContain(TOKEN);
    expect(log.text()).not.toContain('sk-ant-oat01');
    expect(log.text()).not.toContain('good-code');
    expect(log.text()).toContain('claude login finished');
    // Finished: the id is spent
    expect(await rejection(login.finish(loginId, 'good-code#state'))).toMatchObject({ status: 404 });
  });

  it('reports the CLI refusing the code, without echoing it', async () => {
    const { login, homes, log } = fakeLogin('ok');
    const { loginId } = await login.start();
    const error = await rejection(login.finish(loginId, 'wrong-code#state'));
    expect(error).toMatchObject({
      status: 422,
      code: 'code_rejected',
      message: 'OAuth error: Authentication failed: Invalid authorization code',
    });
    expect(login.running).toBe(false);
    expect(homes()).toEqual([]);
    expect(log.text()).not.toContain('wrong-code');
  });

  it('checks the code before handing it to the CLI', async () => {
    const { login } = fakeLogin('ok');
    const { loginId } = await login.start();
    for (const code of ['', 'two words', 'line\nbreak', `x${'y'.repeat(512)}`, 'tab\there']) {
      expect(await rejection(login.finish(loginId, code))).toMatchObject({ status: 400, code: 'invalid_code' });
    }
    // A malformed code does not spend the sign-in
    expect(login.running).toBe(true);
    expect(await rejection(login.finish('unknown-login-id', 'good-code#state'))).toMatchObject({
      status: 404,
      code: 'unknown_login',
    });
    expect(await login.finish(loginId, 'good-code#state')).toEqual({ token: TOKEN });
  });

  it('runs one sign-in at a time, and cancelling frees the slot', async () => {
    const { login, homes } = fakeLogin('ok');
    const first = await login.start();
    expect(await rejection(login.start())).toMatchObject({ status: 409, code: 'login_running' });
    expect(await login.cancel('someone-else')).toBe(false);
    expect(await login.cancel(first.loginId)).toBe(true);
    expect(login.running).toBe(false);
    expect(homes()).toEqual([]);
    const second = await login.start();
    expect(second.loginId).not.toBe(first.loginId);
    expect(await rejection(login.finish(first.loginId, 'good-code#state'))).toMatchObject({ status: 404 });
  });

  it('times out when the CLI shows no link, or makes no token', async () => {
    const silent = fakeLogin('silent', { startTimeoutMs: 400 });
    expect(await rejection(silent.login.start())).toMatchObject({ status: 504, code: 'timeout' });
    expect(silent.login.running).toBe(false);
    expect(silent.homes()).toEqual([]);

    const hang = fakeLogin('hang', { finishTimeoutMs: 400 });
    const { loginId } = await hang.login.start();
    expect(await rejection(hang.login.finish(loginId, 'good-code#state'))).toMatchObject({
      status: 504,
      code: 'timeout',
    });
    expect(hang.login.running).toBe(false);
    expect(hang.homes()).toEqual([]);
  });

  it('explains a CLI that stops before the link, or that cannot start', async () => {
    const { login } = fakeLogin('exit');
    expect(await rejection(login.start())).toMatchObject({
      status: 502,
      code: 'cli_failed',
      message: 'Error: Something broke before the sign-in started',
    });
    const missing = fakeLogin('ok', {
      command: () => ({ file: path.join(roots[0] ?? '', 'no-such-program'), args: [] }),
    });
    expect(await rejection(missing.login.start())).toMatchObject({ status: 502, code: 'cli_failed' });
    expect(missing.login.running).toBe(false);
    const unavailable = fakeLogin('ok', {
      cliPath: () => {
        throw new Error('The Claude Code CLI for linux-x64 is not installed.');
      },
    });
    expect(await rejection(unavailable.login.start())).toMatchObject({ status: 502, code: 'cli_unavailable' });
  });

  it('ends a sign-in nobody finishes', async () => {
    const { login, homes, log } = fakeLogin('ok', { ttlMs: 300 });
    const { loginId } = await login.start();
    await waitFor(() => !login.running && homes().length === 0, 10_000, 'the sign-in to expire');
    expect(log.text()).toContain('claude login expired');
    expect(await rejection(login.finish(loginId, 'good-code#state'))).toMatchObject({ status: 404 });
  });
});
