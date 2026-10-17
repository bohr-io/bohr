import { WorkerEntrypoint } from 'cloudflare:workers';
import { AGENT_EVENTS_PATH, agentEventBatchSchema, WORK_BRANCH } from '@bohr/shared';
import { githubToken } from './broker';
import type { GatewayKind } from './container';
import { deps } from './deps';
import type { Env } from './env';
import { PushParseError, readPushCommands } from './git-push';

/**
 * Outbound traffic from the agent container. The container only holds placeholders; this
 * entrypoint adds the real credentials, so a malicious dependency inside it cannot read them.
 */
export class Gateway extends WorkerEntrypoint<Env, { kind: GatewayKind }> {
  override async fetch(request: Request): Promise<Response> {
    switch (this.ctx.props.kind) {
      case 'anthropic':
        return anthropic(request, this.env);
      case 'github':
        return github(request, this.env);
      case 'internal':
        return internal(request, this.env);
    }
  }
}

const denied = (message: string, status = 403) =>
  Response.json({ type: 'error', error: { type: 'permission_error', message } }, { status });

/** What the agent uses of the Anthropic API. The key reaches nothing else (files, batches, admin endpoints). */
const ANTHROPIC_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/v1\/messages$/ },
  { method: 'POST', path: /^\/v1\/messages\/count_tokens$/ },
  { method: 'GET', path: /^\/v1\/models(?:\/[A-Za-z0-9._-]+)?$/ },
];

/**
 * Read-only account endpoints of api.anthropic.com the official CLI calls with an OAuth token, for the owner's
 * Claude subscription only (found in the CLI bundled with the Agent SDK 0.3.296, Claude Code 2.1.296):
 * - /api/oauth/profile: account and subscription type;
 * - /api/oauth/usage: the subscription's usage limits;
 * - /api/oauth/account/settings: account settings (read);
 * - /api/oauth/claude_cli/roles: the account's roles;
 * - /api/claude_cli_profile and /api/claude_cli/bootstrap: CLI profile and start-up configuration;
 * - /api/claude_code/settings: the organization's managed settings (read);
 * - /api/claude_code/organizations/metrics_enabled: whether the organization opted out of metrics;
 * - /api/claude_code_penguin_mode: whether fast mode is available.
 * Everything else stays denied, among it minting API keys (/api/oauth/claude_cli/create_api_key), file
 * uploads, the organization endpoints and metrics uploads. The setup-token exchange itself goes to
 * platform.claude.com, which is not intercepted.
 */
const SUBSCRIPTION_ROUTES: { method: string; path: RegExp }[] = [
  '/api/oauth/profile',
  '/api/oauth/usage',
  '/api/oauth/account/settings',
  '/api/oauth/claude_cli/roles',
  '/api/claude_cli_profile',
  '/api/claude_cli/bootstrap',
  '/api/claude_code/settings',
  '/api/claude_code/organizations/metrics_enabled',
  '/api/claude_code_penguin_mode',
].map((path) => ({ method: 'GET', path: new RegExp(`^${path}$`) }));

const isSubscription = (env: Env) => env.AGENT_PROVIDER === 'subscription';

/** The model API the agent talks to: Anthropic's, or the owner's compatible endpoint (host and path prefix). */
export function modelEndpoint(env: Env): { host: string; basePath: string; compatible: boolean } {
  if (!env.AGENT_BASE_URL || isSubscription(env)) return { host: 'api.anthropic.com', basePath: '', compatible: false };
  const url = new URL(env.AGENT_BASE_URL);
  return { host: url.hostname, basePath: url.pathname.replace(/\/+$/, ''), compatible: true };
}

export async function anthropic(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const endpoint = modelEndpoint(env);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== endpoint.host ||
    !url.pathname.startsWith(`${endpoint.basePath}/`)
  ) {
    return denied(`Only ${endpoint.host} is reachable through this gateway.`);
  }
  const path = url.pathname.slice(endpoint.basePath.length);
  const subscription = isSubscription(env);
  const routes = subscription ? [...ANTHROPIC_ROUTES, ...SUBSCRIPTION_ROUTES] : ANTHROPIC_ROUTES;
  if (!routes.some((route) => route.method === request.method && route.path.test(path))) {
    return denied(`${request.method} ${url.pathname} is not available to the agent.`);
  }
  if (!env.ANTHROPIC_API_KEY) return denied('This project has no Anthropic API key yet.', 401);
  // Code in the container runs between requests too (the dev server, its dependencies); the key only
  // works while the agent is working on a request.
  if (!(await env.PROJECT.getByName(env.PROJECT_ID).agentActive())) {
    return denied('The Anthropic API is only reachable while the agent works on a request.');
  }
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('x-api-key');
  if (subscription) {
    // The owner's Claude subscription: the CLI's OAuth token goes as a bearer token (its anthropic-beta and
    // anthropic-version headers pass through)
    headers.set('authorization', `Bearer ${env.ANTHROPIC_API_KEY}`);
    return deps.fetch(new Request(request, { headers, redirect: 'manual' }));
  }
  headers.set('x-api-key', env.ANTHROPIC_API_KEY);
  // Compatible endpoints differ in which header carries the key; each ignores the other
  if (endpoint.compatible) headers.set('authorization', `Bearer ${env.ANTHROPIC_API_KEY}`);
  // A redirect goes back to the sandbox instead of carrying the key to wherever it points
  return deps.fetch(new Request(request, { headers, redirect: 'manual' }));
}

