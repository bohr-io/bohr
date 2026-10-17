import type { CloudflareClient } from './client';

export type Zone = { id: string; name: string; status: string };

/** The zones (domains) of the client's account, active or not. */
export async function listZones(client: CloudflareClient): Promise<Zone[]> {
  const zones = await client.requestAllPages<Zone>('/zones', 50, { 'account.id': client.accountId });
  return zones.map(({ id, name, status }) => ({ id, name, status }));
}

export async function findZoneByName(client: CloudflareClient, name: string): Promise<Zone | null> {
  const zones = await client.request<Zone[]>('GET', '/zones', {
    query: { name, 'account.id': client.accountId, per_page: 1 },
  });
  return zones[0] ?? null;
}

// Tries "a.b.example.com", "b.example.com", "example.com"… and returns the first zone the account owns
export async function findZoneForHostname(client: CloudflareClient, hostname: string): Promise<Zone | null> {
  const labels = hostname.toLowerCase().split('.');
  for (let start = 0; start < labels.length - 1; start++) {
    const zone = await findZoneByName(client, labels.slice(start).join('.'));
    if (zone !== null) return zone;
  }
  return null;
}
