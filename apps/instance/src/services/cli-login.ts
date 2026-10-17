// `bohr login`, a device authorization flow (RFC 8628's shape): the CLI asks for a device code, prints the
// panel's /cli?code=<user code> and polls; the signed-in person compares the code with their terminal and
// approves it; the next poll gets a new API token named after the computer, once.
import { and, count, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { cliLogins, users } from '../db/schema';
import type { User } from '../env';
import { randomToken, sha256Hex } from '../lib/crypto';
import { conflict, HttpError, notFound } from '../lib/http';
import { createApiToken } from './api-tokens';
import { audit } from './audit';

export const LOGIN_TTL_MS = 10 * 60_000;
/** Seconds the CLI waits between polls. */
export const POLL_INTERVAL_S = 5;
const WINDOW_MS = 10 * 60_000;
const PER_IP = 20;
/** Consonants only: no words, nothing to confuse (0/O, 1/I). 20^8 codes. */
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export const clientNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u, 'No control characters.');

/** "BCDF-GHJK": 8 uniform letters of ALPHABET. */
export function generateUserCode() {
  let code = '';
  while (code.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 240 && code.length < 8) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What people type: any case, with or without the dash or spaces. Null when it cannot be a code. */
export function normalizeUserCode(value: string) {
  const letters = value.toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${ALPHABET}]{8}$`).test(letters) ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

/** Starts a sign-in. 429 past 20 in 10 minutes from one IP. */
export async function startCliLogin(
  db: Db,
  input: { clientName: string; ip: string | null; appUrl: string },
  now = new Date(),
) {
  const ipHash = input.ip ? await sha256Hex(`ip:${input.ip}`) : null;
  if (ipHash !== null) {
    const [recent] = await db
      .select({ n: count() })
      .from(cliLogins)
      .where(and(eq(cliLogins.ipHash, ipHash), gt(cliLogins.createdAt, new Date(now.getTime() - WINDOW_MS))))
      .all();
    if ((recent?.n ?? 0) >= PER_IP) throw new HttpError(429, 'Too many sign-ins started. Wait a few minutes.');
  }
  const deviceCode = randomToken(32);
  const userCode = generateUserCode();
  await db
    .insert(cliLogins)
    .values({
      id: `cl_${randomToken(12)}`,
      deviceCodeHash: await sha256Hex(deviceCode),
      userCode,
      clientName: input.clientName,
      ipHash,
      expiresAt: new Date(now.getTime() + LOGIN_TTL_MS),
      createdAt: now,
    })
    .run();
  return {
    deviceCode,
    userCode,
    verificationUrl: `${input.appUrl}/cli?code=${userCode}`,
    expiresIn: LOGIN_TTL_MS / 1000,
    interval: POLL_INTERVAL_S,
  };
}

/** The CLI's poll: pending, denied, expired, or approved with the new token (handed out once). */
export async function pollCliLogin(db: Db, deviceCode: string, now = new Date()) {
  const row = await db
    .select()
    .from(cliLogins)
    .where(eq(cliLogins.deviceCodeHash, await sha256Hex(deviceCode)))
    .get();
  if (row === undefined) throw notFound('Unknown sign-in. Run bohr login again.');
  if (row.status === 'denied') return { status: 'denied' as const };
  if (row.status === 'done' || row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' as const };
  if (row.status === 'pending' || row.userId === null) return { status: 'pending' as const };

  // Only the poll that moves it from approved to done creates the token
  const claimed = await db
    .update(cliLogins)
    .set({ status: 'done' })
    .where(and(eq(cliLogins.id, row.id), eq(cliLogins.status, 'approved')))
    .returning({ id: cliLogins.id })
    .all();
  if (claimed.length === 0) return { status: 'expired' as const };
  const { token, row: tokenRow } = await createApiToken(db, {
    userId: row.userId,
    name: row.clientName,
    projectIds: null,
    expiresAt: null,
    source: 'cli',
  });
  const user = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, row.userId))
    .get();
  if (user === undefined) throw notFound('The account that approved this sign-in no longer exists.');
  return { status: 'approved' as const, token, tokenId: tokenRow.id, user };
}

export function cliLoginView(row: typeof cliLogins.$inferSelect, now = new Date()) {
  const expired = row.status === 'pending' && row.expiresAt.getTime() <= now.getTime();
  return {
    userCode: row.userCode,
    clientName: row.clientName,
    // done: approved, and the CLI got its token
    status: expired ? ('expired' as const) : row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export async function findCliLogin(db: Db, userCode: string) {
  const code = normalizeUserCode(userCode);
  const row = code === null ? undefined : await db.select().from(cliLogins).where(eq(cliLogins.userCode, code)).get();
  if (row === undefined) throw notFound('No sign-in with this code. Check the code in your terminal.');
  return row;
}

/** The signed-in person approves (or denies) the sign-in shown in their terminal. */
export async function decideCliLogin(db: Db, user: User, userCode: string, approve: boolean, now = new Date()) {
  const row = await findCliLogin(db, userCode);
  if (row.status !== 'pending') throw conflict('This sign-in was already answered.');
  if (row.expiresAt.getTime() <= now.getTime()) throw conflict('This code expired. Run bohr login again.');
  const decided = await db
    .update(cliLogins)
    .set({ status: approve ? 'approved' : 'denied', userId: user.id })
    .where(and(eq(cliLogins.id, row.id), eq(cliLogins.status, 'pending')))
    .returning()
    .get();
  if (decided === undefined) throw conflict('This sign-in was already answered.');
  await audit(db, {
    actor: `user:${user.id}`,
    actorUserId: user.id,
    action: approve ? 'cli_login.approve' : 'cli_login.deny',
    target: row.id,
    metadata: { clientName: row.clientName },
  });
  return cliLoginView(decided, now);
}

/** Expired sign-ins (run from the scheduled handler); kept an hour for the per-IP limit. */
export async function purgeCliLogins(db: Db, now = Date.now()) {
  await db
    .delete(cliLogins)
    .where(lt(cliLogins.expiresAt, new Date(now - 60 * 60_000)))
    .run();
}
