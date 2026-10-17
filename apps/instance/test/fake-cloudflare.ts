import { CloudflareClient } from '@bohr/cloudflare';

type Route = { id: string; pattern: string; script: string };
type Script = { metadata: Record<string, unknown>; modules: Record<string, { type: string; text: string }> };
export type FakeDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  data?: Record<string, unknown>;
};
type CloudflareMessage = { code: number; message: string; error_chain?: { code: number; message: string }[] };

// In-memory stand-in for the parts of the Cloudflare API the instance calls
export class FakeCloudflare {
  scripts = new Map<string, Script>();
  secrets = new Map<string, Map<string, string>>();
  routes = new Map<string, Route[]>();
  zones = new Map<string, string>();
  /** DNS records by zone id. */
  dns = new Map<string, FakeDnsRecord[]>();
  /** Set to make the next DNS record write fail, as Cloudflare's validation does. */
  rejectDns: CloudflareMessage | null = null;
  storedAssets = new Set<string>();
  /** Set to make every script upload fail, as when Cloudflare rejects a version. */
  rejectScripts: string | null = null;
  calls: { method: string; path: string }[] = [];
  private nextRoute = 1;
  private nextRecord = 1;

  client() {
    return new CloudflareClient({
      apiToken: 'test',
      accountId: 'acc',
      fetch: (input, init) => this.handle(input, init),
    });
  }

  private ok(result: unknown) {
    return Response.json({ success: true, errors: [], result });
  }

  private fail(status: number, code: number, message: string, errors: CloudflareMessage[] = [{ code, message }]) {
    return Response.json({ success: false, errors, result: null }, { status });
  }

  // Cloudflare's content of SRV and CAA records joins their data with tabs
  private dnsRecord(id: string, body: Omit<FakeDnsRecord, 'id'>): FakeDnsRecord {
    const data = body.data ?? {};
    let content = body.content;
    if (body.type === 'SRV') content = `${data.weight}\t${data.port}\t${data.target}`;
    if (body.type === 'CAA') content = `${data.flags}\t${data.tag}\t"${data.value}"`;
    const priority = body.type === 'SRV' ? (data.priority as number) : body.priority;
    return { ...body, id, content, ...(priority === undefined ? {} : { priority }) };
  }

