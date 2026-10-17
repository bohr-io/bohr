import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { auditLog, dnsZones, identities, orgMembers, orgs, sessions, users } from '../src/db/schema';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { guardOf, recordName, validateRecord } from '../src/services/dns';
import type { FakeCloudflare, FakeDnsRecord } from './fake-cloudflare';
import { adminHeaders, call, importProject, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const json = { 'Content-Type': 'application/json' };

// example.com as bohr v1 left it in bohr's account: placeholder records for the sites bohr serves (the apex,
// www and, through the wildcard, shop), the customer's mail (Zoho) and servers, and Cloudflare's nameservers
const EXAMPLE: FakeDnsRecord[] = [
  { id: 'apex', type: 'A', name: 'example.com', content: '255.255.255.255', ttl: 1, proxied: true },
  { id: 'wild', type: 'A', name: '*.example.com', content: '255.255.255.255', ttl: 1, proxied: true },
  { id: 'www', type: 'CNAME', name: 'www.example.com', content: 'example.com', ttl: 1, proxied: true },
  { id: 'ns1', type: 'NS', name: 'example.com', content: 'ada.ns.cloudflare.com', ttl: 86400 },
  { id: 'mx', type: 'MX', name: 'example.com', content: 'mx.zoho.com', ttl: 1, priority: 10 },
  { id: 'spf', type: 'TXT', name: 'example.com', content: 'v=spf1 include:zoho.com ~all', ttl: 1 },
  { id: 'dkim', type: 'TXT', name: 'zmail._domainkey.example.com', content: 'v=DKIM1; k=rsa; p=MIGf', ttl: 1 },
  { id: 'erp', type: 'A', name: 'erp.example.com', content: '203.0.113.5', ttl: 300, proxied: false },
  { id: 'api', type: 'A', name: 'api.example.com', content: '203.0.113.9', ttl: 1, proxied: true },
];

type Person = { id: string; headers: Record<string, string> };

async function signIn(id: string): Promise<Person> {
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: id, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { id, headers: { Cookie: `__Host-bohr_session=${token}`, ...json } };
}

async function person(id: string, role: 'user' | 'admin' = 'user') {
  await db.insert(users).values({ id, name: id, role }).run();
  return signIn(id);
}

const send = (method: string, path: string, who: Person, body?: unknown) =>
  call(path, { method, headers: who.headers, body: body === undefined ? undefined : JSON.stringify(body) });

async function importZones(zones: unknown[]) {
  const response = await call('/api/admin/dns-zones', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ zones }),
  });
  return { response, body: (await response.json()) as { zones: { name: string; status: string; reason?: string }[] } };
}

type RecordsBody = {
  zone: { name: string; canEdit: boolean; access: string; org: { slug: string } | null };
  records: {
    id: string;
    type: string;
    name: string;
    content: string;
    priority: number | null;
    managedByBohr: boolean;
    editable: boolean;
  }[];
  error?: string;
};

let cloudflare: FakeCloudflare;
let alice: Person;

beforeEach(async () => {
  await resetStorage();
  cloudflare = useFakes();
  cloudflare.zones.set('example.com', 'zone-example');
  cloudflare.zones.set('acme.dev', 'zone-acme');
  cloudflare.dns.set(
    'zone-example',
    EXAMPLE.map((record) => ({ ...record })),
  );
  cloudflare.dns.set('zone-acme', [
    { id: 'acme-mx', type: 'MX', name: 'acme.dev', content: 'mx.acme.dev', ttl: 1, priority: 5 },
  ]);
  cloudflare.routes.set('zone-example', [
    { id: 'r-www', pattern: 'www.example.com/*', script: 'bohr-dispatcher' },
    { id: 'r-api', pattern: 'api.example.com/*', script: 'someone-else' },
  ]);
  cloudflare.routes.set('zone-acme', []);
  // alice (GitHub 1001) owns the site served at the apex and at shop.example.com (through the wildcard)
  await importProject({
    hostnames: [
      { hostname: 'example.com', branch: 'main', isProduction: true, zoneId: 'zone-example' },
      { hostname: 'shop.example.com', branch: 'main', isProduction: false, zoneId: 'zone-example' },
    ],
  });
  const identity = await db.select().from(identities).where(eq(identities.providerUserId, '1001')).get();
  alice = await signIn(identity?.userId ?? '');
  await importZones([
    { name: 'example.com', cloudflareZoneId: 'zone-example', owner: { github: { githubId: 1001, login: 'alice' } } },
  ]);
});

