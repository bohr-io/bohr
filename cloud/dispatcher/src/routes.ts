import { TtlCache } from './cache';

// Route record format: docs/managed-hosting.md, "Route record (KV namespace ROUTES)".

export interface BasicAuthUser {
  username: string;
  /** base64, 16 bytes */
  salt: string;
  /** base64 PBKDF2-SHA256 output, 32 bytes */
  hash: string;
  iterations: number;
}

export type RouteAuth = { type: 'none' } | { type: 'basic'; users: BasicAuthUser[]; bypassPaths?: string[] };

export interface RouteRecord {
  v: 1;
  projectId: string;
  script: string;
  auth?: RouteAuth;
  headers?: Record<string, string>;
  suspended?: boolean;
  /** The project moved to its owner's Cloudflare account: requests are redirected here (an https origin). */
  movedTo?: string;
  /**
   * The project moved to its owner's account but its hostname's zone stayed in bohr's: requests are passed on,
   * as they are (method, headers, body), to its Worker there (an https origin on workers.dev).
   */
  proxyTo?: string;
}

/** How long a record found in KV is reused by this isolate. */
export const ROUTE_TTL_MS = 30_000;
/** How long a KV miss is remembered, so new hostnames go live quickly. */
export const MISS_TTL_MS = 5_000;

const routeCache = new TtlCache<RouteRecord | null>();

/** Lowercases the hostname and drops the trailing dot of a fully qualified name. */
export function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Wildcard keys to try after the exact hostname, most specific first. There is
 * no public suffix list, so every parent domain with at least two labels is a
 * candidate: a.b.example.co.uk -> *.b.example.co.uk, *.example.co.uk, *.co.uk
 * (never *.uk).
 */
export function wildcardCandidates(hostname: string): string[] {
  const labels = hostname.split('.');
  const candidates: string[] = [];
  for (let i = 1; i < labels.length - 1; i++) {
    candidates.push(`*.${labels.slice(i).join('.')}`);
  }
  return candidates;
}

/** Finds the route record for a hostname: the exact key first, then wildcards. */
export async function findRoute(kv: KVNamespace, hostname: string): Promise<RouteRecord | null> {
  const exact = await readRoute(kv, hostname);
  if (exact) return exact;
  // Wildcard keys are read in parallel; the most specific hit wins, and a
  // broken record only matters when nothing more specific matched.
  const results = await Promise.allSettled(wildcardCandidates(hostname).map((key) => readRoute(kv, key)));
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    if (result.value) return result.value;
  }
  return null;
}

async function readRoute(kv: KVNamespace, key: string): Promise<RouteRecord | null> {
  const cached = routeCache.get(key);
  if (cached !== undefined) return cached;
  const text = await kv.get(key);
  const record = text === null ? null : decodeRouteRecord(key, text);
  routeCache.set(key, record, record ? ROUTE_TTL_MS : MISS_TTL_MS);
  return record;
}

function decodeRouteRecord(key: string, text: string): RouteRecord {
  try {
    return parseRouteRecord(JSON.parse(text));
  } catch (err) {
    throw new Error(`Invalid route record "${key}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Validates a decoded route record. Anything outside the v1 format throws, so
 * an unknown auth type can never serve a site without its protection.
 */
export function parseRouteRecord(value: unknown): RouteRecord {
  if (!isObject(value) || value.v !== 1) throw new TypeError('unsupported version');
  const { projectId, script, auth, headers, suspended, movedTo, proxyTo } = value;
  if (typeof projectId !== 'string') throw new TypeError('projectId must be a string');
  if (typeof script !== 'string' || script === '') throw new TypeError('script must be a non-empty string');
  if (suspended != null && typeof suspended !== 'boolean') throw new TypeError('suspended must be a boolean');
  const record: RouteRecord = { v: 1, projectId, script, suspended: suspended === true };
  if (movedTo != null) record.movedTo = parseMovedTo(movedTo);
  if (proxyTo != null) record.proxyTo = parseProxyTo(proxyTo);
  if (auth != null) record.auth = parseAuth(auth);
  if (headers != null) record.headers = parseHeaders(headers);
  return record;
}

function parseMovedTo(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('movedTo must be a string');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new TypeError('movedTo must be an https origin');
  }
  return url.origin;
}

// Only an owner's Worker: the dispatcher never becomes an open proxy
function parseProxyTo(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('proxyTo must be a string');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.workers.dev') ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('proxyTo must be an https workers.dev origin');
  }
  return url.origin;
}

function parseAuth(value: unknown): RouteAuth {
  if (!isObject(value)) throw new TypeError('auth must be an object');
  if (value.type === 'none') return { type: 'none' };
  if (value.type !== 'basic') throw new TypeError(`unsupported auth type ${JSON.stringify(value.type)}`);
  const { users, bypassPaths } = value;
  if (!Array.isArray(users) || !users.every(isBasicAuthUser)) throw new TypeError('invalid auth.users');
  if (bypassPaths == null) return { type: 'basic', users };
  if (!Array.isArray(bypassPaths) || !bypassPaths.every((path) => typeof path === 'string')) {
    throw new TypeError('auth.bypassPaths must be an array of strings');
  }
  return { type: 'basic', users, bypassPaths };
}

function isBasicAuthUser(value: unknown): value is BasicAuthUser {
  return (
    isObject(value) &&
    typeof value.username === 'string' &&
    typeof value.salt === 'string' &&
    typeof value.hash === 'string' &&
    Number.isInteger(value.iterations)
  );
}

// RFC 9110 token characters.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function parseHeaders(value: unknown): Record<string, string> {
  if (!isObject(value)) throw new TypeError('headers must be an object');
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    // Validated here so that setting them on a response cannot throw later.
    if (!HEADER_NAME.test(name)) throw new TypeError(`invalid header name ${JSON.stringify(name)}`);
    if (typeof headerValue !== 'string' || /[\r\n\0]/.test(headerValue)) {
      throw new TypeError(`invalid value for header ${name}`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
