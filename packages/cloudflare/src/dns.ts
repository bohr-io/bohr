import type { CloudflareClient } from './client';
import type { Zone } from './zones';

// A zone's DNS records. On bohr.io Cloud, bohr's own account hosts the zones of some bohr v1 customers, who manage
// their records in the panel (the instance's services/dns.ts).

export type DnsRecord = {
  id: string;
  type: string;
  /** The full name: "www.example.com", or "example.com" for the zone's apex. */
  name: string;
  content: string;
  /** 1 is "automatic". */
  ttl: number;
  proxied?: boolean;
  proxiable?: boolean;
  priority?: number;
  comment?: string | null;
  /** SRV and CAA records: their fields, which `content` joins with tabs or spaces. */
  data?: Record<string, unknown>;
};

/** A record to create or change: `content` for most types, `data` for SRV and CAA. */
export type DnsRecordInput = {
  type: string;
  name: string;
  content?: string;
  data?: Record<string, unknown>;
  ttl: number;
  proxied?: boolean;
  priority?: number;
};

const recordsPath = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}/dns_records`;

export async function getZone(client: CloudflareClient, zoneId: string): Promise<Zone> {
  const { id, name, status } = await client.request<Zone>('GET', `/zones/${encodeURIComponent(zoneId)}`);
  return { id, name, status };
}

export async function listDnsRecords(client: CloudflareClient, zoneId: string): Promise<DnsRecord[]> {
  return client.requestAllPages<DnsRecord>(recordsPath(zoneId), 100);
}

export async function getDnsRecord(client: CloudflareClient, zoneId: string, recordId: string) {
  return client.request<DnsRecord>('GET', `${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`);
}

export async function createDnsRecord(client: CloudflareClient, zoneId: string, record: DnsRecordInput) {
  return client.request<DnsRecord>('POST', recordsPath(zoneId), { json: record });
}

export async function updateDnsRecord(
  client: CloudflareClient,
  zoneId: string,
  recordId: string,
  record: DnsRecordInput,
) {
  return client.request<DnsRecord>('PATCH', `${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`, {
    json: record,
  });
}

export async function deleteDnsRecord(client: CloudflareClient, zoneId: string, recordId: string) {
  await client.request<unknown>('DELETE', `${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`);
}

/** The zone's records as a BIND zone file, which another Cloudflare account (or any DNS host) can import. */
export async function exportDnsRecords(client: CloudflareClient, zoneId: string): Promise<string> {
  return client.requestText('GET', `${recordsPath(zoneId)}/export`);
}
