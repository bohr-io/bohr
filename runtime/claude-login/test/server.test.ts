import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeLogin } from '@bohr/agent/claude-login';
import type { Logger } from '@bohr/agent/log';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLoginServer } from '../src/server';

// The sign-in server around the agent's ClaudeLogin, with the agent's stand-in for `claude setup-token` (run
// with node, without a pseudo-terminal)
const FAKE_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agent',
  'test',
  'fixtures',
  'fake-claude.mjs',
);
const TOKEN = `sk-ant-oat01-${'Ab3_'.repeat(12)}-fake`;

const lines: unknown[] = [];
const log: Logger = {
  info: (message, data) => lines.push({ message, data }),
  warn: (message, data) => lines.push({ message, data }),
  error: (message, data) => lines.push({ message, data }),
};
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'bohr-claude-login-test-'));
const logins = new ClaudeLogin({
  cliPath: FAKE_CLI,
  command: (cli) => ({ file: process.execPath, args: [cli, 'ok', 'setup-token'] }),
  tempRoot,
  log,
  promptTimeoutMs: 2000,
});
const server = createLoginServer({ version: '0.3.3', logins, log, maxBodyBytes: 64 * 1024 });
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await logins.stop();
  await new Promise((resolve) => server.close(resolve));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function call(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${pathname}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
const post = (pathname: string, body?: unknown) =>
  call(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('sign-in server', () => {
  it('answers its health check', async () => {
    expect(await call('/health')).toEqual({ status: 200, body: { ok: true, version: '0.3.3', busy: false } });
    expect((await post('/health')).status).toBe(405);
  });

  it('serves only the sign-in endpoints', async () => {
    for (const pathname of ['/jobs', '/events', '/git/sync', '/preview/status', '/']) {
      expect(await post(pathname, {})).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    expect((await call('/claude-login/start')).status).toBe(405);
    expect(await post('/claude-login/finish', { loginId: 'x', code: 'c' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_request' },
    });
    expect((await post('/claude-login/cancel', {})).status).toBe(400);
    expect(await post('/claude-login/finish', { loginId: 'login_unknown_1', code: 'good-code#state' })).toMatchObject({
      status: 404,
      body: { error: 'unknown_login' },
    });
  });

  it('runs setup-token from the link to the token, one sign-in at a time', async () => {
    const started = await post('/claude-login/start');
    expect(started.status).toBe(200);
    const loginId = String(started.body.loginId);
    expect(started.body.url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&client_id=test-client/);
    expect((await call('/health')).body.busy).toBe(true);
    expect(await post('/claude-login/start')).toMatchObject({ status: 409, body: { error: 'login_running' } });

    // A refused code ends the sign-in; the next one starts over
    const refused = await post('/claude-login/finish', { loginId, code: 'wrong-code#state' });
    expect(refused).toMatchObject({ status: 422, body: { error: 'code_rejected' } });
    expect(String(refused.body.message)).toContain('Invalid authorization code');
    expect((await call('/health')).body.busy).toBe(false);

    const again = await post('/claude-login/start');
    const finished = await post('/claude-login/finish', { loginId: again.body.loginId, code: 'good-code#state' });
    expect(finished).toEqual({ status: 200, body: { token: TOKEN } });
    expect(await post('/claude-login/cancel', { loginId: again.body.loginId })).toEqual({
      status: 200,
      body: { cancelled: false },
    });

    // Cancelling ends a sign-in nobody finishes
    const abandoned = await post('/claude-login/start');
    expect(await post('/claude-login/cancel', { loginId: abandoned.body.loginId })).toEqual({
      status: 200,
      body: { cancelled: true },
    });
    expect((await call('/health')).body.busy).toBe(false);

    // Neither the code nor the token reach the log, and every temporary HOME is gone
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('good-code');
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});
