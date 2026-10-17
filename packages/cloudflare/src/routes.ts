import type { CloudflareClient } from './client';

// Worker routes send a zone's traffic for a pattern (e.g. "example.com/*") to a Worker script

export type WorkerRoute = { id: string; pattern: string; script?: string };

const routesPath = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}/workers/routes`;

export async function listWorkerRoutes(client: CloudflareClient, zoneId: string) {
  return client.request<WorkerRoute[]>('GET', routesPath(zoneId));
}

export async function createWorkerRoute(client: CloudflareClient, zoneId: string, pattern: string, script: string) {
  return client.request<WorkerRoute>('POST', routesPath(zoneId), { json: { pattern, script } });
}

export async function updateWorkerRoute(
  client: CloudflareClient,
  zoneId: string,
  routeId: string,
  pattern: string,
  script: string,
) {
  return client.request<WorkerRoute>('PUT', `${routesPath(zoneId)}/${encodeURIComponent(routeId)}`, {
    json: { pattern, script },
  });
}

export async function deleteWorkerRoute(client: CloudflareClient, zoneId: string, routeId: string) {
  await client.request<unknown>('DELETE', `${routesPath(zoneId)}/${encodeURIComponent(routeId)}`);
}

// Points a pattern at a script, creating the route or retargeting an existing one with the same pattern
export async function upsertWorkerRoute(client: CloudflareClient, zoneId: string, pattern: string, script: string) {
  const existing = (await listWorkerRoutes(client, zoneId)).find((route) => route.pattern === pattern);
  if (existing === undefined) return createWorkerRoute(client, zoneId, pattern, script);
  if (existing.script === script) return existing;
  return updateWorkerRoute(client, zoneId, existing.id, pattern, script);
}
