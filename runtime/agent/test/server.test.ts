import type { AddressInfo } from 'node:net';
import { type AgentJob, runnerHealthSchema } from '@bohr/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeLoginError } from '../src/claude-login';
import { EventLog } from '../src/events';
import { BranchNotFoundError, RunnerBusyError, UnknownRepositoryError } from '../src/job';
import type { Logger } from '../src/log';
import type { PreviewState } from '../src/preview';
import { createRunnerServer, type JobControl, type LoginControl } from '../src/server';
import { makeJob } from './helpers';

class FakeJobs implements JobControl {
  running: AgentJob | undefined;
  started: AgentJob[] = [];
  cancelled: string[] = [];
  sync = vi.fn(async (_branch: string): Promise<{ headSha: string }> => ({ headSha: 'a'.repeat(40) }));

  get busy() {
    return this.running !== undefined;
  }

  get currentJobId() {
    return this.running?.jobId;
  }

  start(job: AgentJob) {
    if (this.running) return false;
    this.running = job;
    this.started.push(job);
    return true;
  }

  cancel(jobId: string) {
    if (this.running?.jobId !== jobId) return false;
    this.cancelled.push(jobId);
    return true;
  }
}

const TOKEN = `sk-ant-oat01-${'t'.repeat(40)}`;

class FakeLogins implements LoginControl {
  finished: { loginId: string; code: string }[] = [];
  cancelled: string[] = [];
  start = vi.fn(async () => ({ loginId: 'login_0123456789', url: 'https://claude.com/cai/oauth/authorize?code=true' }));
  async finish(loginId: string, code: string) {
    this.finished.push({ loginId, code });
    if (loginId !== 'login_0123456789') throw new ClaudeLoginError(404, 'unknown_login', 'This sign-in expired.');
    if (code !== 'good#state') throw new ClaudeLoginError(422, 'code_rejected', 'OAuth error: Invalid code');
    return { token: TOKEN };
  }
  async cancel(loginId: string) {
    this.cancelled.push(loginId);
    return loginId === 'login_0123456789';
  }
}

const logged: unknown[] = [];
const log: Logger = {
  info: (message, data) => logged.push({ message, data }),
  warn: (message, data) => logged.push({ message, data }),
  error: (message, data) => logged.push({ message, data }),
};
const logins = new FakeLogins();
const jobs = new FakeJobs();
const events = new EventLog();
const previewState: PreviewState = { status: 'running', port: 5173, log: 'ready in 300 ms' };
const preview = { status: () => previewState, restart: vi.fn(async () => {}) };
const server = createRunnerServer({ version: '0.1.0', jobs, logins, events, preview, log, maxBodyBytes: 64 * 1024 });
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  jobs.running = undefined;
  jobs.started = [];
  jobs.cancelled = [];
  jobs.sync.mockClear();
  preview.restart.mockClear();
});

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
}

