// The instance's dedicated sign-in container (runtime/claude-login): a minimal image with the official Claude
// Code CLI and a small server around `claude setup-token`. Connecting a Claude subscription runs there instead
// of in one of the owner's project containers, so it needs no project and starts in seconds. One Durable Object
// (and container) per sign-in owner, `user:<id>` or `org:<id>`, so people never wait for each other.
//
// No credentials ever enter this container: it gets no secrets and no interception, only internet access for
// the CLI's own OAuth flow. The token it answers with goes to the instance (services/claude-login.ts), never to
// the browser.

import { DurableObject } from 'cloudflare:workers';
import { AGENT_PORT, RUNNER_PATHS } from '@bohr/shared';
import type { Env } from '../env';

/** How long the container stays up after the last request: the user is authorizing on claude.ai meanwhile. */
export const LOGIN_IDLE_TIMEOUT_MS = 10 * 60_000;
/** How long a cold start may take before the sign-in gives up (the image is small; it usually takes seconds). */
export const LOGIN_START_TIMEOUT_MS = 90_000;

const LOGIN_PATHS: ReadonlySet<string> = new Set([
  RUNNER_PATHS.claudeLoginStart,
  RUNNER_PATHS.claudeLoginFinish,
  RUNNER_PATHS.claudeLoginCancel,
]);
const SERVER_URL = 'http://claude-login';

/** What the relay needs of `ctx.container` (a fake in tests). */
export interface LoginContainer {
  readonly running: boolean;
  start(options: { enableInternet: boolean; labels?: Record<string, string> }): void;
  setInactivityTimeout(durationMs: number): Promise<void>;
  getTcpPort(port: number): { fetch(request: Request): Promise<Response> };
}

export interface RelayOptions {
  startTimeoutMs?: number;
  /** Between health checks while the container starts. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const unavailable = (message: string) =>
  Response.json({ error: 'container_unavailable', message }, { status: 503, headers: { 'cache-control': 'no-store' } });

/**
 * Starts the container when it is not running, waits until its server answers, and relays one sign-in request
 * (start, finish or cancel) to it. The server's own refusals (409, 404, 422, 504…) pass through unchanged.
 */
export class LoginRelay {
  private ready: Promise<void> | undefined;

  constructor(
    private readonly container: LoginContainer | undefined,
    private readonly options: RelayOptions = {},
  ) {}

  async relay(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !LOGIN_PATHS.has(path)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const container = this.container;
    if (container === undefined) return unavailable('The sign-in container is not configured.');
    try {
      await this.ensureRunning(container);
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
    // Every use keeps it warm a little longer, until the user is done
    await container.setInactivityTimeout(LOGIN_IDLE_TIMEOUT_MS);
    try {
      return await container.getTcpPort(AGENT_PORT).fetch(
        new Request(`${SERVER_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        }),
      );
    } catch {
      // The container stopped under the sign-in: the next request starts a fresh one
      this.ready = undefined;
      return Response.json({ error: 'container_failed' }, { status: 502 });
    }
  }

  private ensureRunning(container: LoginContainer): Promise<void> {
    if (!container.running) this.ready = undefined;
    // Requests that arrive during a cold start share it
    this.ready ??= this.boot(container).catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async boot(container: LoginContainer): Promise<void> {
    if (!container.running) {
      container.start({ enableInternet: true, labels: { 'bohr.role': 'claude-login' } });
    }
    await container.setInactivityTimeout(LOGIN_IDLE_TIMEOUT_MS);
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + (this.options.startTimeoutMs ?? LOGIN_START_TIMEOUT_MS);
    for (;;) {
      try {
        const response = await container
          .getTcpPort(AGENT_PORT)
          .fetch(new Request(`${SERVER_URL}${RUNNER_PATHS.health}`, { signal: AbortSignal.timeout(3000) }));
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Not listening yet
      }
      if (Date.now() >= deadline) throw new Error('The sign-in container did not start in time.');
      await sleep(this.options.pollMs ?? 500);
    }
  }
}

/** The CLAUDE_LOGIN Durable Object: one per sign-in owner, driving its own container. */
export class ClaudeLoginContainer extends DurableObject<Env> {
  private readonly login: LoginRelay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.login = new LoginRelay(ctx.container);
  }

  override fetch(request: Request): Promise<Response> {
    return this.login.relay(request);
  }
}
