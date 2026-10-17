import { describe, expect, it } from 'vitest';
import {
  apiTokenTemplateUrl,
  CloudflareError,
  canRunContainers,
  diagnoseToken,
  listAccounts,
  verifyAccountApiToken,
  verifyApiToken,
} from '../src';
import { apiPath, cloudflare, fail, fakeFetch, notRouted, ok } from './fake-fetch';

describe('tokens', () => {
  it('verifies user tokens and account-owned tokens', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      if (apiPath(request) === '/user/tokens/verify') return fail(401, 1000, 'Invalid API Token');
      if (apiPath(request) === '/accounts/acc-1/tokens/verify') {
        return ok({ id: 'tok1', status: 'active', expires_on: '2027-01-01T00:00:00Z' });
      }
      return notRouted(request);
    });
    const cf = cloudflare(fetchImpl);

    const userError = await verifyApiToken(cf).catch((error: unknown) => error);
    expect(userError).toBeInstanceOf(CloudflareError);
    expect((userError as CloudflareError).hasCode(1000)).toBe(true);
    expect(await verifyAccountApiToken(cf, 'acc-1')).toEqual({ id: 'tok1', status: 'active' });
    expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer user-token',
      'Bearer user-token',
    ]);
  });

  it('lists every page of accounts', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      const page = Number(request.url.searchParams.get('page'));
      const info = { page, per_page: 1, count: 1, total_count: 2, total_pages: 2 };
      if (page === 1) return ok([{ id: 'a1', name: 'Personal', type: 'standard' }], info);
      if (page === 2) return ok([{ id: 'a2', name: 'Team', type: 'standard' }], info);
      return notRouted(request);
    });

    expect(await listAccounts(cloudflare(fetchImpl))).toEqual([
      { id: 'a1', name: 'Personal' },
      { id: 'a2', name: 'Team' },
    ]);
    expect(requests.map((request) => `${apiPath(request)}${request.url.search}`)).toEqual([
      '/accounts?page=1&per_page=50',
      '/accounts?page=2&per_page=50',
    ]);
  });

  it('maps permission failures of the probes to missing capabilities', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      switch (apiPath(request)) {
        case '/accounts/acc-1/workers/scripts':
          return ok([]);
        case '/accounts/acc-1/workers/durable_objects/namespaces':
          return ok([], { page: 1, per_page: 1, total_count: 0 });
        case '/accounts/acc-1/containers/applications':
          return fail(403, 10000, 'Authentication error');
        case '/accounts/acc-1/workers/subdomain':
          // No workers.dev subdomain registered yet: still proves the token can read it
          return fail(404, 10007, 'workers.api.error.not_found');
        case '/accounts/acc-1':
          return Response.json({ success: false, errors: [] }, { status: 401 });
        default:
          return notRouted(request);
      }
    });

    const diagnosis = await diagnoseToken(cloudflare(fetchImpl), 'acc-1');

    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.capabilities).toEqual({
      workers_scripts: true,
      durable_objects: true,
      containers: false,
      workers_subdomain: true,
      account_read: false,
    });
    expect(diagnosis.errors.containers).toContain('10000 Authentication error');
    expect(Object.keys(diagnosis.errors).sort()).toEqual(['account_read', 'containers']);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('reports ok when every probe passes', async () => {
    const { fetchImpl } = fakeFetch((request) =>
      apiPath(request) === '/accounts/acc-1/workers/subdomain' ? ok({ subdomain: 'team' }) : ok([]),
    );

    const diagnosis = await diagnoseToken(cloudflare(fetchImpl), 'acc-1');

    expect(diagnosis).toEqual({
      ok: true,
      capabilities: {
        workers_scripts: true,
        durable_objects: true,
        containers: true,
        workers_subdomain: true,
        account_read: true,
      },
      errors: {},
    });
  });

  it('connects without Containers: the optional capability is only recorded', async () => {
    const { fetchImpl } = fakeFetch((request) =>
      apiPath(request) === '/accounts/acc-1/containers/applications'
        ? fail(401, 10000, 'Deploying containers requires the Workers Paid plan')
        : ok([]),
    );
    const cf = cloudflare(fetchImpl);

    const diagnosis = await diagnoseToken(cf, 'acc-1');

    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.capabilities.containers).toBe(false);
    expect(await canRunContainers(cf, 'acc-1')).toBe(false);
  });

  it('treats any Cloudflare error of the Containers probe as unavailable', async () => {
    const { fetchImpl } = fakeFetch((request) =>
      apiPath(request) === '/accounts/acc-1/containers/applications' ? fail(400, 1234, 'not enabled') : ok([]),
    );
    const cf = cloudflare(fetchImpl);

    expect(await diagnoseToken(cf, 'acc-1')).toMatchObject({ ok: true, capabilities: { containers: false } });
    expect(await canRunContainers(cf, 'acc-1')).toBe(false);
  });

  it('lets errors other than permission failures propagate', async () => {
    const { fetchImpl } = fakeFetch((request) =>
      apiPath(request) === '/accounts/acc-1/workers/scripts' ? fail(500, 10013, 'internal error') : ok([]),
    );

    const error = await diagnoseToken(cloudflare(fetchImpl), 'acc-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CloudflareError);
    expect((error as CloudflareError).status).toBe(500);
  });

  it('builds the documented user token template URL', () => {
    const url = apiTokenTemplateUrl({ name: 'bohr instance' });

    expect(url).toBe(
      'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=' +
        '%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C' +
        '%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C' +
        '%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C' +
        '%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%5D' +
        '&accountId=%2A&zoneId=all&name=bohr%20instance',
    );
    const params = new URL(url).searchParams;
    expect(JSON.parse(params.get('permissionGroupKeys') ?? '')).toEqual([
      { key: 'workers_scripts', type: 'edit' },
      { key: 'account_settings', type: 'read' },
      { key: 'd1', type: 'edit' },
      { key: 'workers_routes', type: 'edit' },
    ]);
    expect(params.get('accountId')).toBe('*');
    expect(params.get('name')).toBe('bohr instance');
  });
});
