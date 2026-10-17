import { describe, expect, it } from 'vitest';
import {
  type AccountScriptMetadata,
  attachWorkerDomain,
  type CloudflareError,
  deleteAccountScript,
  deleteAccountScriptSecret,
  detachWorkerDomain,
  enableWorkersDevForScript,
  findDurableObjectNamespaceId,
  getAccountScriptSettings,
  getWorkersSubdomain,
  listDurableObjectNamespaces,
  listWorkerDomains,
  putAccountScriptSecret,
  uploadAccountScript,
  workersDevUrl,
} from '../src';
import { apiPath, cloudflare, fail, fakeFetch, notRouted, ok } from './fake-fetch';

const ref = `registry.cloudflare.com/acc/bohr-agent@sha256:${'a'.repeat(64)}`;

describe('account workers', () => {
  it('lists and detaches the custom domains of a Worker', async () => {
    const { requests, fetchImpl } = fakeFetch((request) =>
      request.method === 'GET'
        ? ok([{ id: 'd1', hostname: 'loja.example.com', service: 'loja', zone_id: 'z1', zone_name: 'example.com' }])
        : ok(null),
    );
    const cf = cloudflare(fetchImpl);
    expect(await listWorkerDomains(cf, 'acc', 'loja')).toEqual([
      { id: 'd1', hostname: 'loja.example.com', service: 'loja', zoneId: 'z1', zoneName: 'example.com' },
    ]);
    expect(requests[0]?.url.toString()).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/workers/domains?service=loja',
    );
    await detachWorkerDomain(cf, 'acc', 'd1');
    expect(requests[1]).toMatchObject({ method: 'DELETE' });
    expect(requests[1]?.url.pathname).toBe('/client/v4/accounts/acc/workers/domains/d1');
  });

  it('attaches a custom domain to a Worker in the account', async () => {
    const { requests, fetchImpl } = fakeFetch(() => ok({ id: 'dom1' }));
    const cf = cloudflare(fetchImpl);
    await attachWorkerDomain(cf, 'acc', { hostname: 'store.example.com', service: 'store', zoneId: 'zone-1' });
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url.pathname).toBe('/client/v4/accounts/acc/workers/domains');
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      hostname: 'store.example.com',
      service: 'store',
      zone_id: 'zone-1',
      environment: 'production',
    });
  });

  it('uploads a script as multipart with metadata, keep_bindings, migrations and containers', async () => {
    const { requests, fetchImpl } = fakeFetch(() =>
      ok({ id: 'bohr-p1', etag: 'etag-1', migration_tag: 'v1', has_modules: true }),
    );
    const metadata: AccountScriptMetadata = {
      main_module: 'index.js',
      compatibility_date: '2026-10-01',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { type: 'durable_object_namespace', name: 'PROJECT', class_name: 'Project' },
        { type: 'plain_text', name: 'BOHR_PROJECT', text: 'p1' },
      ],
      keep_bindings: ['secret_text'],
      migrations: { new_tag: 'v1', new_sqlite_classes: ['Project'] },
      containers: [{ name: 'bohr-p1-project', class_name: 'Project', images: { agent: ref } }],
      observability: { enabled: true },
    };

    const result = await uploadAccountScript(cloudflare(fetchImpl), 'acc', 'bohr-p1', metadata, [
      { name: 'index.js', content: 'export { Project } from "./project.js";', type: 'application/javascript+module' },
      { name: 'project.js', content: 'export class Project {}', type: 'application/javascript+module' },
      { name: 'data.bin', content: new Uint8Array([1, 2, 3]), type: 'application/octet-stream' },
    ]);

    expect(result).toEqual({ id: 'bohr-p1', etag: 'etag-1', migrationTag: 'v1' });
    const [request] = requests;
    expect(request?.method).toBe('PUT');
    expect(request?.url.pathname).toBe('/client/v4/accounts/acc/workers/scripts/bohr-p1');
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      excludeScript: 'true',
      bindings_inherit: 'strict',
    });
    const form = request?.body as FormData;
    expect([...form.keys()]).toEqual(['metadata', 'index.js', 'project.js', 'data.bin']);
    const metadataPart = form.get('metadata') as Blob;
    expect(metadataPart.type).toBe('application/json');
    expect(JSON.parse(await metadataPart.text())).toEqual(metadata);
    const project = form.get('project.js') as File;
    expect(project.name).toBe('project.js');
    expect(project.type).toBe('application/javascript+module');
    expect(await project.text()).toBe('export class Project {}');
    const data = form.get('data.bin') as File;
    expect(data.type).toBe('application/octet-stream');
    expect(new Uint8Array(await data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reads the applied migration tag and returns null for a missing script', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      if (apiPath(request) === '/accounts/acc/workers/services/bohr-p1') {
        return ok({
          id: 'bohr-p1',
          default_environment: { environment: 'production', script: { migration_tag: 'v2' } },
        });
      }
      if (apiPath(request) === '/accounts/acc/workers/services/bohr-p2') {
        return ok({ id: 'bohr-p2', default_environment: { environment: 'production', script: {} } });
      }
      return fail(404, 10090, 'workers.api.error.service_not_found');
    });
    const cf = cloudflare(fetchImpl);

    expect(await getAccountScriptSettings(cf, 'acc', 'bohr-p1')).toEqual({ migrationTag: 'v2' });
    expect(await getAccountScriptSettings(cf, 'acc', 'bohr-p2')).toEqual({});
    expect(await getAccountScriptSettings(cf, 'acc', 'missing')).toBeNull();
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'GET']);
  });

  it('deletes scripts with force and tolerates missing ones', async () => {
    const { requests, fetchImpl } = fakeFetch((request) =>
      apiPath(request).endsWith('/gone') ? fail(404, 10007, 'workers.api.error.script_not_found') : ok(null),
    );
    const cf = cloudflare(fetchImpl);

    await deleteAccountScript(cf, 'acc', 'bohr-p1', { force: true });
    await deleteAccountScript(cf, 'acc', 'bohr-p1-preview');
    await deleteAccountScript(cf, 'acc', 'gone');

    expect(requests.map((request) => `${request.method} ${apiPath(request)}${request.url.search}`)).toEqual([
      'DELETE /accounts/acc/workers/scripts/bohr-p1?force=true',
      'DELETE /accounts/acc/workers/scripts/bohr-p1-preview',
      'DELETE /accounts/acc/workers/scripts/gone',
    ]);
  });

  it('rethrows delete failures that are not "not found", including 404s for a bad account id', async () => {
    const { fetchImpl } = fakeFetch((request) =>
      apiPath(request).startsWith('/accounts/acc/')
        ? fail(403, 10000, 'Authentication error')
        : fail(404, 7003, 'Could not route to /accounts/wrong/workers/scripts/bohr-p1'),
    );
    const cf = cloudflare(fetchImpl);

    const denied = await deleteAccountScript(cf, 'acc', 'bohr-p1').catch((e: unknown) => e);
    const misrouted = await deleteAccountScript(cf, 'wrong', 'bohr-p1').catch((e: unknown) => e);

    expect((denied as CloudflareError).status).toBe(403);
    expect((misrouted as CloudflareError).hasCode(7003)).toBe(true);
  });

  it('puts and deletes secrets', async () => {
    const { requests, fetchImpl } = fakeFetch((request) =>
      request.method === 'DELETE' && apiPath(request).endsWith('/OLD') ? fail(404, 10056, 'secret not found') : ok({}),
    );
    const cf = cloudflare(fetchImpl);

    await putAccountScriptSecret(cf, 'acc', 'bohr-p1', 'ANTHROPIC_API_KEY', 'sk-ant-1');
    await deleteAccountScriptSecret(cf, 'acc', 'bohr-p1', 'A/B KEY');
    await deleteAccountScriptSecret(cf, 'acc', 'bohr-p1', 'OLD');

    const [put, remove] = requests;
    expect(put?.method).toBe('PUT');
    expect(put?.url.pathname).toBe('/client/v4/accounts/acc/workers/scripts/bohr-p1/secrets');
    expect(put?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(put?.body))).toEqual({ name: 'ANTHROPIC_API_KEY', text: 'sk-ant-1', type: 'secret_text' });
    expect(remove?.method).toBe('DELETE');
    expect(remove?.url.toString()).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/workers/scripts/bohr-p1/secrets/A%2FB%20KEY?url_encoded=true',
    );
    expect(requests).toHaveLength(3);
  });

  it('reads the workers.dev subdomain and enables it for a script', async () => {
    const { requests, fetchImpl } = fakeFetch((request) => {
      if (apiPath(request) === '/accounts/acc/workers/subdomain') return ok({ subdomain: 'team' });
      if (apiPath(request) === '/accounts/new/workers/subdomain') return fail(404, 10007, 'not found');
      if (apiPath(request) === '/accounts/acc/workers/scripts/bohr-p1/subdomain') {
        return ok({ enabled: true, previews_enabled: false });
      }
      return notRouted(request);
    });
    const cf = cloudflare(fetchImpl);

    expect(await getWorkersSubdomain(cf, 'acc')).toBe('team');
    expect(await getWorkersSubdomain(cf, 'new')).toBeNull();
    await enableWorkersDevForScript(cf, 'acc', 'bohr-p1');

    const enable = requests[2];
    expect(enable?.method).toBe('POST');
    expect(JSON.parse(String(enable?.body))).toEqual({ enabled: true, previews_enabled: false });
    expect(enable?.headers.get('cloudflare-workers-script-api-date')).toBe('2025-08-01');
    expect(workersDevUrl('bohr-p1', 'team')).toBe('https://bohr-p1.team.workers.dev');
  });

  it('lists every page of Durable Object namespaces', async () => {
    const pages = [
      [
        { id: 'ns1', name: 'bohr-p1_Project', script: 'bohr-p1', class: 'Project', use_sqlite: true },
        { id: 'ns2', name: 'orphan' },
      ],
      [{ id: 'ns3', name: 'bohr-p2_Project', script: 'bohr-p2', class: 'Project', use_sqlite: true }],
    ];
    const { requests, fetchImpl } = fakeFetch((request) => {
      const page = Number(request.url.searchParams.get('page'));
      return ok(pages[page - 1] ?? [], { page, per_page: 2, count: pages[page - 1]?.length ?? 0, total_count: 3 });
    });

    const namespaces = await listDurableObjectNamespaces(cloudflare(fetchImpl), 'acc');

    expect(namespaces).toEqual([
      { id: 'ns1', name: 'bohr-p1_Project', script: 'bohr-p1', class: 'Project' },
      { id: 'ns2', name: 'orphan', script: null, class: null },
      { id: 'ns3', name: 'bohr-p2_Project', script: 'bohr-p2', class: 'Project' },
    ]);
    expect(requests.map((request) => `${apiPath(request)}${request.url.search}`)).toEqual([
      '/accounts/acc/workers/durable_objects/namespaces?page=1&per_page=1000',
      '/accounts/acc/workers/durable_objects/namespaces?page=2&per_page=1000',
    ]);
  });

  it("finds a script's namespace for a class, skipping preview and dispatch namespace copies", async () => {
    const { fetchImpl } = fakeFetch(() =>
      ok(
        [
          { id: 'preview', script: 'bohr-p1', class: 'Project', preview: { id: 'v1' } },
          { id: 'dispatch', script: 'bohr-p1', class: 'Project', dispatch_namespace: 'ns' },
          { id: 'other-class', script: 'bohr-p1', class: 'Queue' },
          { id: 'live', script: 'bohr-p1', class: 'Project' },
        ],
        { page: 1, per_page: 1000, total_count: 4 },
      ),
    );
    const cf = cloudflare(fetchImpl);

    expect(await findDurableObjectNamespaceId(cf, 'acc', 'bohr-p1', 'Project')).toBe('live');
    expect(await findDurableObjectNamespaceId(cf, 'acc', 'bohr-p9', 'Project')).toBeNull();
  });
});