describe('bohr.io Cloud only', () => {
  it('answers 404 on other instances, signed in or not', async () => {
    const selfHosted = { ...env, CF_API_TOKEN: undefined, CF_ACCOUNT_ID: undefined };
    const signedIn = await app.request('/api/dns/zones', { headers: alice.headers }, selfHosted);
    expect(signedIn.status).toBe(404);
    expect((await app.request('/api/dns/zones', {}, selfHosted)).status).toBe(404);
    expect((await call('/api/dns/zones')).status).toBe(401);
  });
});

describe('admin import', () => {
  it('records each zone with its owner and skips the ones it cannot take', async () => {
    await db
      .insert(orgs)
      .values({ id: 'o_acme', slug: 'acme', name: 'Acme', githubAccountId: 7001, githubLogin: 'Acme' })
      .run();
    cloudflare.zones.set('other.com', 'zone-other');
    const { response, body } = await importZones([
      { name: 'Acme.dev.', cloudflareZoneId: 'zone-acme', owner: { org: { login: 'ACME' } } },
      { name: 'bohr.io', cloudflareZoneId: 'zone-bohr', owner: { github: { githubId: 1001, login: 'alice' } } },
      { name: 'gone.com', cloudflareZoneId: 'zone-gone', owner: { github: { githubId: 1001, login: 'alice' } } },
      { name: 'renamed.com', cloudflareZoneId: 'zone-other', owner: { github: { githubId: 1001, login: 'alice' } } },
      { name: 'other.com', cloudflareZoneId: 'zone-other', owner: { org: { login: 'globex' } } },
      { name: 'example.com', cloudflareZoneId: 'zone-example', owner: { github: { githubId: 1003, login: 'carol' } } },
    ]);
    expect(response.status).toBe(200);
    expect(body.zones.map(({ name, status }) => `${name} ${status}`)).toEqual([
      'acme.dev created',
      'bohr.io skipped',
      'gone.com skipped',
      'renamed.com skipped',
      'other.com skipped',
      'example.com updated',
    ]);
    expect(body.zones[3]?.reason).toBe('the zone zone-other is other.com in Cloudflare');
    expect(body.zones[4]?.reason).toContain('import the organization first');

    const rows = await db.select().from(dnsZones).orderBy(dnsZones.name).all();
    const carol = await db.select().from(identities).where(eq(identities.username, 'carol')).get();
    expect(rows.map(({ name, userId, orgId }) => ({ name, userId, orgId }))).toEqual([
      { name: 'acme.dev', userId: null, orgId: 'o_acme' },
      { name: 'example.com', userId: carol?.userId, orgId: null },
    ]);
    const imports = await db.select().from(auditLog).where(eq(auditLog.action, 'dns.zone.import')).all();
    expect(imports.map((entry) => entry.target).sort()).toEqual(['dns:acme.dev', 'dns:example.com', 'dns:example.com']);
  });

  it('needs the admin token', async () => {
    const response = await call('/api/admin/dns-zones', { method: 'POST', headers: json, body: '{"zones":[]}' });
    expect(response.status).toBe(401);
  });
});