  private handleDns(method: string, url: URL, zoneId: string, recordId: string | undefined, body: unknown) {
    const records = this.dns.get(zoneId);
    if (records === undefined)
      return this.fail(404, 7003, 'Could not route to /zones, perhaps your object identifier is invalid?');
    if (recordId === 'export' && method === 'GET') {
      return new Response(records.map((r) => `${r.name}.\t${r.ttl}\tIN\t${r.type}\t${r.content}`).join('\n'));
    }
    if (recordId === undefined && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 100);
      return Response.json({
        success: true,
        errors: [],
        result: records.slice((page - 1) * perPage, page * perPage),
        result_info: { page, per_page: perPage, count: records.length, total_count: records.length },
      });
    }
    if ((method === 'POST' || method === 'PATCH') && this.rejectDns !== null) {
      const error = this.rejectDns;
      this.rejectDns = null;
      return this.fail(400, error.code, error.message, [error]);
    }
    if (recordId === undefined && method === 'POST') {
      const record = this.dnsRecord(`dns${this.nextRecord++}`, body as Omit<FakeDnsRecord, 'id'>);
      records.push(record);
      return this.ok(record);
    }
    const index = records.findIndex((record) => record.id === recordId);
    const existing = records[index];
    if (existing === undefined) return this.fail(404, 81044, 'Record does not exist.');
    if (method === 'GET') return this.ok(existing);
    if (method === 'PATCH') {
      records[index] = this.dnsRecord(existing.id, { ...existing, ...(body as Partial<FakeDnsRecord>) });
      return this.ok(records[index]);
    }
    if (method === 'DELETE') {
      records.splice(index, 1);
      return this.ok({ id: existing.id });
    }
    return this.fail(405, 10000, 'Method not allowed');
  }

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace('/client/v4', '');
    const method = init?.method ?? 'GET';
    this.calls.push({ method, path });

    const script = path.match(/^\/accounts\/acc\/workers\/dispatch\/namespaces\/[^/]+\/scripts\/([^/]+)(\/.*)?$/);
    if (script) {
      const name = decodeURIComponent(script[1] ?? '');
      const rest = script[2] ?? '';
      if (rest === '/assets-upload-session' && method === 'POST') {
        const { manifest } = JSON.parse(String(init?.body)) as { manifest: Record<string, { hash: string }> };
        const missing = Object.values(manifest)
          .map((entry) => entry.hash)
          .filter((hash) => !this.storedAssets.has(hash));
        return this.ok(
          missing.length > 0
            ? { jwt: `upload-${name}`, buckets: [missing] }
            : { jwt: `completion-${name}`, buckets: [] },
        );
      }
      if (rest === '' && method === 'PUT') {
        if (this.rejectScripts !== null) return this.fail(400, 10021, this.rejectScripts);
        const form = init?.body as FormData;
        const metadata = JSON.parse(await (form.get('metadata') as Blob).text()) as Record<string, unknown>;
        const modules: Script['modules'] = {};
        for (const [key, value] of form.entries()) {
          if (key !== 'metadata' && typeof value !== 'string')
            modules[key] = { type: value.type, text: await value.text() };
        }
        this.scripts.set(name, { metadata, modules });
        return this.ok({ id: name });
      }
      if (rest === '' && method === 'DELETE') {
        this.scripts.delete(name);
        return this.ok(null);
      }
      if (rest === '/secrets' && method === 'PUT') {
        if (!this.scripts.has(name)) return this.fail(404, 10007, 'script not found');
        const { name: key, text } = JSON.parse(String(init?.body)) as { name: string; text: string };
        const secrets = this.secrets.get(name) ?? new Map<string, string>();
        secrets.set(key, text);
        this.secrets.set(name, secrets);
        return this.ok({ name: key });
      }
      const secret = rest.match(/^\/secrets\/(.+)$/);
      if (secret && method === 'DELETE') {
        const deleted = this.secrets.get(name)?.delete(decodeURIComponent(secret[1] ?? ''));
        return deleted ? this.ok(null) : this.fail(404, 10056, 'secret not found');
      }
    }

    const routes = path.match(/^\/zones\/([^/]+)\/workers\/routes(?:\/([^/]+))?$/);
    if (routes) {
      const zone = decodeURIComponent(routes[1] ?? '');
      const id = routes[2];
      const list = this.routes.get(zone) ?? [];
      this.routes.set(zone, list);
      if (method === 'GET') return this.ok(list);
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { pattern: string; script: string };
        const route = { id: `r${this.nextRoute++}`, ...body };
        list.push(route);
        return this.ok(route);
      }
      const index = list.findIndex((route) => route.id === id);
      if (index < 0) return this.fail(404, 10020, 'route not found');
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { pattern: string; script: string };
        list[index] = { id: id ?? '', ...body };
        return this.ok(list[index]);
      }
      if (method === 'DELETE') {
        list.splice(index, 1);
        return this.ok(null);
      }
    }

    const dns = path.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?(\/export)?$/);
    if (dns) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      return this.handleDns(method, url, decodeURIComponent(dns[1] ?? ''), dns[3] ? 'export' : dns[2], body);
    }

    const zone = path.match(/^\/zones\/([^/]+)$/);
    if (zone && method === 'GET') {
      const id = decodeURIComponent(zone[1] ?? '');
      const name = [...this.zones].find(([, zoneId]) => zoneId === id)?.[0];
      return name === undefined
        ? this.fail(404, 1001, 'Invalid zone identifier')
        : this.ok({ id, name, status: 'active' });
    }

    if (path === '/zones' && method === 'GET') {
      const name = url.searchParams.get('name');
      // Without a name: every zone of the account
      if (name === null) return this.ok([...this.zones].map(([zone, id]) => ({ id, name: zone, status: 'active' })));
      const id = this.zones.get(name);
      return this.ok(id ? [{ id, name, status: 'active' }] : []);
    }

    return this.fail(404, 7000, `Unhandled fake route ${method} ${path}`);
  }
}
