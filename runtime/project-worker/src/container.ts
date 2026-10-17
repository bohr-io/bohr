import {
  AGENT_PORT,
  type AgentEvent,
  type AgentJob,
  agentEventSchema,
  claudeLoginFinishResultSchema,
  claudeLoginStartResultSchema,
  gitSyncResultSchema,
  INTERNAL_HOST,
  RUNNER_PATHS,
  type RunnerHealth,
  runnerHealthSchema,
} from '@bohr/shared';
import { z } from 'zod';
import type { Env } from './env';
import { modelEndpoint } from './gateway';

/** Control API of the agent runner inside the container (see @bohr/shared agent contract). */
export type RunnerPreviewStatus = { status: string; port?: number; reason?: string; log: string };

const runnerPreviewStatusSchema = z.object({
  status: z.string(),
  port: z.number().int().optional(),
  reason: z.string().optional(),
  log: z.string().default(''),
});

export interface RunnerApi {
  /** Null when the runner does not answer. */
  health(): Promise<RunnerHealth | null>;
  startJob(job: AgentJob): Promise<'accepted' | 'busy'>;
  cancel(jobId: string): Promise<void>;
  events(after: number): Promise<{ events: AgentEvent[]; lastSeq: number }>;
  /** Makes the checkout match the remote branch; null when the runner is busy. */
  gitSync(branch: string): Promise<string | null>;
  restartPreview(): Promise<void>;
  /** The preview as the runner sees it, with the recent output of its install and dev server commands. */
  previewStatus(): Promise<RunnerPreviewStatus | null>;
  /** Starts the official CLI's `claude setup-token`; the URL the owner authorizes at. */
  claudeLoginStart(): Promise<{ loginId: string; url: string }>;
  /** Hands the code the owner pasted to the CLI; the long-lived token it created. */
  claudeLoginFinish(loginId: string, code: string): Promise<{ token: string }>;
  claudeLoginCancel(loginId: string): Promise<void>;
}

/** The runner refused a call: its status and error code ("login_running", "code_rejected"…) and message. */
export class RunnerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

async function runnerError(response: Response, fallback: string): Promise<RunnerError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  return new RunnerError(
    response.status,
    typeof body?.error === 'string' ? body.error : `http_${response.status}`,
    typeof body?.message === 'string' ? body.message : fallback,
  );
}

export interface ContainerHost {
  readonly running: boolean;
  /** Starts the container when it is not running and waits until the runner answers. */
  start(): Promise<void>;
  readonly runner: RunnerApi;
  /** Sends a request to a port inside the container. */
  fetchPort(port: number, request: Request): Promise<Response>;
  /** Stops the container (it starts again, from the current image, on the next start()). */
  stop(): Promise<void>;
}

/** How long an idle container stays up; the preview keeps it awake while people use it. */
export const INACTIVITY_TIMEOUT_MS = 30 * 60_000;
const START_TIMEOUT_MS = 180_000;
const RUNNER_URL = 'http://runner';

const eventsResponseSchema = z.object({ events: z.array(agentEventSchema), lastSeq: z.number().int().nonnegative() });