describe('who sees and changes a zone', () => {
  let ana: Person;
  let bob: Person;
  let eve: Person;

  beforeEach(async () => {
    ana = await person('u_ana');
    bob = await person('u_bob');
    eve = await person('u_eve');
    await db
      .insert(orgs)
      .values({ id: 'o_acme', slug: 'acme', name: 'Acme', githubAccountId: 7001, githubLogin: 'acme' })
      .run();
    await db
      .insert(orgMembers)
      .values([
        {
          orgId: 'o_acme',
          githubUserId: 1,
          githubLogin: 'ana',
          userId: 'u_ana',
          role: 'admin',
          status: 'active',
          source: 'github',
        },
        {
          orgId: 'o_acme',
          githubUserId: 2,
          githubLogin: 'bob',
          userId: 'u_bob',
          role: 'member',
          status: 'active',
          source: 'github',
        },
      ])
      .run();
    await importZones([
      { name: 'acme.dev', cloudflareZoneId: 'zone-acme', owner: { org: { login: 'acme', githubId: 7001 } } },
    ]);
  });

  it('lists the own zones and those of the orgs, with whether they can be edited', async () => {
    const zones = async (who: Person) =>
      ((await (await send('GET', '/api/dns/zones', who)).json()) as { zones: unknown[] }).zones;
    expect(await zones(alice)).toEqual([{ name: 'example.com', canEdit: true, org: null }]);
    expect(await zones(ana)).toEqual([{ name: 'acme.dev', canEdit: true, org: { slug: 'acme', name: 'Acme' } }]);
    expect(await zones(bob)).toEqual([{ name: 'acme.dev', canEdit: false, org: { slug: 'acme', name: 'Acme' } }]);
    expect(await zones(eve)).toEqual([]);
  });

  it('lets org admins edit, org members read and nobody else in', async () => {
    const records = await send('GET', '/api/dns/zones/acme.dev/records', bob);
    expect(records.status).toBe(200);
    expect(((await records.json()) as RecordsBody).zone).toEqual({
      name: 'acme.dev',
      canEdit: false,
      access: 'member',
      org: { slug: 'acme', name: 'Acme' },
    });
    const txt = { type: 'TXT', name: '@', content: 'hello' };
    expect((await send('POST', '/api/dns/zones/acme.dev/records', bob, txt)).status).toBe(403);
    expect((await send('DELETE', '/api/dns/zones/acme.dev/records/acme-mx', bob)).status).toBe(403);
    expect((await send('GET', '/api/dns/zones/acme.dev/records', eve)).status).toBe(404);
    expect((await send('POST', '/api/dns/zones/acme.dev/records', eve, txt)).status).toBe(404);
    expect((await send('GET', '/api/dns/zones/acme.dev/records', alice)).status).toBe(404);
    expect((await send('POST', '/api/dns/zones/acme.dev/records', ana, txt)).status).toBe(201);
  });

  it('lists every zone of the bohr account to instance admins, with its owner, and opens unassigned ones', async () => {
    const admin = await person('u_root', 'admin');
    const listed = (await (await send('GET', '/api/dns/zones', admin)).json()) as { zones: unknown[] };
    expect(listed.zones).toEqual([
      { name: 'acme.dev', canEdit: true, org: { slug: 'acme', name: 'Acme' }, owner: 'acme' },
      { name: 'bohr.io', canEdit: true, org: null, owner: null },
      { name: 'example.com', canEdit: true, org: null, owner: 'alice' },
    ]);
    // bohr.io was given to nobody: admins open it all the same
    cloudflare.dns.set('zone-bohr', []);
    if (!cloudflare.routes.has('zone-bohr')) cloudflare.routes.set('zone-bohr', []);
    const unassigned = await send('GET', '/api/dns/zones/bohr.io/records', admin);
    expect(unassigned.status).toBe(200);
    expect(((await unassigned.json()) as RecordsBody).zone).toMatchObject({ name: 'bohr.io', access: 'admin' });
    // Everyone else sees only their own
    const own = (await (await send('GET', '/api/dns/zones', alice)).json()) as { zones: { name: string }[] };
    expect(own.zones.map((zone) => zone.name)).toEqual(['example.com']);
    expect((await send('GET', '/api/dns/zones/bohr.io/records', alice)).status).toBe(404);
  });

  it('lets instance admins change any zone, audited as admin', async () => {
    const admin = await person('u_root', 'admin');
    const response = await send('PATCH', '/api/dns/zones/acme.dev/records/acme-mx', admin, { priority: 20 });
    expect(response.status).toBe(200);
    expect(((await response.json()) as RecordsBody).zone.access).toBe('admin');
    const entry = await db.select().from(auditLog).where(eq(auditLog.action, 'dns.record.update')).get();
    expect(entry).toMatchObject({ actor: 'admin:u_root', actorUserId: 'u_root', target: 'dns:acme.dev' });
    expect(entry?.metadata).toMatchObject({ before: { priority: 5 }, after: { priority: 20 } });
  });
});

