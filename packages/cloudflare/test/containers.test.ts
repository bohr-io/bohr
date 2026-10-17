import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareError,
  createRegistryCredentials,
  ensureContainerApplication,
  getContainerApplication,
  prepareContainerImage,
} from '../src';
import { apiPath, cloudflare, fail, fakeFetch, notRouted, ok } from './fake-fetch';

const image = `registry.cloudflare.com/acc/bohr-agent@sha256:${'b'.repeat(64)}`;

describe('containers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates registry credentials with the body wrangler sends', async () => {
    const { requests, fetchImpl } = fakeFetch(() =>
      ok({ account_id: 'acc', registry_host: 'registry.cloudflare.com', username: 'v1', password: 'jwt' }),
    );
    const cf = cloudflare(fetchImpl);

    expect(await createRegistryCredentials(cf, 'acc')).toEqual({
      username: 'v1',
      password: 'jwt',
      registry: 'registry.cloudflare.com',
    });
    await createRegistryCredentials(cf, 'acc', { permissions: ['pull'], expirationMinutes: 5 });

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url.pathname).toBe(
      '/client/v4/accounts/acc/containers/registries/registry.cloudflare.com/credentials',
    );
    expect(JSON.parse(String(requests[0]?.body))).toEqual({ expiration_minutes: 15, permissions: ['push', 'pull'] });
    expect(JSON.parse(String(requests[1]?.body))).toEqual({ expiration_minutes: 5, permissions: ['pull'] });
  });

  it('polls image preparation until it is ready', async () => {
    const statuses = ['pending', 'pending', 'ready'];
    const { requests, fetchImpl } = fakeFetch((request) =>
      apiPath(request) === '/accounts/acc/containers/image-preparations'
        ? ok({ image, status: statuses.shift(), artifact_digest: 'sha256:prepared' })
        : notRouted(request),
    );
    const sleeps: number[] = [];

    await prepareContainerImage(cloudflare(fetchImpl), 'acc', image, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.method === 'POST')).toBe(true);
    expect(JSON.parse(String(requests[0]?.body))).toEqual({ image });
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('throws the reason when image preparation fails', async () => {
    const statuses = [
      { status: 'pending', reason: 'pulling layers' },
      { status: 'error', reason: 'image is not linux/amd64' },
    ];
    const { fetchImpl } = fakeFetch(() => ok({ image, ...statuses.shift() }));

    await expect(
      prepareContainerImage(cloudflare(fetchImpl), 'acc', image, { intervalMs: 10, sleep: async () => {} }),
    ).rejects.toThrow('image is not linux/amd64');
  });

  it('rejects unknown preparation statuses and API errors', async () => {
    const { fetchImpl } = fakeFetch(() => ok({ image, status: 'queued' }));
    await expect(prepareContainerImage(cloudflare(fetchImpl), 'acc', image)).rejects.toThrow('unsupported status');

    const denied = fakeFetch(() => fail(403, 10000, 'Container image preparation is not enabled for this account'));
    const error = await prepareContainerImage(cloudflare(denied.fetchImpl), 'acc', image).catch((e: unknown) => e);
    expect((error as CloudflareError).status).toBe(403);
  });

  it('times out when preparation stays pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { requests, fetchImpl } = fakeFetch(() => ok({ image, status: 'pending' }));

    await expect(
      prepareContainerImage(cloudflare(fetchImpl), 'acc', image, {
        timeoutMs: 5_000,
        intervalMs: 2_000,
        sleep: async (ms) => {
          vi.setSystemTime(Date.now() + ms);
        },
      }),
    ).rejects.toThrow('Timed out after 5000 ms');
    expect(requests).toHaveLength(3);
  });

  it('returns null for a missing application', async () => {
    const { fetchImpl } = fakeFetch(() => fail(404, 1000, 'APPLICATION_NOT_FOUND'));

    expect(await getContainerApplication(cloudflare(fetchImpl), 'acc', 'ns1')).toBeNull();
  });

  it('creates the Durable Object application when it does not exist', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      if (request.method === 'GET') return Response.json({ error: 'APPLICATION_NOT_FOUND' }, { status: 404 });
      if (request.method === 'POST') {
        return ok({ id: 'ns1', name: 'bohr-p1-project', scheduling_policy: 'durable_object' });
      }
      return notRouted(request);
    });

    const result = await ensureContainerApplication(cloudflare(fetchImpl), 'acc', {
      name: 'bohr-p1-project',
      namespaceId: 'ns1',
    });

    expect(result).toEqual({ id: 'ns1', created: true });
    expect(requests.map((request) => `${request.method} ${apiPath(request)}`)).toEqual([
      'GET /accounts/acc/containers/applications/ns1',
      'POST /accounts/acc/containers/applications',
    ]);
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      name: 'bohr-p1-project',
      scheduling_policy: 'durable_object',
      durable_objects: { namespace_id: 'ns1' },
    });
  });

  it('keeps an existing application with the same identity', async () => {
    const { requests, fetchImpl } = fakeFetch(() =>
      ok({
        id: 'ns1',
        name: 'bohr-p1-project',
        scheduling_policy: 'durable_object',
        durable_objects: { namespace_id: 'ns1' },
      }),
    );

    const result = await ensureContainerApplication(cloudflare(fetchImpl), 'acc', {
      name: 'bohr-p1-project',
      namespaceId: 'ns1',
    });

    expect(result).toEqual({ id: 'ns1', created: false });
    expect(requests).toHaveLength(1);
  });

  it('refuses an existing application with another name or policy', async () => {
    const { requests, fetchImpl } = fakeFetch(() =>
      ok({ id: 'ns1', name: 'someone-else', scheduling_policy: 'default', durable_objects: { namespace_id: 'ns1' } }),
    );

    await expect(
      ensureContainerApplication(cloudflare(fetchImpl), 'acc', { name: 'bohr-p1-project', namespaceId: 'ns1' }),
    ).rejects.toThrow(/"someone-else" \(scheduling_policy default, namespace ns1\); expected "bohr-p1-project"/);
    expect(requests).toHaveLength(1);
  });

  it('surfaces { error } bodies of the Containers API in CloudflareError', async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: 'VALIDATE_INPUT' }, { status: 400 }));

    const error = await ensureContainerApplication(cloudflare(fetchImpl), 'acc', {
      name: 'bohr-p1-project',
      namespaceId: 'ns1',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CloudflareError);
    expect((error as CloudflareError).message).toContain('VALIDATE_INPUT');
  });
});
