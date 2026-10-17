// DNS of the zones bohr hosts in its own Cloudflare account (bohr.io Cloud). bohr v1 kept its customers' domains
// there; their owners keep managing the records in the panel. Cloudflare holds the records (nothing is mirrored
// here); dns_zones only says whose each zone is. Records bohr needs to serve sites stay read-only.
import {
  type CloudflareClient,
  CloudflareError,
  createDnsRecord,
  type DnsRecord,
  type DnsRecordInput,
  deleteDnsRecord,
  exportDnsRecords,
  findZoneByName,
  getZone,
  listDnsRecords,
  listWorkerRoutes,
  listZones,
  updateDnsRecord,
} from '@bohr/cloudflare';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { dnsZones, hostnames, identities, orgs, users } from '../db/schema';
import { deps } from '../deps';
import type { Env, User } from '../env';
import { inChunks } from '../lib/chunks';
import { cloudEnv } from '../lib/cloud';
import { randomId } from '../lib/crypto';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http';
import { audit } from './audit';
import { activeMembership, userOrgs } from './orgs';
import { upsertGithubUser } from './users';

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

// The records that send a name's traffic somewhere; only these can be proxied (and reach a Worker route)
const ADDRESS_TYPES: ReadonlySet<string> = new Set(['A', 'AAAA', 'CNAME']);
const isRecordType = (type: string): type is RecordType => (RECORD_TYPES as readonly string[]).includes(type);

export type DnsZone = typeof dnsZones.$inferSelect;
type Actor = { actor: string; actorUserId: string };

// Access

export type ZoneAccess = {
  zone: DnsZone;
  canEdit: boolean;
  /** admin: the access comes from the user's admin role on the instance, not from owning the zone. */
  access: 'member' | 'admin';
};

/** What the user's own relation to the zone allows: its owner, or an org admin, edits; an org member reads. */
async function zoneRole(db: Db, zone: DnsZone, userId: string): Promise<'edit' | 'read' | null> {
  if (zone.userId === userId) return 'edit';
  if (zone.orgId === null) return null;
  const member = await activeMembership(db, zone.orgId, userId);
  if (member === undefined) return null;
  return member.role === 'admin' ? 'edit' : 'read';
}

export const normalizeZoneName = (name: string) => name.trim().toLowerCase().replace(/\.$/, '');

/**
 * Zones the user cannot see are "not found". Instance admins open and change every zone of bohr's account, even
 * one no owner was given yet (audited as admin).
 */
export async function zoneAccess(
  db: Db,
  env: Env,
  name: string,
  user: Pick<User, 'id' | 'role'>,
  required?: 'edit',
): Promise<ZoneAccess> {
  const zoneName = normalizeZoneName(name);
  const zone = await db.select().from(dnsZones).where(eq(dnsZones.name, zoneName)).get();
  if (zone === undefined) {
    if (user.role !== 'admin') throw notFound('Domain not found.');
    const found = await findZoneByName(deps.cloudflare(env), zoneName);
    if (found === null) throw notFound('Domain not found.');
    const now = new Date();
    return {
      zone: {
        id: '',
        name: found.name,
        cloudflareZoneId: found.id,
        userId: null,
        orgId: null,
        createdAt: now,
        updatedAt: now,
      },
      canEdit: true,
      access: 'admin',
    };
  }
  const role = await zoneRole(db, zone, user.id);
  let result: ZoneAccess;
  if (role === 'edit') result = { zone, canEdit: true, access: 'member' };
  else if (user.role === 'admin') result = { zone, canEdit: true, access: 'admin' };
  else if (role === 'read') result = { zone, canEdit: false, access: 'member' };
  else throw notFound('Domain not found.');
  if (required === 'edit' && !result.canEdit) {
    throw forbidden("Only the domain's owner or an admin of its organization can change its DNS records.");
  }
  return result;
}