describe('records', () => {
  const records = async () =>
    (await (await send('GET', '/api/dns/zones/example.com/records', alice)).json()) as RecordsBody;

  it("lists Cloudflare's records and marks the ones bohr needs", async () => {
    const body = await records();
    expect(body.zone).toEqual({ name: 'example.com', canEdit: true, access: 'member', org: null });
    const marks = Object.fromEntries(body.records.map((record) => [record.id, record.managedByBohr]));
    expect(marks).toEqual({
      apex: true, // the apex is a hostname of alice's site
      wild: true, // shop.example.com, another hostname, resolves through it
      www: true, // a route of the zone sends it to the dispatcher
      ns1: true,
      mx: false,
      spf: false,
      dkim: false,
      erp: false,
      api: true, // a route sends it to another Worker (a project that moved to its owner's account)
    });
    expect(body.records[0]?.name).toBe('example.com');
    expect(body.records.find((record) => record.id === 'ns1')?.editable).toBe(false);
    expect(body.records.find((record) => record.id === 'mx')).toMatchObject({ priority: 10, editable: true });
  });

  it('marks proxied placeholders under a wildcard route of the v1 edge', async () => {
    cloudflare.routes.get('zone-example')?.push({ id: 'r-v1', pattern: '*.example.com/*', script: 'bohr-tunnel' });
    cloudflare.dns.get('zone-example')?.push({
      id: 'blog',
      type: 'AAAA',
      name: 'blog.example.com',
      content: '100::',
      ttl: 1,
      proxied: true,
    });
    const body = await records();
    expect(body.records.find((record) => record.id === 'blog')?.managedByBohr).toBe(true);
    // Its own route (another Worker) keeps it locked, whatever the v1 edge does
    expect(body.records.find((record) => record.id === 'api')?.managedByBohr).toBe(true);
  });

  it('creates, changes and deletes the records bohr does not need, with an audit of each change', async () => {
    const created = await send('POST', '/api/dns/zones/example.com/records', alice, {
      type: 'A',
      name: 'vpn',
      content: '198.51.100.7',
      ttl: 3600,
    });
    expect(created.status).toBe(201);
    const vpn = ((await created.json()) as RecordsBody).records.find((record) => record.name === 'vpn.example.com');
    expect(vpn).toMatchObject({ type: 'A', content: '198.51.100.7', managedByBohr: false });

    const changed = await send('PATCH', '/api/dns/zones/example.com/records/erp', alice, {
      content: '203.0.113.50',
      proxied: true,
    });
    expect(changed.status).toBe(200);
    expect(cloudflare.dns.get('zone-example')?.find((record) => record.id === 'erp')).toMatchObject({
      content: '203.0.113.50',
      proxied: true,
      ttl: 1,
    });

    expect((await send('DELETE', '/api/dns/zones/example.com/records/dkim', alice)).status).toBe(200);
    expect(cloudflare.dns.get('zone-example')?.some((record) => record.id === 'dkim')).toBe(false);

    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.target, 'dns:example.com'), eq(auditLog.actor, `user:${alice.id}`)))
      .orderBy(auditLog.createdAt)
      .all();
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'dns.record.create',
      'dns.record.delete',
      'dns.record.update',
    ]);
    const update = entries.find((entry) => entry.action === 'dns.record.update');
    expect(update?.metadata).toEqual({
      before: {
        id: 'erp',
        type: 'A',
        name: 'erp.example.com',
        content: '203.0.113.5',
        ttl: 300,
        proxied: false,
        priority: null,
      },
      after: {
        id: 'erp',
        type: 'A',
        name: 'erp.example.com',
        content: '203.0.113.50',
        ttl: 1,
        proxied: true,
        priority: null,
      },
    });
    expect(entries.find((entry) => entry.action === 'dns.record.delete')?.metadata).toMatchObject({
      before: { id: 'dkim', type: 'TXT' },
    });
  });

  it('sends SRV and CAA records as their fields and shows them as people write them', async () => {
    const srv = await send('POST', '/api/dns/zones/example.com/records', alice, {
      type: 'SRV',
      name: '_sip._tcp',
      content: '5 5060 sip.example.com',
      priority: 10,
    });
    expect(srv.status).toBe(201);
    const caa = await send('POST', '/api/dns/zones/example.com/records', alice, {
      type: 'CAA',
      name: '@',
      content: '0 issue "letsencrypt.org"',
    });
    const body = (await caa.json()) as RecordsBody;
    expect(body.records.find((record) => record.type === 'SRV')).toMatchObject({
      name: '_sip._tcp.example.com',
      content: '5 5060 sip.example.com',
      priority: 10,
    });
    expect(body.records.find((record) => record.type === 'CAA')?.content).toBe('0 issue "letsencrypt.org"');
    expect(cloudflare.dns.get('zone-example')?.find((record) => record.type === 'CAA')?.data).toEqual({
      flags: 0,
      tag: 'issue',
      value: 'letsencrypt.org',
    });
  });

  it('refuses invalid records before Cloudflare, and says why Cloudflare refused one', async () => {
    const attempt = async (body: Record<string, unknown>) => {
      const response = await send('POST', '/api/dns/zones/example.com/records', alice, body);
      return { status: response.status, error: ((await response.json()) as { error: string }).error };
    };
    expect(await attempt({ type: 'A', name: 'x', content: '300.1.1.1' })).toMatchObject({ status: 400 });
    expect((await attempt({ type: 'A', name: 'x.other.com.', content: '1.1.1.1' })).error).toBe(
      'x.other.com. is not inside example.com.',
    );
    expect((await attempt({ type: 'TXT', name: 'x', content: 'a', ttl: 30 })).error).toContain('TTL');
    expect((await attempt({ type: 'MX', name: '@', content: 'mx.example.net' })).error).toContain('priority');
    expect((await attempt({ type: 'TXT', name: 'x', content: 'a', proxied: true })).error).toContain('proxied');
    expect((await attempt({ type: 'A', name: 'x', content: '1.1.1.1', priority: 1 })).error).toContain('priority');
    expect((await attempt({ type: 'NS', name: 'x', content: 'ns.example.net' })).status).toBe(400);
    expect(cloudflare.calls.filter((entry) => entry.method === 'POST')).toEqual([]);

    cloudflare.rejectDns = {
      code: 1004,
      message: 'DNS Validation Error',
      error_chain: [{ code: 9005, message: 'Content for TXT record is invalid.' }],
    };
    expect(await attempt({ type: 'TXT', name: 'x', content: 'a' })).toEqual({
      status: 400,
      error: 'Cloudflare refused the record: Content for TXT record is invalid.',
    });
  });

  it('keeps the records bohr needs read-only, and names that bohr serves free of new ones', async () => {
    const attempt = async (method: string, path: string, body?: unknown) => {
      const response = await send(method, `/api/dns/zones/example.com/records${path}`, alice, body);
      return { status: response.status, error: ((await response.json()) as { error: string }).error };
    };
    expect(await attempt('PATCH', '/apex', { content: '1.2.3.4' })).toMatchObject({ status: 409 });
    expect((await attempt('DELETE', '/www')).error).toContain('to serve a site');
    expect((await attempt('DELETE', '/ns1')).error).toContain('nameservers');
    expect((await attempt('DELETE', '/wild')).status).toBe(409);
    // A second address at the apex would split its traffic; a record of its own would end shop's wildcard
    expect((await attempt('POST', '', { type: 'A', name: '@', content: '1.2.3.4' })).status).toBe(409);
    expect((await attempt('POST', '', { type: 'CNAME', name: 'shop', content: 'elsewhere.net' })).status).toBe(409);
    expect((await attempt('POST', '', { type: 'TXT', name: 'shop', content: 'x' })).error).toContain(
      'through the *.example.com record',
    );
    // Moving a record of its own onto a name bohr serves
    expect((await attempt('PATCH', '/erp', { name: 'www' })).status).toBe(409);
    expect(cloudflare.calls.filter((entry) => entry.method !== 'GET')).toEqual([]);
    // Everything else at those names is the customer's
    expect((await attempt('POST', '', { type: 'TXT', name: '@', content: 'google-site-verification=x' })).status).toBe(
      201,
    );
  });

  it('exports the zone file', async () => {
    const response = await send('GET', '/api/dns/zones/example.com/export', alice);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="example.com.txt"');
    expect(await response.text()).toContain('example.com.\t1\tIN\tMX\tmx.zoho.com');
  });
});

