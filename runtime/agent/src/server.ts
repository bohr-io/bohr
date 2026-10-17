import http from 'node:http';
import {
  type AgentEvent,
  type AgentJob,
  agentJobSchema,
  gitSyncSchema,
  RUNNER_PATHS,
  type RunnerHealth,
} from '@bohr/shared';
import { claudeLoginErrorReply, claudeLoginRoute, type LoginControl } from './claude-login-routes';
import { allow, HttpError, type Reply, readJson, send } from './http';
import { BranchNotFoundError, RunnerBusyError, UnknownRepositoryError } from './job';
import { type Logger, silentLogger } from './log';
import type { PreviewState } from './preview';
import { errorMessage } from './text';

export type { LoginControl };

export interface JobControl {
  readonly busy: boolean;
  readonly currentJobId: string | undefined;
  /** False when a job is already running. */
  start(job: AgentJob): boolean;
  /** False when that job is not the one running. */
  cancel(jobId: string): boolean;
  sync(branch: string): Promise<{ headSha: string }>;
}

export interface PreviewControl {
  status(): PreviewState;
  restart(): Promise<void>;
}

export interface RunnerServerOptions {
  version: string;
  jobs: JobControl;
  logins: LoginControl;
  events: { readonly lastSeq: number; after(seq: number): AgentEvent[] };
  preview: PreviewControl;
  log?: Logger;
  maxBodyBytes?: number;
}

const CANCEL_PATH = /^\/jobs\/([^/]+)\/cancel$/;

/** The runner's control API, which the project Worker calls through the container's port. */
export function createRunnerServer(options: RunnerServerOptions): http.Server {
  const log = options.log ?? silentLogger;
  return http.createServer((request, response) => {
    route(request, options)
      .then(({ status, body }) => send(response, status, body))
      .catch((error: unknown) => {
        if (error instanceof HttpError) {
          send(response, error.status, error.body, error.headers);
          return;
        }
        const refused = claudeLoginErrorReply(error);
        if (refused !== undefined) {
          send(response, refused.status, refused.body);
          return;
        }
        log.error('request failed', { method: request.method, url: request.url, error: errorMessage(error) });
        send(response, 500, { error: 'internal_error', message: errorMessage(error) });
      });
  });
}

async function route(request: http.IncomingMessage, options: RunnerServerOptions): Promise<Reply> {
  const url = new URL(request.url ?? '/', 'http://runner');
  const { jobs, events, preview } = options;
  switch (url.pathname) {
    case RUNNER_PATHS.health: {
      allow(request, 'GET');
      const health: RunnerHealth = { ok: true, version: options.version, busy: jobs.busy, lastSeq: events.lastSeq };
      if (jobs.currentJobId !== undefined) health.jobId = jobs.currentJobId;
      return { status: 200, body: health };
    }
    case RUNNER_PATHS.jobs: {
      allow(request, 'POST');
      const parsed = agentJobSchema.safeParse(await readJson(request, options.maxBodyBytes));
      if (!parsed.success) return { status: 400, body: { error: 'invalid_job', issues: parsed.error.issues } };
      if (!jobs.start(parsed.data)) return { status: 409, body: { error: 'busy', jobId: jobs.currentJobId } };
      return { status: 202, body: { accepted: true } };
    }
    case RUNNER_PATHS.events: {
      allow(request, 'GET');
      const raw = url.searchParams.get('after');
      const after = raw === null || raw === '' ? 0 : Number(raw);
      if (!Number.isInteger(after) || after < 0) {
        return { status: 400, body: { error: 'invalid_after', message: 'after must be a non-negative integer.' } };
      }
      return { status: 200, body: { events: events.after(after), lastSeq: events.lastSeq } };
    }
    case RUNNER_PATHS.gitSync: {
      allow(request, 'POST');
      const parsed = gitSyncSchema.safeParse(await readJson(request, options.maxBodyBytes));
      if (!parsed.success) return { status: 400, body: { error: 'invalid_sync', issues: parsed.error.issues } };
      try {
        return { status: 200, body: await jobs.sync(parsed.data.branch) };
      } catch (error) {
        if (error instanceof RunnerBusyError) return { status: 409, body: { error: 'busy', jobId: error.jobId } };
        if (error instanceof BranchNotFoundError) {
          return { status: 404, body: { error: 'branch_not_found', branch: error.branch, message: error.message } };
        }
        if (error instanceof UnknownRepositoryError) {
          return { status: 409, body: { error: 'repository_unknown', message: error.message } };
        }
        return { status: 500, body: { error: 'sync_failed', message: errorMessage(error) } };
      }
    }
    case RUNNER_PATHS.previewRestart:
      allow(request, 'POST');
      void preview.restart();
      return { status: 202, body: { accepted: true } };
    case RUNNER_PATHS.previewStatus:
      allow(request, 'GET');
      return { status: 200, body: preview.status() };
  }
  // The sign-in's errors (ClaudeLoginError) become their own statuses; the code and token are never logged
  const login = await claudeLoginRoute(request, url.pathname, options.logins, options.maxBodyBytes);
  if (login !== undefined) return login;
  const cancel = CANCEL_PATH.exec(url.pathname);
  if (cancel) {
    allow(request, 'POST');
    let jobId: string;
    try {
      jobId = decodeURIComponent(cancel[1] ?? '');
    } catch {
      return { status: 400, body: { error: 'invalid_job_id' } };
    }
    if (!jobs.cancel(jobId)) return { status: 404, body: { error: 'not_running', jobId } };
    return { status: 202, body: { accepted: true } };
  }
  return { status: 404, body: { error: 'not_found' } };
}