export function runnerApi(send: (request: Request) => Promise<Response>): RunnerApi {
  const call = (path: string, init?: RequestInit) => send(new Request(`${RUNNER_URL}${path}`, init));
  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    async health() {
      try {
        const response = await call(RUNNER_PATHS.health, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        const parsed = runnerHealthSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async startJob(job) {
      const response = await call(RUNNER_PATHS.jobs, json(job));
      if (response.status === 409) return 'busy';
      if (!response.ok) throw new Error(`The agent refused the job (${response.status}): ${await response.text()}`);
      return 'accepted';
    },
    async cancel(jobId) {
      await call(RUNNER_PATHS.cancel(jobId), { method: 'POST' });
    },
    async events(after) {
      const response = await call(`${RUNNER_PATHS.events}?after=${after}`);
      if (!response.ok) throw new Error(`Could not read agent events (${response.status}).`);
      return eventsResponseSchema.parse(await response.json());
    },
    async gitSync(branch) {
      const response = await call(RUNNER_PATHS.gitSync, json({ branch }));
      if (response.status === 409) return null;
      if (!response.ok) throw new Error(`Could not update the checkout (${response.status}).`);
      return gitSyncResultSchema.parse(await response.json()).headSha;
    },
    async restartPreview() {
      await call(RUNNER_PATHS.previewRestart, { method: 'POST' });
    },
    async previewStatus() {
      const response = await call(RUNNER_PATHS.previewStatus, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response === null || !response.ok) return null;
      const parsed = runnerPreviewStatusSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data : null;
    },
    async claudeLoginStart() {
      const response = await call(RUNNER_PATHS.claudeLoginStart, { method: 'POST' });
      if (!response.ok) throw await runnerError(response, 'Could not start the sign-in to Claude.');
      return claudeLoginStartResultSchema.parse(await response.json());
    },
    async claudeLoginFinish(loginId, code) {
      const response = await call(RUNNER_PATHS.claudeLoginFinish, json({ loginId, code }));
      if (!response.ok) throw await runnerError(response, 'Could not finish the sign-in to Claude.');
      return claudeLoginFinishResultSchema.parse(await response.json());
    },
    async claudeLoginCancel(loginId) {
      await call(RUNNER_PATHS.claudeLoginCancel, json({ loginId }));
    },
  };
}

export type GatewayKind = 'anthropic' | 'github' | 'internal';

/** The container owned by the project's Durable Object (Sandbox SDK 1.0 model). */
export function cloudflareContainer(ctx: DurableObjectState, env: Env): ContainerHost {
  const container = ctx.container;
  const requireContainer = () => {
    if (container === undefined) throw new Error('The Project Durable Object has no container configured.');
    return container;
  };
  const fetchPort = (port: number, request: Request) => requireContainer().getTcpPort(port).fetch(request);
  const gateway = (kind: GatewayKind) => ctx.exports.Gateway({ props: { kind } });
  // Hosts sent to the Anthropic gateway; the owner can switch to a compatible endpoint while the container runs
  const modelHosts = new Set<string>();
  const interceptModelHost = async (target: NonNullable<typeof container>) => {
    const { host } = modelEndpoint(env);
    if (modelHosts.has(host)) return;
    await target.interceptOutboundHttps(host, gateway('anthropic'));
    modelHosts.add(host);
  };

  return {
    get running() {
      return container?.running ?? false;
    },
    runner: runnerApi((request) => fetchPort(AGENT_PORT, request)),
    fetchPort,
    async stop() {
      if (container?.running) await container.destroy();
    },
    async start() {
      const target = requireContainer();
      if (!target.running) {
        // Interception first: the interception CA must exist when the image's entrypoint runs.
        modelHosts.clear();
        await target.interceptOutboundHttps('api.anthropic.com', gateway('anthropic'));
        modelHosts.add('api.anthropic.com');
        await interceptModelHost(target);
        await target.interceptOutboundHttps('github.com', gateway('github'));
        await target.interceptOutboundHttp(INTERNAL_HOST, gateway('internal'));
        const image = target.images.agent;
        if (image === undefined) throw new Error('The container has no image named "agent".');
        target.start({
          image,
          enableInternet: true,
          instance: (env.CONTAINER_INSTANCE_TYPE as 'standard-1' | undefined) ?? 'standard-1',
          // The runner clones this repository after a cold start (git sync) before any job names it
          env: { BOHR_PROJECT_ID: env.PROJECT_ID, BOHR_REPO: `${env.REPO_OWNER}/${env.REPO_NAME}` },
          labels: { 'bohr.project': env.PROJECT_ID },
        });
      } else {
        // After a Durable Object restart the set is empty even though the interception may exist already
        await interceptModelHost(target).catch((error) => console.warn('[container] model host interception:', error));
      }
      await target.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
      const runner = runnerApi((request) => fetchPort(AGENT_PORT, request));
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if ((await runner.health()) !== null) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('The agent container did not start in time.');
    },
  };
}