export const zoneActor = (user: Pick<User, 'id'>, access: ZoneAccess['access']): Actor => ({
  actor: access === 'admin' ? `admin:${user.id}` : `user:${user.id}`,
  actorUserId: user.id,
});

export type ZoneSummary = {
  name: string;
  canEdit: boolean;
  org: { slug: string; name: string } | null;
  /** For instance admins: who the zone belongs to (a GitHub login or an org), null when nobody was given it yet. */
  owner?: string | null;
};

/** Instance admins: every zone of bohr's Cloudflare account, with its owner when one was given. */
export async function allZones(db: Db, env: Env): Promise<ZoneSummary[]> {
  const [zones, rows] = await Promise.all([
    listZones(deps.cloudflare(env)),
    db
      .select({ name: dnsZones.name, login: identities.username, org: { slug: orgs.slug, name: orgs.name } })
      .from(dnsZones)
      .leftJoin(identities, and(eq(identities.userId, dnsZones.userId), eq(identities.provider, 'github')))
      .leftJoin(orgs, eq(orgs.id, dnsZones.orgId))
      .all(),
  ]);
  const owners = new Map(rows.map((row) => [row.name, row]));
  return zones
    .map((zone) => {
      const row = owners.get(zone.name);
      const org = row?.org?.slug ? row.org : null;
      return { name: zone.name, canEdit: true, org, owner: org?.slug ?? row?.login ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The user's own zones and those of the organizations they are an active member of. */
export async function userZones(db: Db, userId: string): Promise<ZoneSummary[]> {
  const memberships = await userOrgs(db, userId);
  const own = await db.select().from(dnsZones).where(eq(dnsZones.userId, userId)).all();
  const orgZones = await inChunks(
    memberships.map(({ org }) => org.id),
    (chunk) => db.select().from(dnsZones).where(inArray(dnsZones.orgId, chunk)).all(),
  );
  const summaries = new Map<string, ZoneSummary>();
  for (const zone of [...own, ...orgZones]) {
    const membership = memberships.find(({ org }) => org.id === zone.orgId);
    const canEdit = zone.userId === userId || membership?.role === 'admin';
    const previous = summaries.get(zone.name);
    summaries.set(zone.name, {
      name: zone.name,
      canEdit: canEdit || (previous?.canEdit ?? false),
      org: membership === undefined ? null : { slug: membership.org.slug, name: membership.org.name },
    });
  }
  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Validation

export type RecordInput = {
  type: RecordType;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
};

// A label of a record name or target: letters, digits, hyphens and underscores (_dmarc, DKIM selectors)
const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

export function isIpv6(value: string): boolean {
  let text = value;
  // An IPv4 address in the last 32 bits ("::ffff:192.0.2.1") counts as two groups
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4.test(tail)) return false;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const all = halves.flatMap(groups);
  if (!all.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}

/**
 * The full name of a record of the zone from what people type: "@" (or nothing) is the zone itself, "www" is
 * relative, "www.example.com" and "www.example.com." are already full. A name with a final dot outside the
 * zone is refused; without one it is taken as relative, as Cloudflare's dashboard does.
 */
export function recordName(zone: string, raw: string): string {
  let name = raw.trim().toLowerCase();
  if (name === '' || name === '@') return zone;
  const absolute = name.endsWith('.');
  if (absolute) name = name.slice(0, -1);
  if (name !== zone && !name.endsWith(`.${zone}`)) {
    if (absolute) throw badRequest(`${raw.trim()} is not inside ${zone}.`);
    name = `${name}.${zone}`;
  }
  const relative = name === zone ? [] : name.slice(0, -(zone.length + 1)).split('.');
  const valid = relative.every((label, index) => LABEL.test(label) || (label === '*' && index === 0));
  if (!valid || name.length > 253) throw badRequest(`${raw.trim()} is not a valid record name.`);
  return name;
}

/** A host name a record points at (CNAME, MX, SRV); "@" is the zone itself. */
function targetName(zone: string, raw: string, what: string): string {
  const value = raw.trim().toLowerCase().replace(/\.$/, '');
  if (value === '@') return zone;
  const labels = value.split('.');
  if (value.length > 253 || labels.length < 2 || !labels.every((label) => LABEL.test(label))) {
    throw badRequest(`${what} must be a host name, like mail.example.com.`);
  }
  return value;
}

const port = (value: string | undefined) => {
  const number = Number(value);
  return value !== undefined && /^\d+$/.test(value) && number <= 65535 ? number : null;
};

/** The record Cloudflare is sent, or a 400 that says what is wrong with it. */
export function validateRecord(zone: string, input: RecordInput): DnsRecordInput {
  const { type } = input;
  const name = recordName(zone, input.name);
  if (input.ttl !== 1 && (input.ttl < 60 || input.ttl > 86400)) {
    throw badRequest('TTL must be 1 (automatic) or between 60 and 86400 seconds.');
  }
  const proxiable = ADDRESS_TYPES.has(type);
  if (input.proxied && !proxiable) throw badRequest('Only A, AAAA and CNAME records can be proxied.');
  const hasPriority = type === 'MX' || type === 'SRV';
  if (hasPriority && input.priority === null) throw badRequest(`${type} records need a priority (0 to 65535).`);
  if (!hasPriority && input.priority !== null) throw badRequest('Only MX and SRV records have a priority.');
  // Cloudflare answers proxied records itself: their TTL is always automatic
  const base = { type, name, ttl: input.proxied ? 1 : input.ttl, ...(proxiable ? { proxied: input.proxied } : {}) };
  const content = input.content.trim();

  switch (type) {
    case 'A':
      if (!IPV4.test(content)) throw badRequest('An A record points to an IPv4 address, like 203.0.113.10.');
      return { ...base, content };
    case 'AAAA':
      if (!isIpv6(content)) throw badRequest('An AAAA record points to an IPv6 address, like 2001:db8::1.');
      return { ...base, content: content.toLowerCase() };
    case 'CNAME': {
      const target = targetName(zone, content, 'The target of a CNAME record');
      if (target === name) throw badRequest('A CNAME record cannot point to itself.');
      return { ...base, content: target };
    }
    case 'MX':
      return { ...base, content: targetName(zone, content, 'The mail server'), priority: input.priority ?? 0 };
    case 'TXT':
      if (content === '' || content.length > 2048) throw badRequest('A TXT record has 1 to 2048 characters.');
      if (/[\r\n]/.test(content)) throw badRequest('A TXT record is a single line.');
      return { ...base, content };
    case 'SRV': {
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls)\./.test(name)) {
        throw badRequest('The name of an SRV record starts with the service and the protocol, like _sip._tcp.');
      }
      const [weightText, portText, target, ...rest] = content.split(/\s+/);
      const weight = port(weightText);
      const number = port(portText);
      if (weight === null || number === null || target === undefined || rest.length > 0) {
        throw badRequest('An SRV record is "weight port target", like "5 5060 sip.example.com".');
      }
      const host = target === '.' ? '.' : targetName(zone, target, 'The target of an SRV record');
      return { ...base, data: { priority: input.priority ?? 0, weight, port: number, target: host } };
    }
    case 'CAA': {
      const match = /^(\d{1,3})\s+(issue|issuewild|iodef)\s+"?([^"]+)"?$/i.exec(content);
      const flags = Number(match?.[1]);
      if (match === null || flags > 255) {
        throw badRequest('A CAA record is "flags tag value", like 0 issue "letsencrypt.org".');
      }
      return { ...base, data: { flags, tag: match[2]?.toLowerCase(), value: match[3]?.trim() } };
    }
  }
}

// Protection: records bohr needs to serve sites are read-only

/** Hostnames of the zone bohr serves (hostnames rows, routes to its Workers), and its wildcard routes. */
type Served = { names: Set<string>; wildcardRoutes: string[] };

/** "example.com/*", "*.example.com/*" or "https://example.com/*" → "example.com", "*.example.com"… */
const routeHost = (pattern: string) => (pattern.replace(/^https?:\/\//, '').split('/')[0] ?? '').toLowerCase();

/** Cloudflare's route patterns: "*" may only lead the host ("*.example.com", "*example.com"). */
const routeCovers = (host: string, name: string) =>
  host.startsWith('*') ? name.endsWith(host.slice(1)) : host === name;

async function servedHosts(db: Db, cf: CloudflareClient, zone: DnsZone): Promise<Served> {
  const inZone = (name: string) => name === zone.name || name.endsWith(`.${zone.name}`);
  const rows = await db
    .select({ hostname: hostnames.hostname })
    .from(hostnames)
    .where(
      or(
        eq(hostnames.zoneId, zone.cloudflareZoneId),
        eq(hostnames.hostname, zone.name),
        like(hostnames.hostname, `%.${zone.name}`),
      ),
    )
    .all();
  const names = new Set(rows.map((row) => row.hostname).filter(inZone));
  // Every Worker route on the zone serves a site: the dispatcher (v2), the v1 edge, or the Worker of a project
  // that moved to its owner's account while its zone stayed here (a route without a script turns Workers off)
  const hosts = (await listWorkerRoutes(cf, zone.cloudflareZoneId))
    .filter((route) => route.script !== undefined && route.script !== '')
    .map((route) => routeHost(route.pattern));
  for (const host of hosts) if (!host.startsWith('*') && inZone(host)) names.add(host);
  return { names, wildcardRoutes: hosts.filter((host) => host.startsWith('*')) };
}

// What v1 pointed proxied names at when only a Worker route answers them (the address itself is never reached)
const isPlaceholder = (record: Pick<DnsRecord, 'type' | 'content'>) =>
  (record.type === 'A' && (record.content === '255.255.255.255' || record.content.startsWith('192.0.2.'))) ||
  (record.type === 'AAAA' && record.content === '100::');

export type Guard = {
  isProtected(record: DnsRecord): boolean;
  /** Why a record of this type at this name would take a name bohr serves away from it, or null. */
  shadows(name: string, type: string, ignoreId?: string): string | null;
};

/**
 * Locked: the A, AAAA and CNAME records of every name bohr serves (and the wildcard record a served name resolves
 * through), proxied placeholder records a route of bohr answers, and the apex's NS records.
 */
export function guardOf(zone: string, served: Served, records: DnsRecord[]): Guard {
  const parentOf = (name: string) => name.slice(name.indexOf('.') + 1);
  const own = new Set(records.map((record) => record.name));
  // Names that exist in DNS terms: with records, or above a name that has some (empty non-terminals)
  const existing = new Set<string>();
  for (const record of records) {
    for (let name = record.name; ; name = parentOf(name)) {
      existing.add(name);
      if (name === zone || !name.endsWith(`.${zone}`)) break;
    }
  }
  // RFC 4592: a name without records of its own is answered by the wildcard of its closest existing ancestor
  const wildcardFor = (name: string): string | null => {
    if (own.has(name) || !name.endsWith(`.${zone}`)) return null;
    for (let parent = parentOf(name); ; parent = parentOf(parent)) {
      if (existing.has(parent)) return own.has(`*.${parent}`) ? `*.${parent}` : null;
      if (parent === zone || !parent.includes('.')) return null;
    }
  };
  const servingWildcards = new Set([...served.names].map(wildcardFor).filter((name): name is string => name !== null));
  const isProtected = (record: DnsRecord) => {
    if (record.type === 'NS' && record.name === zone) return true;
    if (!ADDRESS_TYPES.has(record.type)) return false;
    if (served.names.has(record.name) || servingWildcards.has(record.name)) return true;
    return (
      record.proxied === true &&
      isPlaceholder(record) &&
      served.wildcardRoutes.some((host) => routeCovers(host, record.name))
    );
  };
  const lockedNames = new Set([
    ...served.names,
    ...records.filter((record) => ADDRESS_TYPES.has(record.type) && isProtected(record)).map((record) => record.name),
  ]);
  return {
    isProtected,
    shadows(name, type, ignoreId) {
      if (ADDRESS_TYPES.has(type) && lockedNames.has(name)) {
        return `bohr serves ${name}: its A, AAAA and CNAME records are managed by bohr.`;
      }
      const others = records.some((record) => record.name === name && record.id !== ignoreId);
      const wildcard = served.names.has(name) && !others ? wildcardFor(name) : null;
      if (wildcard !== null) {
        return `bohr serves ${name} through the ${wildcard} record; a record of its own would stop that.`;
      }
      return null;
    },
  };
}

// Records

export type RecordView = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  /** bohr needs it to serve a site (or it is the zone's nameservers): read-only. */
  managedByBohr: boolean;
  /** A type the panel edits (RECORD_TYPES) and not managed by bohr. */
  editable: boolean;
};

/** SRV and CAA as people write them ("5 5060 sip.example.com", `0 issue "letsencrypt.org"`), not tab-separated. */
function displayContent(record: DnsRecord): string {
  const data = record.data ?? {};
  if (record.type === 'SRV' && data.target !== undefined) return `${data.weight} ${data.port} ${data.target}`;
  if (record.type === 'CAA' && data.tag !== undefined) return `${data.flags} ${data.tag} "${data.value}"`;
  return record.content.replaceAll('\t', ' ');
}

function recordPriority(record: DnsRecord): number | null {
  if (typeof record.priority === 'number') return record.priority;
  return typeof record.data?.priority === 'number' ? record.data.priority : null;
}

function recordView(record: DnsRecord, guard: Guard): RecordView {
  const managedByBohr = guard.isProtected(record);
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: displayContent(record),
    ttl: record.ttl,
    proxied: record.proxied ?? false,
    priority: recordPriority(record),
    managedByBohr,
    editable: !managedByBohr && isRecordType(record.type),
  };
}

/** What the audit log keeps of a record: enough to put it back by hand. */
const snapshot = (record: DnsRecord) => ({
  id: record.id,
  type: record.type,
  name: record.name,
  content: displayContent(record),
  ttl: record.ttl,
  proxied: record.proxied ?? false,
  priority: recordPriority(record),
});

/** Cloudflare's refusals of a record (a duplicate, an invalid value) become a 400 that quotes them. */
async function cloudflareWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CloudflareError) || error.status < 400 || error.status >= 500) throw error;
    if (error.status === 401 || error.status === 403) throw error;
    const reasons = error.errors
      .flatMap((entry) => (entry.error_chain?.length ? entry.error_chain : [entry]))
      .map((entry) => entry.message.replace(/\.$/, ''));
    throw new HttpError(400, `Cloudflare refused the record: ${reasons.join('; ') || 'no details'}.`, {
      cloudflare: error.errors.map(({ code, message }) => ({ code, message })),
    });
  }
}

