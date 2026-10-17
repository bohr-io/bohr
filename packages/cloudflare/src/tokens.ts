import { getWorkersSubdomain } from './account-workers';
import { type CloudflareClient, CloudflareError } from './client';

export type TokenCapability =
  | 'workers_scripts'
  | 'durable_objects'
  | 'containers'
  | 'workers_subdomain'
  | 'account_read';

export type TokenStatus = { id: string; status: string };

export type TokenDiagnosis = {
  /** Every required capability passed; optional ones (OPTIONAL_CAPABILITIES) do not count. */
  ok: boolean;
  capabilities: Record<TokenCapability, boolean>;
  // The API error behind each missing capability, to show the user
  errors: Partial<Record<TokenCapability, string>>;
};

/**
 * Capabilities a connection works without. Containers (the agent's sandbox) need the Workers Paid plan and the
 * Containers: Edit permission; sites, previews, routes and domains run on the free plan without them.
 */
export const OPTIONAL_CAPABILITIES: readonly TokenCapability[] = ['containers'];

const accountPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

// Works for user-owned tokens; account-owned tokens fail here and verify with verifyAccountApiToken
export async function verifyApiToken(cf: CloudflareClient): Promise<TokenStatus> {
  const { id, status } = await cf.request<TokenStatus>('GET', '/user/tokens/verify');
  return { id, status };
}

export async function verifyAccountApiToken(cf: CloudflareClient, accountId: string): Promise<TokenStatus> {
  const { id, status } = await cf.request<TokenStatus>('GET', `${accountPath(accountId)}/tokens/verify`);
  return { id, status };
}

export async function listAccounts(cf: CloudflareClient): Promise<{ id: string; name: string }[]> {
  const accounts = await cf.requestAllPages<{ id: string; name: string }>('/accounts', 50);
  return accounts.map(({ id, name }) => ({ id, name }));
}

// Read-only probes. A read can't prove write access, so a passing diagnosis still needs the first deploy to confirm.
const probes: Record<TokenCapability, (cf: CloudflareClient, accountId: string) => Promise<unknown>> = {
  workers_scripts: (cf, accountId) => cf.request('GET', `${accountPath(accountId)}/workers/scripts`),
  durable_objects: (cf, accountId) =>
    cf.request('GET', `${accountPath(accountId)}/workers/durable_objects/namespaces`, { query: { per_page: 1 } }),
  containers: (cf, accountId) => cf.request('GET', `${accountPath(accountId)}/containers/applications`),
  // An account without a workers.dev subdomain answers "not found", which still proves access (null here)
  workers_subdomain: (cf, accountId) => getWorkersSubdomain(cf, accountId),
  account_read: (cf, accountId) => cf.request('GET', accountPath(accountId)),
};

// 401/403 or "Authentication error" (10000): the token lacks the permission, or the account lacks the product
export function isPermissionError(error: unknown): error is CloudflareError {
  return error instanceof CloudflareError && (error.status === 401 || error.status === 403 || error.hasCode(10000));
}

export async function diagnoseToken(cf: CloudflareClient, accountId: string): Promise<TokenDiagnosis> {
  const names = Object.keys(probes) as TokenCapability[];
  // undefined when the probe passed, otherwise the permission error message
  const failures = await Promise.all(
    names.map(async (capability) => {
      try {
        await probes[capability](cf, accountId);
        return undefined;
      } catch (error) {
        if (isPermissionError(error)) return error.message;
        // An optional capability never blocks a connection: whatever Cloudflare answers, it is just unavailable
        if (OPTIONAL_CAPABILITIES.includes(capability) && error instanceof CloudflareError) return error.message;
        throw error;
      }
    }),
  );
  const capabilities = Object.fromEntries(names.map((name, i) => [name, failures[i] === undefined]));
  const errors = Object.fromEntries(
    names.flatMap((name, i) => (failures[i] === undefined ? [] : [[name, failures[i]]])),
  );
  return {
    ok: names.every((name, i) => failures[i] === undefined || OPTIONAL_CAPABILITIES.includes(name)),
    capabilities: capabilities as Record<TokenCapability, boolean>,
    errors,
  };
}

/** Whether the account can run Containers with this token (Workers Paid and Containers: Edit). */
export async function canRunContainers(cf: CloudflareClient, accountId: string): Promise<boolean> {
  try {
    await probes.containers(cf, accountId);
    return true;
  } catch (error) {
    if (error instanceof CloudflareError) return false;
    throw error;
  }
}

// Permission keys from "API token template URLs" (developers.cloudflare.com/fundamentals/api/how-to/
// account-owned-token-template/). workers_scripts also grants Durable Object namespaces and the workers.dev subdomain.
// Containers has a permission group ("Containers Edit") but no documented template key, so it is left out: it is
// optional (the agent's sandbox in the owner's own account) and the user adds it by hand. d1 (D1: Edit) creates
// the databases of projects started from a template; a connection works without it, and creating such a project
// asks for it (diagnoseToken does not probe it). workers_routes (Workers Routes: Edit, a zone permission) serves a
// domain that already has DNS records from a Worker route when a project moves to its owner's account; probing it
// needs a zone, so diagnoseToken does not either.
export const API_TOKEN_TEMPLATE_PERMISSIONS = [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'account_settings', type: 'read' },
  { key: 'd1', type: 'edit' },
  { key: 'workers_routes', type: 'edit' },
] as const;

// Prefilled "create user API token" page, in the documented user-token format (all accounts, all zones)
export function apiTokenTemplateUrl(options: { name: string }): string {
  const permissionGroupKeys = encodeURIComponent(JSON.stringify(API_TOKEN_TEMPLATE_PERMISSIONS));
  return (
    'https://dash.cloudflare.com/profile/api-tokens' +
    `?permissionGroupKeys=${permissionGroupKeys}&accountId=%2A&zoneId=all&name=${encodeURIComponent(options.name)}`
  );
}
