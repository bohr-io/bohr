import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as github from '../src/github';
import type { Fetch } from '../src/http';
import { jsonResponse, makeTempDir, noSleep } from './helpers';

// The deploy action used @actions/core; the CLI writes the runner's protocol itself. Each case runs both and
// compares what the runner would read: stdout (workflow commands) and the $GITHUB_OUTPUT / $GITHUB_ENV / summary
// files, with the random heredoc delimiters normalized.

let dir: string;
const saved = { ...process.env };

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...saved };
  await rm(dir, { recursive: true, force: true });
});

/** Runs fn with fresh runner files; returns stdout and the files as the runner would read them. */
async function runner(fn: () => unknown | Promise<unknown>) {
  const files = {
    GITHUB_OUTPUT: join(dir, 'output'),
    GITHUB_ENV: join(dir, 'env'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
  };
  for (const [name, path] of Object.entries(files)) {
    await writeFile(path, '');
    process.env[name] = path;
  }
  let stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  await fn();
  vi.restoreAllMocks();
  const normalize = (text: string) => text.replace(/ghadelimiter_[0-9a-f-]{36}/g, 'ghadelimiter_X');
  return {
    stdout: normalize(stdout),
    output: normalize(await readFile(files.GITHUB_OUTPUT, 'utf8')),
    env: normalize(await readFile(files.GITHUB_ENV, 'utf8')),
    summary: await readFile(files.GITHUB_STEP_SUMMARY, 'utf8'),
  };
}

const VALUES = ['https://site-acme.bohr.io', 'line one\nline two', '', '100% done, a:b', 'unicode ✓'];

describe('the runner protocol, as @actions/core writes it', () => {
  it('sets outputs and environment variables the same way', async () => {
    const use = (api: { setOutput: typeof github.setOutput; exportVariable: typeof github.exportVariable }) => () => {
      VALUES.forEach((value, index) => {
        api.setOutput(`out-${index}`, value);
        api.exportVariable(`VAR_${index}`, value);
      });
    };
    const ours = await runner(use(github));
    const theirs = await runner(use(core));
    expect(ours).toEqual(theirs);
    expect(ours.output).toContain('out-1<<ghadelimiter_X');
    expect(process.env.VAR_1).toBe('line one\nline two');
  });

  it('writes masks, warnings, debug lines, groups and failures the same way', async () => {
    const use = (api: typeof github | typeof core) => async () => {
      for (const value of VALUES) {
        api.setSecret(value);
        api.warning(value);
        api.debug(value);
        api.info(value);
      }
      await api.group('Upload 2 new or changed assets', async () => api.info('+ /index.html'));
      api.setFailed('The bohr instance could not open a deploy session (HTTP 404):\nNo project');
    };
    const ours = await runner(use(github));
    process.exitCode = undefined;
    const theirs = await runner(use(core));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(ours.stdout).toBe(theirs.stdout);
    expect(ours.stdout).toContain('::add-mask::line one%0Aline two');
  });

  it('falls back to workflow commands without the runner files', async () => {
    const use = (api: typeof github | typeof core) => () => {
      delete process.env.GITHUB_OUTPUT;
      delete process.env.GITHUB_ENV;
      api.setOutput('url', 'https://a.example');
      api.exportVariable('A', 'b,c');
    };
    expect((await runner(use(github))).stdout).toBe((await runner(use(core))).stdout);
  });

  it('reads inputs the same way', () => {
    process.env['INPUT_WORKING-DIRECTORY'] = '  apps/web \n';
    process.env.INPUT_CREDENTIALS = 'TRUE';
    for (const name of ['working-directory', 'credentials', 'build-plan']) {
      expect(github.getInput(name)).toBe(core.getInput(name));
    }
  });

  it('builds the same job summary', async () => {
    // Both have the same chainable methods; typed as ours
    const use = (summary: github.Summary) => async () => {
      await summary
        .addHeading('bohr.io Cloud deploy', 2)
        .addRaw('<p>Deployed to <a href="https://x">https://x</a></p>', true)
        .addTable([
          [
            { data: 'Files', header: true },
            { data: 'Uploaded', header: true },
          ],
          ['2', '0'],
        ])
        .write();
    };
    const ours = await runner(use(new github.Summary()));
    const theirs = await runner(use(core.summary as unknown as github.Summary));
    expect(ours.summary).toBe(theirs.summary);
  });
});

describe('getIdToken', () => {
  it('asks the runner for a token with the audience, and masks it', async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.actions.example/run?api-version=2.0';
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token';
    const fetch = vi.fn<Fetch>(async () => jsonResponse({ value: 'the.oidc.token' }));
    const { stdout } = await runner(async () => {
      expect(await github.getIdToken('bohr.io', { fetch, sleep: noSleep })).toBe('the.oidc.token');
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://token.actions.example/run?api-version=2.0&audience=bohr.io');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer request-token');
    expect(stdout).toContain('::add-mask::the.oidc.token');
  });

  it("fails like @actions/core without the job's id-token permission", async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const ours = await github.getIdToken('bohr.io').catch((error: Error) => error.message);
    const theirs = await core.getIDToken('bohr.io').catch((error: Error) => error.message);
    expect(ours).toBe(theirs);
    expect(ours).toBe('Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable');
  });

  it('explains a refused request', async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.actions.example/run?x=1';
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token';
    const fetch = vi.fn<Fetch>(async () => new Response('forbidden', { status: 403 }));
    await runner(async () => {
      await expect(github.getIdToken('bohr.io', { fetch, sleep: noSleep })).rejects.toThrow(
        'Error message: Failed to get ID Token. Error Code : 403 Error Message: forbidden',
      );
    });
  });
});
