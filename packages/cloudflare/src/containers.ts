import { type CloudflareClient, CloudflareError } from './client';

// Cloudflare Containers API (/accounts/{id}/containers). Paths and bodies are the ones wrangler 4.149's generated
// client sends (ImageRegistriesService, ContainerImagePreparationsService, ApplicationsService), which use the
// regular { success, result } envelope.

export const CLOUDFLARE_REGISTRY = 'registry.cloudflare.com';

export type RegistryCredentials = { username: string; password: string; registry: string };

export type ContainerApplication = {
  id: string;
  name: string;
  scheduling_policy: string;
  durable_objects?: { namespace_id: string };
};

type ImagePreparation = { image?: string; status: string; artifact_digest?: string; reason?: string };

const containersPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/containers`;

// Short-lived credentials for the managed registry; wrangler's `docker login` asks for push + pull for 15 minutes
export async function createRegistryCredentials(
  cf: CloudflareClient,
  accountId: string,
  options: { permissions?: ('push' | 'pull')[]; expirationMinutes?: number; registry?: string } = {},
): Promise<RegistryCredentials> {
  const registry = options.registry ?? CLOUDFLARE_REGISTRY;
  const result = await cf.request<{ username?: string; password: string; registry_host?: string }>(
    'POST',
    `${containersPath(accountId)}/registries/${encodeURIComponent(registry)}/credentials`,
    {
      json: {
        expiration_minutes: options.expirationMinutes ?? 15,
        permissions: options.permissions ?? ['push', 'pull'],
      },
    },
  );
  return { username: result.username || 'v1', password: result.password, registry: result.registry_host || registry };
}

// Starts or observes the preparation of a digest-pinned managed image; the call is idempotent, so it is polled.
// Loop, statuses and defaults (2 s interval, 15 min timeout) are wrangler's waitForImagePreparation.
export async function prepareContainerImage(
  cf: CloudflareClient,
  accountId: string,
  image: string,
  options: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const preparation = await cf.request<ImagePreparation>('POST', `${containersPath(accountId)}/image-preparations`, {
      json: { image },
    });
    const status = String(preparation.status).toLowerCase();
    if (status === 'ready') return;
    if (status === 'error') {
      throw new Error(`Container image preparation failed for ${image}: ${preparation.reason ?? 'no reason given'}`);
    }
    if (status !== 'pending') {
      throw new Error(`Container image preparation returned an unsupported status for ${image}: ${preparation.status}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms preparing container image ${image}`);
}

// A Durable Object-managed application's id is its Durable Object namespace id
export async function getContainerApplication(
  cf: CloudflareClient,
  accountId: string,
  namespaceId: string,
): Promise<ContainerApplication | null> {
  try {
    return await cf.request<ContainerApplication>(
      'GET',
      `${containersPath(accountId)}/applications/${encodeURIComponent(namespaceId)}`,
    );
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return null;
    throw error;
  }
}

// Creates the application that lets the namespace's Durable Objects run containers, as wrangler's applyApplication does
export async function ensureContainerApplication(
  cf: CloudflareClient,
  accountId: string,
  options: { name: string; namespaceId: string },
): Promise<{ id: string; created: boolean }> {
  const existing = await getContainerApplication(cf, accountId, options.namespaceId);
  if (existing !== null) {
    // Same identity check as wrangler's validateApplicationIdentity
    const namespaceId = existing.durable_objects?.namespace_id ?? existing.id;
    if (
      existing.name !== options.name ||
      existing.scheduling_policy !== 'durable_object' ||
      existing.id !== options.namespaceId ||
      namespaceId !== options.namespaceId
    ) {
      throw new Error(
        `Container application ${existing.id} for Durable Object namespace ${options.namespaceId} is "${existing.name}" ` +
          `(scheduling_policy ${existing.scheduling_policy}, namespace ${namespaceId}); expected "${options.name}" ` +
          `(durable_object, namespace ${options.namespaceId}). Delete it or use the existing name.`,
      );
    }
    return { id: existing.id, created: false };
  }
  const created = await cf.request<ContainerApplication>('POST', `${containersPath(accountId)}/applications`, {
    json: {
      name: options.name,
      scheduling_policy: 'durable_object',
      durable_objects: { namespace_id: options.namespaceId },
    },
  });
  return { id: created.id || options.namespaceId, created: true };
}

/** Removes a container application (and its running instances); nothing to do when it is gone already. */
export async function deleteContainerApplication(
  cf: CloudflareClient,
  accountId: string,
  applicationId: string,
): Promise<void> {
  try {
    await cf.request<unknown>(
      'DELETE',
      `${containersPath(accountId)}/applications/${encodeURIComponent(applicationId)}`,
    );
  } catch (error) {
    if (!(error instanceof CloudflareError && error.status === 404)) throw error;
  }
}
