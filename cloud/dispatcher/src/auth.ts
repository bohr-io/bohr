import { TtlCache } from './cache';
import type { BasicAuthUser } from './routes';

export interface PasswordHash {
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  iterations: number;
}

export interface BasicCredentials {
  username: string;
  password: string;
}

export const DEFAULT_ITERATIONS = 20_000;
/** workerd refuses PBKDF2 with more iterations than this. */
export const MAX_ITERATIONS = 100_000;
/** How long a verified Authorization value is trusted by this isolate. */
export const VERIFIED_TTL_MS = 5 * 60_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;

const encoder = new TextEncoder();
// Strict UTF-8; a leading BOM is kept so credentials compare byte for byte.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** PBKDF2-SHA256 with a random 16-byte salt and a 32-byte output, all base64. */
export async function hashPassword(
  password: string,
  { iterations = DEFAULT_ITERATIONS }: { iterations?: number } = {},
): Promise<PasswordHash> {
  if (!isValidIterations(iterations)) {
    throw new RangeError(`iterations must be an integer from 1 to ${MAX_ITERATIONS}`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, iterations);
  return { salt: encodeBase64(salt), hash: encodeBase64(hash), iterations };
}

/** Checks a password against a stored hash; malformed records never match. */
export async function verifyPassword(password: string, record: PasswordHash): Promise<boolean> {
  const salt = decodeBase64(record.salt);
  const expected = decodeBase64(record.hash);
  if (salt === null || salt.byteLength === 0) return false;
  if (expected === null || expected.byteLength !== HASH_BYTES) return false;
  if (!isValidIterations(record.iterations)) return false;
  const actual = await pbkdf2(password, salt, record.iterations);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

const BASIC_HEADER = /^basic +([A-Za-z0-9+/]+={0,2})$/i;

/**
 * Parses `Authorization: Basic <base64(user:password)>` (RFC 7617). The
 * credentials must be valid UTF-8 with a colon and no control characters;
 * anything else returns null.
 */
export function parseBasicAuth(header: string): BasicCredentials | null {
  const token = BASIC_HEADER.exec(header.trim())?.[1];
  if (token === undefined) return null;
  const bytes = decodeBase64(token);
  if (bytes === null) return null;
  let decoded: string;
  try {
    decoded = utf8.decode(bytes);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1 || hasControlCharacter(decoded)) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

const verified = new TtlCache<{ username: string; hash: string }>();

/**
 * Whether the Authorization header holds valid credentials for one of the
 * users. Verified values are cached per isolate, keyed by
 * sha256(hostname + header), so PBKDF2 runs once per visitor and isolate.
 */
export async function isAuthorized(
  hostname: string,
  header: string | null,
  users: readonly BasicAuthUser[],
): Promise<boolean> {
  const [first] = users;
  if (header === null || first === undefined) return false;
  const credentials = parseBasicAuth(header);
  if (credentials === null) return false;

  const key = await sha256Hex(hostname + header);
  const cached = verified.get(key);
  // A cached entry only counts while its user still has the same hash, so a
  // password change applies as soon as the new route record is read.
  if (cached && users.some((user) => user.username === cached.username && user.hash === cached.hash)) {
    return true;
  }

  const user = users.find((candidate) => candidate.username === credentials.username);
  // Unknown usernames still pay for one PBKDF2 run, so timing does not reveal them.
  const valid = await verifyPassword(credentials.password, user ?? first);
  if (!valid || user === undefined) return false;
  verified.set(key, { username: user.username, hash: user.hash }, VERIFIED_TTL_MS);
  return true;
}

/** Value for the WWW-Authenticate header of a 401. */
export function basicChallenge(realm: string): string {
  return `Basic realm="${realm.replace(/["\\]/g, '\\$&')}", charset="UTF-8"`;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isValidIterations(iterations: number): boolean {
  return Number.isInteger(iterations) && iterations >= 1 && iterations <= MAX_ITERATIONS;
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