/** Smart HTTP paths of the project's own repository; other GitHub traffic passes through anonymously. */
function isProjectGitPath(url: URL, env: Env): boolean {
  const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
  return (
    match !== null &&
    match[1]?.toLowerCase() === env.REPO_OWNER.toLowerCase() &&
    match[2]?.toLowerCase() === env.REPO_NAME.toLowerCase()
  );
}

const ZERO_SHA = /^0+$/;

// GitHub at times answers 429 to traffic from Cloudflare's shared addresses, whatever the token, and has brief
// 5xx: git requests are sent again a few times (Retry-After when it says, else 1, 2, 4 s) before git sees them
const GIT_ATTEMPTS = 4;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 10_000;

async function sendGit(url: string, init: { method: string; headers: Headers; body: ArrayBuffer | null }) {
  for (let attempt = 1; ; attempt++) {
    const response = await deps.fetch(
      new Request(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'manual' }),
    );
    if (response.status === 429 || response.status >= 500) {
      // Who answered (GitHub or something on the way), for the logs; never the request's headers (the token)
      const head = await response
        .clone()
        .text()
        .then((text) => text.slice(0, 200).replace(/\s+/g, ' '))
        .catch(() => '');
      console.warn(
        `[gateway] ${init.method} ${new URL(url).pathname} -> ${response.status} (attempt ${attempt}/${GIT_ATTEMPTS})`,
        JSON.stringify({
          server: response.headers.get('server'),
          retryAfter: response.headers.get('retry-after'),
          githubRequestId: response.headers.get('x-github-request-id'),
          rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
          rateLimitResource: response.headers.get('x-ratelimit-resource'),
          body: head,
        }),
      );
    }
    if (attempt >= GIT_ATTEMPTS || (response.status !== 429 && response.status < 500)) return response;
    const retryAfter = Number(response.headers.get('retry-after'));
    await response.body?.cancel();
    await deps.sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, RETRY_MAX_MS) : RETRY_BASE_MS * 2 ** (attempt - 1));
  }
}

export async function github(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return denied('Unexpected host.');
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  if (!isProjectGitPath(url, env)) {
    return request.method === 'GET'
      ? sendGit(request.url, { method: 'GET', headers, body: null })
      : deps.fetch(new Request(request, { headers }));
  }

  const pushing = url.pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack';
  // The agent pushes at the end of a request; between requests nothing in the sandbox may push
  if (pushing && !(await env.PROJECT.getByName(env.PROJECT_ID).agentActive())) {
    return denied('Pushes are only accepted while the agent works on a request.');
  }
  let body: ReadableStream<Uint8Array> | null = request.body;
  if (url.pathname.endsWith('/git-receive-pack')) {
    // Production changes only through an approved merge: the token may push the work branch, nothing else.
    if (request.body === null || request.headers.has('content-encoding')) return denied('Unexpected push.');
    try {
      const push = await readPushCommands(request.body);
      const allowed = `refs/heads/${WORK_BRANCH}`;
      if (push.commands.some((command) => command.ref !== allowed || ZERO_SHA.test(command.newSha))) {
        return denied(`Only ${WORK_BRANCH} can be pushed from the sandbox.`);
      }
      body = push.body;
    } catch (error) {
      if (error instanceof PushParseError) return denied(error.message, 400);
      throw error;
    }
  }
  const token = await githubToken(env, 'sandbox', deps.fetch);
  headers.set('authorization', `Basic ${btoa(`x-access-token:${token}`)}`);
  // Read once, so a retry sends the same bytes
  const payload = body === null ? null : await new Response(body).arrayBuffer();
  return sendGit(request.url, { method: request.method, headers, body: payload });
}

export async function internal(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== AGENT_EVENTS_PATH) return new Response(null, { status: 404 });
  const parsed = agentEventBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid events' }, { status: 400 });
  await env.PROJECT.getByName(env.PROJECT_ID).agentEvents(parsed.data.events);
  return new Response(null, { status: 204 });
}
