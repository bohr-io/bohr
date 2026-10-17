import { describe, expect, it } from 'vitest';
import {
  CloudflareError,
  createDnsRecord,
  deleteDnsRecord,
  exportDnsRecords,
  getZone,
  listDnsRecords,
  updateDnsRecord,
} from '../src';
import { apiPath, cloudflare, fail, fakeFetch, notRouted, ok } from './fake-fetch';

const MX = { id: 'r1', type: 'MX', name: 'example.com', content: 'mx.zoho.com', ttl: 1, priority: 10 };

describe('DNS records', () => {
  it('lists every page of a zone and changes records', async () => {
    const { requests, fetchImpl } = fakeFetch(async (request) => {
      const path = apiPath(request);
      if (path === '/zones/z1' && request.method === 'GET') {
        return ok({ id: 'z1', name: 'example.com', status: 'active', name_servers: ['a.ns.cloudflare.com'] });
      }
      if (path === '/zones/z1/dns_records' && request.method === 'GET') {
        const page = Number(request.url.searchParams.get('page'));
        return ok(page === 1 ? [MX] : [{ ...MX, id: 'r2', priority: 20 }], {
          page,
          per_page: 1,
          count: 1,
          total_count: 2,
        });
      }
      if (path === '/zones/z1/dns_records' && request.method === 'POST') {
        return ok({ id: 'r3', ...(JSON.parse(String(request.body)) as object) });
      }
      if (path === '/zones/z1/dns_records/r3' && request.method === 'PATCH') {
        return ok({ id: 'r3', ...(JSON.parse(String(request.body)) as object) });
      }
      if (path === '/zones/z1/dns_records/r3' && request.method === 'DELETE') return ok({ id: 'r3' });
      return notRouted(request);
    });
    const cf = cloudflare(fetchImpl);

    expect(await getZone(cf, 'z1')).toEqual({ id: 'z1', name: 'example.com', status: 'active' });
    expect((await listDnsRecords(cf, 'z1')).map((record) => record.id)).toEqual(['r1', 'r2']);
    const created = await createDnsRecord(cf, 'z1', { type: 'TXT', name: 'example.com', content: 'v=spf1', ttl: 1 });
    expect(created).toMatchObject({ id: 'r3', type: 'TXT', content: 'v=spf1' });
    await updateDnsRecord(cf, 'z1', 'r3', { type: 'TXT', name: 'example.com', content: 'v=spf1 -all', ttl: 300 });
    await deleteDnsRecord(cf, 'z1', 'r3');
    expect(requests.map((request) => `${request.method} ${apiPath(request)}`)).toEqual([
      'GET /zones/z1',
      'GET /zones/z1/dns_records',
      'GET /zones/z1/dns_records',
      'POST /zones/z1/dns_records',
      'PATCH /zones/z1/dns_records/r3',
      'DELETE /zones/z1/dns_records/r3',
    ]);
  });

  it('reads the BIND export as text, and its failures as Cloudflare errors', async () => {
    const zoneFile = 'example.com.\t1\tIN\tMX\t10 mx.zoho.com.\n';
    const { fetchImpl } = fakeFetch(async (request) => {
      const path = apiPath(request);
      if (path === '/zones/z1/dns_records/export') return new Response(zoneFile);
      if (path === '/zones/gone/dns_records/export') return fail(404, 7003, 'Could not route');
      return notRouted(request);
    });
    const cf = cloudflare(fetchImpl);

    expect(await exportDnsRecords(cf, 'z1')).toBe(zoneFile);
    const error = await exportDnsRecords(cf, 'gone').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudflareError);
    expect((error as CloudflareError).hasCode(7003)).toBe(true);
  });
});
