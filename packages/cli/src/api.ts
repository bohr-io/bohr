// The instance's routes for the CLI (/api/cli, apps/instance/src/routes/cli.ts), called with a bohr API token
import { CliError, EXIT, exitCodeForStatus } from './errors';
import { errorMessage, type Fetch, fetchWithRetry, type Sleep } from './http';
import { CLI_VERSION } from './version';

const USER_AGENT = `bohr-cli/${CLI_VERSION} (+https://bohr.io)`;

export interface ApiUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ApiProject {
  id: string;
  name: string;
  /** "owner/name" on GitHub. */
  repository: string;
  productionBranch: string;
  /** managed: bohr hosts it (local deploys work); byo: the owner's Cloudflare account. */
  mode: 'managed' | 'byo';
  status: 'active' | 'migrating' | 'suspended';
  /** owner: may deploy production. */
  role: 'owner' | 'member';
  productionUrl: string | null;
  hostnames: { hostname: string; branch: string; isProduction: boolean; status: 'pending' | 'live' }[];
}

export interface ApiProjectDetail extends ApiProject {
  /** Built from the build plan bohr keeps for it (migrated from bohr v1), not from its own wrangler config. */
  buildPlan: boolean;
}

export interface DeviceLogin {
  deviceCode: string;
  /** What the person sees and confirms in the panel, e.g. "BCDF-GHJK". */
  userCode: string;
  /** The panel's page that approves it, with the code: https://<instance>/cli?code=BCDF-GHJK */
  verificationUrl: string;
  /** Seconds. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

export type DevicePoll =
  | { status: 'pending' | 'denied' | 'expired' }
  | { status: 'approved'; token: string; user: ApiUser };

/**
 * What `bohr deploy` of a project in its owner's Cloudflare account runs wrangler with. apiToken is the owner's
 * Cloudflare token: it only goes to wrangler's environment, never to a log, a file or the result.
 */
export interface OwnAccountCredentials {
  accountId: string;
  apiToken: string;
  buildVariables: Record<string, string>;
  /** The production Worker's name, when the instance could read it from the production branch. */
  workerName?: string;
}

/** A deploy wrangler made in the owner's account, as the CLI reports it to bohr. */
export interface CliDeployReport {
  branch: string;
  production: boolean;
  workerName: string | null;
  versionId: string | null;
  url: string | null;
  /** Only when the working tree had no uncommitted changes. */
  commitSha: string | null;
}

export interface WhoAmI {
  user: ApiUser;
  token: { id: string; name: string; projects: string[] | null; expiresAt: string | null };
}

export class BohrApi {
  constructor(
    readonly instanceUrl: string,
    private readonly token: string | null,
    private readonly fetch: Fetch = globalThis.fetch,
    private readonly sleep?: Sleep,
  ) {}

  me() {
    return this.request<WhoAmI>('GET', '/api/cli/me');
  }

  /** Revokes the token this client calls with. */
  revoke() {
    return this.request<{ revoked: boolean }>('DELETE', '/api/cli/token');
  }

  projects(repository?: string) {
    const query = repository === undefined ? '' : `?repository=${encodeURIComponent(repository)}`;
    return this.request<{ projects: ApiProject[] }>('GET', `/api/cli/projects${query}`);
  }

  project(id: string) {
    return this.request<{ project: ApiProjectDetail }>('GET', `/api/cli/projects/${encodeURIComponent(id)}`);
  }

  /** The owner's Cloudflare credentials for a deploy of a project in their own account (owners only). */
  ownAccountCredentials(id: string, target: { branch: string; production: boolean }) {
    return this.request<OwnAccountCredentials>(
      'POST',
      `/api/cli/projects/${encodeURIComponent(id)}/credentials`,
      target,
    );
  }

  /** Records a deploy wrangler made in the owner's account, for the project's history in bohr. */
  recordDeploy(id: string, report: CliDeployReport) {
    return this.request<{ deploy: { id: string } }>(
      'POST',
      `/api/cli/projects/${encodeURIComponent(id)}/deploys`,
      report,
    );
  }

  startLogin(clientName: string) {
    return this.request<DeviceLogin>('POST', '/api/cli/login', { clientName });
  }

  pollLogin(deviceCode: string) {
    return this.request<DevicePoll>('POST', '/api/cli/login/poll', { deviceCode });
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (this.token !== null) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      // Only reads are retried: a repeated POST could start a second login (or hand out credentials twice)
      response =
        method === 'GET'
          ? await fetchWithRetry(
              `${this.instanceUrl}${path}`,
              { method, headers },
              { fetch: this.fetch, sleep: this.sleep },
            )
          : await this.fetch(`${this.instanceUrl}${path}`, {
              method,
              headers,
              body: body === undefined ? undefined : JSON.stringify(body),
              signal: AbortSignal.timeout(60_000),
            });
    } catch (error) {
      throw new CliError(`Could not reach ${this.instanceUrl}: ${errorMessage(error)}`, EXIT.error, 'network_error');
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    if (!response.ok) {
      const message = typeof record?.error === 'string' ? record.error : text.trim().slice(0, 300);
      const hint =
        response.status === 401 && this.token !== null
          ? ' The token expired or was revoked: run "bohr login" again, or create a new token in the panel (Account › Tokens).'
          : '';
      throw new CliError(
        `${this.instanceUrl} answered HTTP ${response.status}: ${message || response.statusText || 'no details'}${hint}`,
        exitCodeForStatus(response.status),
        typeof record?.code === 'string' ? record.code : `http_${response.status}`,
      );
    }
    if (record === null) {
      throw new CliError(
        `${this.instanceUrl} answered something that is not bohr's API (HTTP ${response.status}). Check the instance URL.`,
      );
    }
    return record as T;
  }
}
