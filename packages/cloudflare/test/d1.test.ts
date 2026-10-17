import { describe, expect, it } from 'vitest';
import {
  CloudflareError,
  createD1Database,
  deleteD1Database,
  findD1Database,
  isPermissionError,
  listD1Databases,
} from '../src';
import { apiPath, cloudflare, fail, fakeFetch, notRouted, ok } from './fake-fetch';

describe('D1', () => {
  it('creates a database, finds it by its exact name and deletes it', async () => {
    const { requests, fetchImpl } = fakeFetch(async (request) => {
      const path = apiPath(request);
      if (path === '/accounts/acc-1/d1/database' && request.method === 'POST') {
        const { name } = JSON.parse(String(request.body)) as { name: string };
        return ok({ uuid: 'db-uuid-1', name, created_at: '2026-10-12T00:00:00Z', version: 'production' });
      }
      if (path === '/accounts/acc-1/d1/database' && request.method === 'GET') {
        return ok(
          [
            { uuid: 'db-uuid-2', name: 'loja-db-old' },
            { uuid: 'db-uuid-1', name: 'loja-db' },
          ],
          { page: 1, per_page: 100, count: 2, total_count: 2 },
        );
      }
      if (path === '/accounts/acc-1/d1/database/db-uuid-1' && request.method === 'DELETE') return ok(null);
      if (path === '/accounts/acc-1/d1/database/gone' && request.method === 'DELETE') {
        return fail(404, 7404, 'The database gone could not be found');
      }
      return notRouted(request);
    });
    const cf = cloudflare(fetchImpl);

    expect(await createD1Database(cf, 'acc-1', 'loja-db')).toEqual({ uuid: 'db-uuid-1', name: 'loja-db' });
    expect(await findD1Database(cf, 'acc-1', 'loja-db')).toEqual({ uuid: 'db-uuid-1', name: 'loja-db' });
    expect(await findD1Database(cf, 'acc-1', 'loja')).toBeNull();
    expect(await listD1Databases(cf, 'acc-1')).toHaveLength(2);
    await deleteD1Database(cf, 'acc-1', 'db-uuid-1');
    await deleteD1Database(cf, 'acc-1', 'gone');

    expect(requests.map((request) => `${request.method} ${apiPath(request)}${request.url.search}`)).toEqual([
      'POST /accounts/acc-1/d1/database',
      'GET /accounts/acc-1/d1/database?name=loja-db&page=1&per_page=100',
      'GET /accounts/acc-1/d1/database?name=loja&page=1&per_page=100',
      'GET /accounts/acc-1/d1/database?page=1&per_page=100',
      'DELETE /accounts/acc-1/d1/database/db-uuid-1',
      'DELETE /accounts/acc-1/d1/database/gone',
    ]);
    expect(requests[0]?.headers.get('content-type')).toBe('application/json');
    expect(requests[0]?.headers.get('user-agent')).toBe('bohr (+https://bohr.io)');
  });

  it('tells a token without D1 apart from other failures', async () => {
    const { fetchImpl } = fakeFetch(() => fail(403, 10000, 'Authentication error'));
    const error = await listD1Databases(cloudflare(fetchImpl), 'acc-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CloudflareError);
    expect(isPermissionError(error)).toBe(true);
    expect(isPermissionError(new CloudflareError(500, [{ code: 7500, message: 'boom' }], '/x'))).toBe(false);
  });
});