const post = (path: string, body: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const jobInput = {
  jobId: 'req_0123456789',
  kind: 'change',
  prompt: 'Make the header blue',
  repo: { owner: 'acme', name: 'site', baseBranch: 'main' },
  author: { name: 'Ada (via bohr)', email: 'noreply@bohr.io' },
  model: 'claude-opus-5-5',
  maxBudgetUsd: 5,
  maxTurns: 200,
  locale: 'pt-BR',
};

describe('GET /health', () => {
  it('reports the runner state', async () => {
    events.emit({ type: 'job.progress', jobId: 'req_0123456789', text: 'x' });
    const idle = await call('/health');
    expect(idle.status).toBe(200);
    expect(runnerHealthSchema.parse(idle.body)).toEqual({ ok: true, version: '0.1.0', busy: false, lastSeq: 1 });
    jobs.running = makeJob({ jobId: 'req_busy_123' });
    expect((await call('/health')).body).toMatchObject({ busy: true, jobId: 'req_busy_123' });
  });
});

describe('POST /jobs', () => {
  it('accepts a valid job and fills its defaults', async () => {
    const response = await post('/jobs', jobInput);
    expect(response).toMatchObject({ status: 202, body: { accepted: true } });
    expect(jobs.started[0]).toMatchObject({ jobId: 'req_0123456789', repo: { workBranch: 'homolog' } });
  });

  it('refuses a second job while one runs', async () => {
    jobs.running = makeJob({ jobId: 'req_running_1' });
    expect(await post('/jobs', jobInput)).toMatchObject({
      status: 409,
      body: { error: 'busy', jobId: 'req_running_1' },
    });
    expect(jobs.started).toEqual([]);
  });

  it('explains what is wrong with an invalid job', async () => {
    const response = await post('/jobs', { ...jobInput, repo: { ...jobInput.repo, baseBranch: 'a..b' } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_job');
    expect(response.body.issues[0].path).toEqual(['repo', 'baseBranch']);
    expect(await post('/jobs', '{not json')).toMatchObject({ status: 400, body: { error: 'invalid_json' } });
    expect(await post('/jobs', 'x'.repeat(70 * 1024))).toMatchObject({
      status: 413,
      body: { error: 'body_too_large' },
    });
  });
});

describe('POST /jobs/:jobId/cancel', () => {
  it('cancels the running job and nothing else', async () => {
    jobs.running = makeJob({ jobId: 'req_cancel_me' });
    expect(await call('/jobs/req_cancel_me/cancel', { method: 'POST' })).toMatchObject({
      status: 202,
      body: { accepted: true },
    });
    expect(jobs.cancelled).toEqual(['req_cancel_me']);
    expect(await call('/jobs/req_other_job/cancel', { method: 'POST' })).toMatchObject({
      status: 404,
      body: { error: 'not_running' },
    });
  });
});

describe('GET /events', () => {
  it('returns the buffered events after a seq', async () => {
    const before = events.lastSeq;
    events.emit({ type: 'job.progress', jobId: 'req_0123456789', text: 'one' });
    events.emit({ type: 'job.progress', jobId: 'req_0123456789', text: 'two' });
    const response = await call(`/events?after=${before + 1}`);
    expect(response.status).toBe(200);
    expect(response.body.lastSeq).toBe(before + 2);
    expect(response.body.events.map((event: { text: string }) => event.text)).toEqual(['two']);
    expect((await call('/events')).body.events.length).toBe(before + 2);
  });

  it('refuses a malformed seq', async () => {
    for (const after of ['-1', '1.5', 'abc']) {
      expect((await call(`/events?after=${after}`)).status).toBe(400);
    }
  });
});

describe('POST /git/sync', () => {
  it('syncs the checkout to the branch', async () => {
    expect(await post('/git/sync', { branch: 'homolog' })).toEqual({
      status: 200,
      headers: expect.anything(),
      body: { headSha: 'a'.repeat(40) },
    });
    expect(jobs.sync).toHaveBeenCalledWith('homolog');
  });

  it('maps the runner errors to statuses', async () => {
    jobs.sync.mockRejectedValueOnce(new RunnerBusyError('req_running_1'));
    expect(await post('/git/sync', { branch: 'main' })).toMatchObject({ status: 409, body: { error: 'busy' } });
    jobs.sync.mockRejectedValueOnce(new BranchNotFoundError('homolog'));
    expect(await post('/git/sync', { branch: 'homolog' })).toMatchObject({
      status: 404,
      body: { error: 'branch_not_found', branch: 'homolog' },
    });
    jobs.sync.mockRejectedValueOnce(new UnknownRepositoryError());
    expect(await post('/git/sync', { branch: 'main' })).toMatchObject({
      status: 409,
      body: { error: 'repository_unknown' },
    });
    jobs.sync.mockRejectedValueOnce(new Error('git fetch failed: network'));
    expect(await post('/git/sync', { branch: 'main' })).toMatchObject({
      status: 500,
      body: { error: 'sync_failed', message: 'git fetch failed: network' },
    });
  });

  it('refuses invalid branch names', async () => {
    expect(await post('/git/sync', { branch: '--upload-pack=x' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_sync' },
    });
    expect(jobs.sync).not.toHaveBeenCalled();
  });
});

describe('preview endpoints', () => {
  it('restarts the preview and reports its status', async () => {
    expect(await call('/preview/restart', { method: 'POST' })).toMatchObject({ status: 202 });
    expect(preview.restart).toHaveBeenCalledTimes(1);
    expect((await call('/preview/status')).body).toEqual(previewState);
  });
});

describe('Claude subscription sign-in', () => {
  it('starts setup-token, relays the code and answers with the token, never logging either', async () => {
    expect(await call('/claude-login/start', { method: 'POST' })).toMatchObject({
      status: 200,
      body: { loginId: 'login_0123456789', url: 'https://claude.com/cai/oauth/authorize?code=true' },
    });
    expect(await post('/claude-login/finish', { loginId: 'login_0123456789', code: 'good#state' })).toMatchObject({
      status: 200,
      body: { token: TOKEN },
    });
    expect(await post('/claude-login/cancel', { loginId: 'login_0123456789' })).toMatchObject({
      status: 200,
      body: { cancelled: true },
    });
    expect(await post('/claude-login/cancel', { loginId: 'login_other_123' })).toMatchObject({
      body: { cancelled: false },
    });
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    expect(JSON.stringify(logged)).not.toContain('good#state');
  });

  it('maps the sign-in errors to statuses and refuses malformed bodies', async () => {
    logins.start.mockRejectedValueOnce(new ClaudeLoginError(409, 'login_running', 'Another sign-in is in progress.'));
    expect(await call('/claude-login/start', { method: 'POST' })).toMatchObject({
      status: 409,
      body: { error: 'login_running', message: 'Another sign-in is in progress.' },
    });
    expect(await post('/claude-login/finish', { loginId: 'login_0123456789', code: 'bad#state' })).toMatchObject({
      status: 422,
      body: { error: 'code_rejected', message: 'OAuth error: Invalid code' },
    });
    expect(await post('/claude-login/finish', { loginId: 'login_expired_1', code: 'good#state' })).toMatchObject({
      status: 404,
      body: { error: 'unknown_login' },
    });
    const before = logins.finished.length;
    expect(await post('/claude-login/finish', { loginId: 'login_0123456789', code: 'has space' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_request' },
    });
    expect(await post('/claude-login/finish', { loginId: 'x', code: 'good#state' })).toMatchObject({ status: 400 });
    expect(await post('/claude-login/cancel', {})).toMatchObject({ status: 400 });
    expect(logins.finished).toHaveLength(before);
    expect((await call('/claude-login/start')).status).toBe(405);
  });
});

describe('routing', () => {
  it('answers 405 with Allow for the wrong method and 404 for unknown paths', async () => {
    const wrong = await call('/jobs');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await call('/nope')).status).toBe(404);
    expect((await call('/jobs/x/cancel')).status).toBe(405);
  });
});
