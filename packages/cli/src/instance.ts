import type { WorkerModule } from './bundle';
import { errorMessage, type Fetch, fetchWithRetry, type Sleep } from './http';
import type { AssetManifest } from './manifest';

const USER_AGENT = 'bohr-deploy-action';
/** The finalize call publishes the Worker, so it may take a while, but must not hang the job. */
const FINALIZE_TIMEOUT_MS = 5 * 60_000;
const UNKNOWN_PROJECT_HINT =
  'No bohr.io Cloud managed project matches this repository and branch. Create or migrate the project in the bohr panel, and deploy from a branch push.';
const UNKNOWN_TOKEN_PROJECT_HINT =
  "The project does not exist, or this token cannot reach it: check the project id (bohr projects) and the token's projects in the panel (Account › Tokens).";
const EXPIRED_SESSION_HINT = 'The deploy session expired or does not exist. Run the workflow again.';

export interface AssetsConfig {
  notFoundHandling?: string;
  htmlHandling?: string;
  runWorkerFirst?: boolean | string[];
  /** Contents of the _redirects and _headers files. */
  redirects?: string;
  headers?: string;
}

/** What a deploy with an API token publishes; a GitHub OIDC token says it by its repository and ref instead. */
export interface DeployTarget {
  projectId: string;
  branch: string;
  /** Must be true exactly when branch is the project's production branch. */
  production: boolean;
}

export interface SessionRequest extends Partial<DeployTarget> {
  manifest: AssetManifest;
  assetsConfig: AssetsConfig;
}

export interface DeploySession {
  sessionId: string;
  accountId: string | null;
  /** Null when there are no assets. */
  uploadToken: string | null;
  buckets: string[][];
}

export interface FinalizeMetadata {
  /** Null for assets-only projects; the instance then adds a module that serves the assets. */
  mainModule: string | null;
  compatibilityDate: string;
  compatibilityFlags: string[];
  vars: Record<string, string>;
  assetsBinding: string | null;
  assetsCompletionToken: string | null;
  commitSha: string | null;
}

export interface Deployment {
  deploymentId: string;
  script: string;
  url: string;
}

export interface InstanceClient {
  /** Base URL from normalizeInstanceUrl. */
  instanceUrl: string;
  /** GitHub OIDC token (audience bohr.io), or a bohr API token (auth "token"). */
  token: string;
  /** "oidc" (the default): a GitHub Actions run; "token": a bohr API token. Only changes the error hints. */
  auth?: 'oidc' | 'token';
  fetch: Fetch;
  sleep?: Sleep;
  log?: (message: string) => void;
}

export class InstanceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The `code` of the instance's error body, when it has one ("own_account", "production_branch"…). */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'InstanceError';
  }
}

/** Validates the instance-url input; https is required except on localhost, since the URL receives the OIDC token. */
export function normalizeInstanceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`instance-url "${value}" is not a valid URL.`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`instance-url must use https: ${value}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** POST /api/deploy/sessions: sends the assets manifest, receives the buckets to upload. */
export async function createDeploySession(client: InstanceClient, request: SessionRequest): Promise<DeploySession> {
  const response = await fetchWithRetry(
    `${client.instanceUrl}/api/deploy/sessions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(request),
    },
    { fetch: client.fetch, sleep: client.sleep, onRetry: client.log },
  );
  const body = await readInstanceJson(
    response,
    'open a deploy session',
    client.auth === 'token' ? UNKNOWN_TOKEN_PROJECT_HINT : UNKNOWN_PROJECT_HINT,
    client.auth,
  );

  const { sessionId, accountId, uploadToken, buckets } = body;
  if (typeof sessionId !== 'string' || sessionId === '') throw malformed('sessionId');
  if (accountId !== undefined && accountId !== null && typeof accountId !== 'string') throw malformed('accountId');
  if (uploadToken !== undefined && uploadToken !== null && typeof uploadToken !== 'string') {
    throw malformed('uploadToken');
  }
  if (
    buckets !== undefined &&
    !(Array.isArray(buckets) && buckets.every((b) => Array.isArray(b) && b.every((h) => typeof h === 'string')))
  ) {
    throw malformed('buckets');
  }
  return {
    sessionId,
    accountId: accountId || null,
    uploadToken: uploadToken || null,
    buckets: (buckets as string[][] | undefined) ?? [],
  };
}

/** Multipart body of the finalize call: the metadata JSON plus one part per Worker module. */
export function buildFinalizeForm(metadata: FinalizeMetadata, modules: readonly WorkerModule[]): FormData {
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  for (const module of modules) {
    form.append(module.name, new Blob([module.content], { type: module.contentType }), module.name);
  }
  return form;
}

