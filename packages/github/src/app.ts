import { base64Url, utf8 } from './encoding';
import { GithubError } from './errors';
import { createTransport, segment, send, type TransportOptions } from './http';
import { privateKeyPemToPkcs8 } from './pem';

/** Permissions bohr's GitHub App requests. */
export const GITHUB_APP_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  workflows: 'write',
  secrets: 'write',
  actions: 'read',
  metadata: 'read',
  // Organization › Members: bohr organizations mirror the GitHub organization's members
  members: 'read',
  // New projects from a template: the user's authorization creates the repository from bohr's template
  administration: 'write',
} as const;

/**
 * Events bohr's GitHub App subscribes to. installation_repositories (and installation) are not listed because
 * GitHub delivers them to every App and does not allow subscribing to them. organization (members added and
 * removed) needs the members permission.
 */
export const GITHUB_APP_EVENTS = ['push', 'pull_request', 'organization'] as const;

export type AppAuthOptions = TransportOptions & {
  appId: string | number;
  privateKeyPem: string;
  /** Milliseconds since the epoch; defaults to Date.now(). */
  now?: number;
};

export type InstallationTokenOptions = AppAuthOptions & {
  installationId: number;
  /** Repository names (without owner) to restrict the token to. */
  repositories?: string[];
  /** Repository ids to restrict the token to; unlike names, they are never reused. */
  repositoryIds?: number[];
  /** Narrows the token to these permissions. */
  permissions?: Record<string, 'read' | 'write'>;
};

export type InstallationToken = {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
  /** Repository names, present when the token was restricted to repositories. */
  repositories?: string[];
};

export type AppCredentials = {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url: string;
  owner: { login: string };
};

export type AppManifestOptions = {
  name: string;
  /** Homepage of the App. */
  url: string;
  webhookUrl: string;
  /** False registers the App without a webhook: GitHub refuses webhook URLs it cannot reach, like localhost. */
  webhookActive?: boolean;
  /** Where GitHub sends users after they authorize the App (OAuth); up to 10. */
  callbackUrls: string[];
  /** Where GitHub sends users after installing (and, with this set, updating) the App. */
  setupUrl?: string;
  /** Where GitHub sends the manifest `code` after the App is created. */
  redirectUrl: string;
  description?: string;
  /** Installable on any account (true) or only on the owner's (false, the default). */
  public?: boolean;
};

const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const MAX_CACHED_KEYS = 8;
const keyCache = new Map<string, Promise<CryptoKey>>();

function importAppKey(privateKeyPem: string): Promise<CryptoKey> {
  const cached = keyCache.get(privateKeyPem);
  if (cached !== undefined) return cached;
  if (keyCache.size >= MAX_CACHED_KEYS) keyCache.clear();
  const key = crypto.subtle.importKey('pkcs8', privateKeyPemToPkcs8(privateKeyPem), RS256, false, ['sign']);
  keyCache.set(privateKeyPem, key);
  key.catch(() => {
    if (keyCache.get(privateKeyPem) === key) keyCache.delete(privateKeyPem);
  });
  return key;
}

/**
 * JWT that authenticates as the GitHub App (RS256). Issued a minute in the past to absorb clock drift and
 * expiring nine minutes ahead, inside GitHub's ten-minute limit.
 */
export async function createAppJwt(appId: string | number, privateKeyPem: string, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(utf8(JSON.stringify({ iat: issuedAt - 60, exp: issuedAt + 9 * 60, iss: appId })));
  const key = await importAppKey(privateKeyPem);
  const signature = await crypto.subtle.sign(RS256.name, key, utf8(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

/** Installation access token (valid for one hour), optionally narrowed to some repositories and permissions. */
export async function createInstallationToken(options: InstallationTokenOptions): Promise<InstallationToken> {
  const jwt = await createAppJwt(options.appId, options.privateKeyPem, options.now);
  const transport = createTransport(options, jwt);
  const restrictions: Record<string, unknown> = {};
  if (options.repositories !== undefined) restrictions.repositories = options.repositories;
  if (options.repositoryIds !== undefined) restrictions.repository_ids = options.repositoryIds;
  if (options.permissions !== undefined) restrictions.permissions = options.permissions;
  const { data } = await send(
    transport,
    'POST',
    `${transport.apiBase}/app/installations/${segment(options.installationId)}/access_tokens`,
    Object.keys(restrictions).length > 0 ? restrictions : undefined,
  );
  const raw = data as {
    token: string;
    expires_at: string;
    permissions?: Record<string, string>;
    repositories?: { name: string }[];
  };
  const token: InstallationToken = { token: raw.token, expiresAt: raw.expires_at, permissions: raw.permissions ?? {} };
  if (raw.repositories !== undefined) token.repositories = raw.repositories.map((repository) => repository.name);
  return token;
}

/** The App's installation on a repository, or null when the App is not installed there. */
export async function getRepositoryInstallation(
  options: AppAuthOptions & { owner: string; repo: string },
): Promise<{ id: number; account: { login: string } } | null> {
  const transport = createTransport(options, await createAppJwt(options.appId, options.privateKeyPem, options.now));
  const url = `${transport.apiBase}/repos/${segment(options.owner)}/${segment(options.repo)}/installation`;
  try {
    const { data } = await send(transport, 'GET', url);
    const installation = data as { id: number; account: { login: string } };
    return { id: installation.id, account: { login: installation.account.login } };
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Completes the manifest flow: trades the one-time `code` (valid for an hour) for the new App's credentials.
 * Needs no authentication.
 */
export async function exchangeManifestCode(code: string, options: TransportOptions = {}): Promise<AppCredentials> {
  const transport = createTransport(options);
  const { data } = await send(transport, 'POST', `${transport.apiBase}/app-manifests/${segment(code)}/conversions`);
  const app = data as AppCredentials;
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    client_id: app.client_id,
    client_secret: app.client_secret,
    webhook_secret: app.webhook_secret ?? null,
    pem: app.pem,
    html_url: app.html_url,
    owner: { login: app.owner.login },
  };
}

/** GitHub App manifest for the "register from a manifest" flow, with the permissions and events bohr needs. */
export function appManifest(options: AppManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: options.name,
    url: options.url,
    ...(options.webhookActive === false ? {} : { hook_attributes: { url: options.webhookUrl, active: true } }),
    redirect_url: options.redirectUrl,
    callback_urls: options.callbackUrls,
    public: options.public ?? false,
    default_permissions: { ...GITHUB_APP_PERMISSIONS },
    default_events: [...GITHUB_APP_EVENTS],
    request_oauth_on_install: false,
  };
  if (options.description !== undefined) manifest.description = options.description;
  if (options.setupUrl !== undefined) {
    manifest.setup_url = options.setupUrl;
    manifest.setup_on_update = true;
  }
  return manifest;
}