/** The zone's records and what is locked, read from Cloudflare. */
async function readZone(db: Db, env: Env, zone: DnsZone) {
  const cf = deps.cloudflare(env);
  try {
    const [records, served] = await Promise.all([listDnsRecords(cf, zone.cloudflareZoneId), servedHosts(db, cf, zone)]);
    return { cf, records, guard: guardOf(zone.name, served, records) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('[dns] reading the zone failed:', error);
    throw new HttpError(502, `Could not read ${zone.name} from Cloudflare. Try again in a moment.`);
  }
}

const byName = (zone: string) => (a: RecordView, b: RecordView) =>
  Number(b.name === zone) - Number(a.name === zone) ||
  a.name.localeCompare(b.name) ||
  a.type.localeCompare(b.type) ||
  (a.priority ?? 0) - (b.priority ?? 0) ||
  a.content.localeCompare(b.content);

export async function zoneRecords(db: Db, env: Env, zone: DnsZone): Promise<RecordView[]> {
  const { records, guard } = await readZone(db, env, zone);
  return records.map((record) => recordView(record, guard)).sort(byName(zone.name));
}

const zoneTarget = (zone: DnsZone) => `dns:${zone.name}`;

const lockedMessage = (record: DnsRecord) =>
  record.type === 'NS'
    ? `The NS records of ${record.name} are Cloudflare's nameservers for the domain; they cannot be changed.`
    : `bohr uses this ${record.type} record of ${record.name} to serve a site; it cannot be changed here.`;

export async function createRecord(db: Db, env: Env, zone: DnsZone, input: RecordInput, actor: Actor) {
  const record = validateRecord(zone.name, input);
  const { cf, guard } = await readZone(db, env, zone);
  const shadow = guard.shadows(record.name, record.type);
  if (shadow !== null) throw conflict(shadow);
  const created = await cloudflareWrite(() => createDnsRecord(cf, zone.cloudflareZoneId, record));
  await audit(db, {
    ...actor,
    action: 'dns.record.create',
    target: zoneTarget(zone),
    metadata: { after: snapshot(created) },
  });
}

export async function updateRecord(
  db: Db,
  env: Env,
  zone: DnsZone,
  recordId: string,
  patch: Partial<RecordInput>,
  actor: Actor,
) {
  const { cf, records, guard } = await readZone(db, env, zone);
  const existing = records.find((record) => record.id === recordId);
  if (existing === undefined) throw notFound('Record not found.');
  if (guard.isProtected(existing)) throw conflict(lockedMessage(existing));
  if (!isRecordType(existing.type)) throw badRequest(`${existing.type} records cannot be edited here.`);
  const type = patch.type ?? existing.type;
  const hasPriority = type === 'MX' || type === 'SRV';
  const record = validateRecord(zone.name, {
    type,
    name: patch.name ?? existing.name,
    content: patch.content ?? displayContent(existing),
    ttl: patch.ttl ?? existing.ttl,
    proxied: ADDRESS_TYPES.has(type) ? (patch.proxied ?? existing.proxied ?? false) : (patch.proxied ?? false),
    priority: patch.priority !== undefined ? patch.priority : hasPriority ? recordPriority(existing) : null,
  });
  const shadow = guard.shadows(record.name, record.type, existing.id);
  if (shadow !== null) throw conflict(shadow);
  const updated = await cloudflareWrite(() => updateDnsRecord(cf, zone.cloudflareZoneId, existing.id, record));
  await audit(db, {
    ...actor,
    action: 'dns.record.update',
    target: zoneTarget(zone),
    metadata: { before: snapshot(existing), after: snapshot(updated) },
  });
}

export async function deleteRecord(db: Db, env: Env, zone: DnsZone, recordId: string, actor: Actor) {
  const { cf, records, guard } = await readZone(db, env, zone);
  const existing = records.find((record) => record.id === recordId);
  if (existing === undefined) throw notFound('Record not found.');
  if (guard.isProtected(existing)) throw conflict(lockedMessage(existing));
  await cloudflareWrite(() => deleteDnsRecord(cf, zone.cloudflareZoneId, existing.id));
  await audit(db, {
    ...actor,
    action: 'dns.record.delete',
    target: zoneTarget(zone),
    metadata: { before: snapshot(existing) },
  });
}

/** The zone as a BIND file, to import in another DNS host (moving the domain to the owner's Cloudflare account). */
export async function exportZone(env: Env, zone: DnsZone): Promise<string> {
  return exportDnsRecords(deps.cloudflare(env), zone.cloudflareZoneId);
}

// Import from bohr v1 (admin API)

const githubUser = z.object({
  githubId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  login: z.string().min(1).max(39),
  name: z.string().max(255).nullish(),
  email: z.string().max(320).nullish(),
});

export const zoneImportSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().min(3).max(253).transform(normalizeZoneName),
        cloudflareZoneId: z.string().min(1).max(64),
        // A person: a bohr user by id, or a GitHub account (made a bohr user, like the project import does);
        // or an organization already in bohr, by its GitHub id or login
        owner: z.union([
          z.object({ userId: z.string().min(1).max(100) }),
          z.object({ github: githubUser }),
          z.object({
            org: z.object({ login: z.string().min(1).max(39), githubId: z.number().int().positive().optional() }),
          }),
        ]),
      }),
    )
    .min(1)
    .max(200),
});