describe('validation', () => {
  it('takes relative, "@" and full names', () => {
    expect(recordName('example.com', '@')).toBe('example.com');
    expect(recordName('example.com', 'WWW')).toBe('www.example.com');
    expect(recordName('example.com', 'www.example.com.')).toBe('www.example.com');
    expect(recordName('example.com', '*')).toBe('*.example.com');
    expect(recordName('example.com', '_dmarc')).toBe('_dmarc.example.com');
    expect(() => recordName('example.com', 'a.*')).toThrow('not a valid record name');
    expect(() => recordName('example.com', '-bad')).toThrow('not a valid record name');
  });

  it('checks the content of each type', () => {
    const base = { name: '@', ttl: 1, proxied: false, priority: null };
    expect(validateRecord('example.com', { ...base, type: 'AAAA', content: '2001:DB8::1' })).toMatchObject({
      content: '2001:db8::1',
    });
    expect(validateRecord('example.com', { ...base, type: 'AAAA', content: '::ffff:192.0.2.1' })).toBeTruthy();
    expect(() => validateRecord('example.com', { ...base, type: 'AAAA', content: '1::2::3' })).toThrow('IPv6');
    expect(() => validateRecord('example.com', { ...base, type: 'CNAME', content: 'example.com' })).toThrow('itself');
    expect(validateRecord('example.com', { ...base, type: 'MX', content: 'mx.zoho.com.', priority: 0 })).toMatchObject({
      content: 'mx.zoho.com',
      priority: 0,
    });
    expect(() => validateRecord('example.com', { ...base, type: 'SRV', content: '1 2 x.com', priority: 1 })).toThrow(
      '_sip._tcp',
    );
    expect(() => validateRecord('example.com', { ...base, type: 'CAA', content: '0 foo "x"' })).toThrow('CAA');
  });
});

describe('what is locked', () => {
  const record = (id: string, type: string, name: string, extra: Partial<FakeDnsRecord> = {}) => ({
    id,
    type,
    name,
    content: '192.0.2.1',
    ttl: 1,
    ...extra,
  });

  it('follows wildcards to the closest name that exists', () => {
    const records = [
      record('apex', 'MX', 'example.com', { content: 'mx.example.com' }),
      record('wild', 'A', '*.example.com', { proxied: true }),
      record('deep-wild', 'A', '*.eu.example.com', { proxied: true }),
      // eu.example.com has no records, but exists above *.eu.example.com
    ];
    const served = { names: new Set(['shop.eu.example.com']), wildcardRoutes: [] };
    const guard = guardOf('example.com', served, records);
    expect(guard.isProtected(records[1] as never)).toBe(false);
    expect(guard.isProtected(records[2] as never)).toBe(true);
    expect(guard.shadows('shop.eu.example.com', 'TXT')).toContain('*.eu.example.com');
    expect(guard.shadows('other.example.com', 'TXT')).toBeNull();
  });
});
