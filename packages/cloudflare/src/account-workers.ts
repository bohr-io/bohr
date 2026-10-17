import { type CloudflareClient, isNotFoundError } from './client';
import { type ScriptModule, scriptUploadForm } from './workers-for-platforms';

// Scripts that live directly in an account (not in a dispatch namespace). Request shapes follow wrangler 4.149
// (createWorkerUploadForm, `secret put/delete`, subdomainDeploy) and the public API reference.

export type AccountScriptBinding =
  | { type: 'plain_text'; name: string; text: string }
  | { type: 'secret_text'; name: string; text: string }
  | { type: 'durable_object_namespace'; name: string; class_name: string; script_name?: string }
  | { type: 'service'; name: string; service: string; entrypoint?: string };

export type AccountScriptMetadata = {
  main_module: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  bindings?: AccountScriptBinding[];
  keep_bindings?: string[];
  migrations?: { old_tag?: string; new_tag: string; new_sqlite_classes?: string[]; deleted_classes?: string[] };
  // Durable Object-managed containers: images maps an image name to a digest-pinned managed-registry reference
  containers?: { name?: string; class_name: string; images?: Record<string, string> }[];
  observability?: { enabled: boolean };
  tags?: string[];
  /** Version annotations: the deploy message and tag shown in the dashboard's deployments list. */
  annotations?: { 'workers/message'?: string; 'workers/tag'?: string };
};

export type DurableObjectNamespace = { id: string; name: string; script: string | null; class: string | null };

type RawNamespace = {
  id: string;
  name?: string;
  script?: string | null;
  class?: string | null;
  preview?: unknown;
  dispatch_namespace?: string | null;
};

const encode = encodeURIComponent;
const accountPath = (accountId: string) => `/accounts/${encode(accountId)}`;

export function accountScriptPath(accountId: string, scriptName: string) {
  return `${accountPath(accountId)}/workers/scripts/${encode(scriptName)}`;
}

export async function uploadAccountScript(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
  metadata: AccountScriptMetadata,
  modules: ScriptModule[],
): Promise<{ id: string; etag?: string; migrationTag?: string }> {
  const result = await cf.request<{ id: string; etag?: string; migration_tag?: string }>(
    'PUT',
    accountScriptPath(accountId, scriptName),
    // The query wrangler deploy sends: no script body in the response, fail on unresolvable inherit bindings
    { form: scriptUploadForm(metadata, modules), query: { excludeScript: true, bindings_inherit: 'strict' } },
  );
  return { id: result.id, etag: result.etag, migrationTag: result.migration_tag };
}

// wrangler reads the applied Durable Object migration tag from the service's default environment
export async function getAccountScriptSettings(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
): Promise<{ migrationTag?: string } | null> {
  try {
    const service = await cf.request<{ default_environment?: { script?: { migration_tag?: string | null } } }>(
      'GET',
      `${accountPath(accountId)}/workers/services/${encode(scriptName)}`,
    );
    const migrationTag = service.default_environment?.script?.migration_tag;
    return migrationTag ? { migrationTag } : {};
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function deleteAccountScript(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
  options: { force?: boolean } = {},
): Promise<void> {
  try {
    await cf.request<unknown>('DELETE', accountScriptPath(accountId, scriptName), {
      query: { force: options.force ? true : undefined },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function putAccountScriptSecret(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
  name: string,
  value: string,
): Promise<void> {
  await cf.request<unknown>('PUT', `${accountScriptPath(accountId, scriptName)}/secrets`, {
    json: { name, text: value, type: 'secret_text' },
  });
}

export async function deleteAccountScriptSecret(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
  name: string,
): Promise<void> {
  try {
    await cf.request<unknown>('DELETE', `${accountScriptPath(accountId, scriptName)}/secrets/${encode(name)}`, {
      query: { url_encoded: true },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

// The account's <subdomain>.workers.dev label, or null when it has not registered one yet (error 10007)
export async function getWorkersSubdomain(cf: CloudflareClient, accountId: string): Promise<string | null> {
  try {
    const { subdomain } = await cf.request<{ subdomain?: string | null }>(
      'GET',
      `${accountPath(accountId)}/workers/subdomain`,
    );
    return subdomain || null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function enableWorkersDevForScript(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
): Promise<void> {
  await cf.request<unknown>('POST', `${accountScriptPath(accountId, scriptName)}/subdomain`, {
    json: { enabled: true, previews_enabled: false },
    // wrangler pins this API date so previews_enabled is honoured independently of enabled
    headers: { 'Cloudflare-Workers-Script-Api-Date': '2025-08-01' },
  });
}

/**
 * Serves a hostname from a Worker as a Custom Domain (Cloudflare creates the DNS record and certificate).
 * The hostname's zone must be in the same account; a wildcard needs a Worker route instead.
 */
export async function attachWorkerDomain(
  cf: CloudflareClient,
  accountId: string,
  input: { hostname: string; service: string; zoneId: string },
): Promise<void> {
  await cf.request<unknown>('PUT', `${accountPath(accountId)}/workers/domains`, {
    json: { hostname: input.hostname, service: input.service, zone_id: input.zoneId, environment: 'production' },
  });
}

export type WorkerDomain = { id: string; hostname: string; service: string; zoneId: string; zoneName: string };

/** The Custom Domains attached to a Worker (or to every Worker of the account without `service`). */
export async function listWorkerDomains(
  cf: CloudflareClient,
  accountId: string,
  service?: string,
): Promise<WorkerDomain[]> {
  const raw = await cf.request<{ id: string; hostname: string; service: string; zone_id: string; zone_name: string }[]>(
    'GET',
    `${accountPath(accountId)}/workers/domains`,
    { query: service === undefined ? {} : { service } },
  );
  return raw.map((domain) => ({
    id: domain.id,
    hostname: domain.hostname,
    service: domain.service,
    zoneId: domain.zone_id,
    zoneName: domain.zone_name,
  }));
}

/** Detaches a Custom Domain; one already gone is fine. */
export async function detachWorkerDomain(cf: CloudflareClient, accountId: string, domainId: string): Promise<void> {
  try {
    await cf.request<unknown>('DELETE', `${accountPath(accountId)}/workers/domains/${encode(domainId)}`);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

function listRawNamespaces(cf: CloudflareClient, accountId: string) {
  return cf.requestAllPages<RawNamespace>(`${accountPath(accountId)}/workers/durable_objects/namespaces`, 1000);
}

export async function listDurableObjectNamespaces(
  cf: CloudflareClient,
  accountId: string,
): Promise<DurableObjectNamespace[]> {
  return (await listRawNamespaces(cf, accountId)).map((namespace) => ({
    id: namespace.id,
    name: namespace.name ?? '',
    script: namespace.script ?? null,
    class: namespace.class ?? null,
  }));
}

// The namespace a script's migration created for a class, ignoring preview and dispatch namespace copies (as wrangler)
export async function findDurableObjectNamespaceId(
  cf: CloudflareClient,
  accountId: string,
  scriptName: string,
  className: string,
): Promise<string | null> {
  const namespace = (await listRawNamespaces(cf, accountId)).find(
    (candidate) =>
      candidate.class === className &&
      candidate.script === scriptName &&
      (candidate.preview === undefined || candidate.preview === null) &&
      !candidate.dispatch_namespace,
  );
  return namespace?.id ?? null;
}

export function workersDevUrl(scriptName: string, subdomain: string): string {
  return `https://${scriptName}.${subdomain.replace(/\.workers\.dev$/, '')}.workers.dev`;
}