export type ZoneImportResult = {
  name: string;
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
  owner?: { userId: string } | { orgId: string };
};

type ImportedZone = z.infer<typeof zoneImportSchema>['zones'][number];

async function importOwner(db: Db, owner: ImportedZone['owner']) {
  if ('userId' in owner) {
    const user = await db.select({ id: users.id }).from(users).where(eq(users.id, owner.userId)).get();
    return user === undefined ? null : { userId: user.id, orgId: null };
  }
  if ('github' in owner) return { userId: await upsertGithubUser(db, owner.github), orgId: null };
  const login = owner.org.login.toLowerCase();
  const byLogin = or(eq(orgs.slug, login), sql`lower(${orgs.githubLogin}) = ${login}`);
  const org = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(owner.org.githubId === undefined ? byLogin : or(eq(orgs.githubAccountId, owner.org.githubId), byLogin))
    .get();
  return org === undefined ? null : { userId: null, orgId: org.id };
}

/**
 * Records whose each zone is: the zone must be in bohr's Cloudflare account under that name. Zones that cannot be
 * imported (bohr's own, missing in Cloudflare, an owner not in bohr) are skipped with the reason.
 */
export async function importZones(db: Db, env: Env, input: z.infer<typeof zoneImportSchema>) {
  const cloud = cloudEnv(env);
  const cf = deps.cloudflare(env);
  const results: ZoneImportResult[] = [];
  for (const entry of input.zones) {
    const skip = (reason: string) => results.push({ name: entry.name, status: 'skipped', reason });
    if (entry.name === cloud.BOHR_DOMAIN.toLowerCase() || entry.cloudflareZoneId === cloud.BOHR_ZONE_ID) {
      skip("bohr's own zone");
      continue;
    }
    const found = await getZone(cf, entry.cloudflareZoneId).catch((error: unknown) => {
      // An id Cloudflare does not know answers 404, or 400 when it is not even an id
      if (error instanceof CloudflareError && (error.status === 400 || error.status === 404)) return null;
      throw error;
    });
    if (found === null) {
      skip("not a zone of bohr's Cloudflare account");
      continue;
    }
    if (found.name.toLowerCase() !== entry.name) {
      skip(`the zone ${entry.cloudflareZoneId} is ${found.name} in Cloudflare`);
      continue;
    }
    const owner = await importOwner(db, entry.owner);
    if (owner === null) {
      skip('the owner is not in bohr (import the organization first)');
      continue;
    }
    const existing = await db.select().from(dnsZones).where(eq(dnsZones.name, entry.name)).get();
    await db
      .insert(dnsZones)
      .values({ id: randomId('z_', 16), name: entry.name, cloudflareZoneId: entry.cloudflareZoneId, ...owner })
      .onConflictDoUpdate({
        target: dnsZones.name,
        set: { cloudflareZoneId: entry.cloudflareZoneId, ...owner, updatedAt: new Date() },
      })
      .run();
    const ownerRef = owner.orgId !== null ? { orgId: owner.orgId } : { userId: owner.userId ?? '' };
    await audit(db, {
      actor: 'admin',
      action: 'dns.zone.import',
      target: `dns:${entry.name}`,
      metadata: { cloudflareZoneId: entry.cloudflareZoneId, ...ownerRef, previous: existing ?? null },
    });
    results.push({ name: entry.name, status: existing === undefined ? 'created' : 'updated', owner: ownerRef });
  }
  return results;
}