/** POST /api/deploy/sessions/<id>/finalize: publishes the Worker and records the deployment. */
export async function finalizeDeployment(
  client: InstanceClient,
  sessionId: string,
  metadata: FinalizeMetadata,
  modules: readonly WorkerModule[],
): Promise<Deployment> {
  // Not retried: a repeated finalize could publish twice.
  let response: Response;
  try {
    response = await client.fetch(
      `${client.instanceUrl}/api/deploy/sessions/${encodeURIComponent(sessionId)}/finalize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${client.token}`, 'User-Agent': USER_AGENT },
        body: buildFinalizeForm(metadata, modules),
        signal: AbortSignal.timeout(FINALIZE_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new Error(
      `The bohr instance did not answer the finalize call (${errorMessage(error)}). Check the deployment in the bohr panel before running the workflow again.`,
    );
  }
  const body = await readInstanceJson(response, 'finalize the deployment', EXPIRED_SESSION_HINT, client.auth);
  const { deploymentId, script, url } = body;
  if (typeof deploymentId !== 'string' || deploymentId === '') throw malformed('deploymentId');
  if (typeof script !== 'string') throw malformed('script');
  if (typeof url !== 'string' || url === '') throw malformed('url');
  return { deploymentId, script, url };
}

/** What POST /api/deploy/credentials answers for a project in its owner's Cloudflare account. */
export interface DeployCredentials {
  accountId: string;
  apiToken: string;
  /** The production branch's build variables, by name. */
  buildVariables: Record<string, string>;
}

/** POST /api/deploy/credentials: the Cloudflare credentials and build variables of the production deploy. */
export async function requestDeployCredentials(client: InstanceClient): Promise<DeployCredentials> {
  const response = await fetchWithRetry(
    `${client.instanceUrl}/api/deploy/credentials`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.token}`, 'User-Agent': USER_AGENT },
    },
    { fetch: client.fetch, sleep: client.sleep, onRetry: client.log },
  );
  const body = await readInstanceJson(response, 'give the deploy credentials', UNKNOWN_PROJECT_HINT);
  const { accountId, apiToken, buildVariables } = body;
  if (typeof accountId !== 'string' || accountId === '') throw malformed('accountId');
  if (typeof apiToken !== 'string' || apiToken === '') throw malformed('apiToken');
  if (buildVariables !== undefined && !isStringRecord(buildVariables)) throw malformed('buildVariables');
  return { accountId, apiToken, buildVariables: (buildVariables as Record<string, string> | undefined) ?? {} };
}

/** What POST /api/deploy/build-plan answers for a project bohr hosts that keeps bohr v1's workflow. */
export interface BuildPlan {
  nodeVersion: string;
  /** Null: no install step. */
  install: string | null;
  /** Null: no build step. */
  build: string | null;
  /** Files to write into the workspace, by path relative to the repository root. */
  files: Record<string, string>;
  /** The pushed branch's build variables, by name. */
  buildVariables: Record<string, string>;
  /** The production address already moved to bohr.io v2: a failed deploy fails, it does not fall back to v1. */
  live: boolean;
}

/**
 * POST /api/deploy/build-plan: the build plan of this repository's project, or null when the instance has
 * none (404 or `found: false`: the repository is not a project bohr hosts, or has no plan).
 */
export async function requestBuildPlan(client: InstanceClient): Promise<BuildPlan | null> {
  const response = await fetchWithRetry(
    `${client.instanceUrl}/api/deploy/build-plan`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.token}`, 'User-Agent': USER_AGENT },
    },
    { fetch: client.fetch, sleep: client.sleep, onRetry: client.log },
  );
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const body = await readInstanceJson(response, 'give the build plan', UNKNOWN_PROJECT_HINT);
  if (body.found === false) return null;
  if (body.found !== true) throw malformed('found');
  const { nodeVersion, install, build, files, buildVariables, live } = body;
  if (typeof nodeVersion !== 'string' || nodeVersion === '') throw malformed('nodeVersion');
  if (install !== null && install !== undefined && typeof install !== 'string') throw malformed('install');
  if (build !== null && build !== undefined && typeof build !== 'string') throw malformed('build');
  if (files !== undefined && !isStringRecord(files)) throw malformed('files');
  if (buildVariables !== undefined && !isStringRecord(buildVariables)) throw malformed('buildVariables');
  return {
    nodeVersion,
    install: install || null,
    build: build || null,
    files: (files as Record<string, string> | undefined) ?? {},
    buildVariables: (buildVariables as Record<string, string> | undefined) ?? {},
    live: live === true,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

/** Parses a JSON object response, turning errors (JSON `{ error }` bodies) into actionable messages. */
async function readInstanceJson(
  response: Response,
  action: string,
  notFoundHint: string,
  auth: InstanceClient['auth'] = 'oidc',
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === 'string' ? body.error : text.trim().slice(0, 300);
    throw new InstanceError(
      `The bohr instance could not ${action} (HTTP ${response.status}): ${error || response.statusText || 'no details'}${hint(response.status, notFoundHint, auth)}`,
      response.status,
      isRecord(body) && typeof body.code === 'string' ? body.code : null,
    );
  }
  if (!isRecord(body)) {
    throw new InstanceError(
      `The bohr instance answered with an unexpected body (HTTP ${response.status}). Check instance-url.`,
      response.status,
    );
  }
  return body;
}

function hint(status: number, notFoundHint: string, auth: InstanceClient['auth']): string {
  if (status === 401 && auth === 'token') {
    return '\nThe bohr token was rejected: it expired or was revoked. Run bohr login again, or create a new token in the panel (Account › Tokens).';
  }
  if (status === 401) {
    return '\nThe GitHub OIDC token was rejected. Check that instance-url points at the bohr instance that manages this project.';
  }
  return status === 404 ? `\n${notFoundHint}` : '';
}

function malformed(field: string): InstanceError {
  return new InstanceError(`The bohr instance sent a response without a valid "${field}". Check instance-url.`, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
