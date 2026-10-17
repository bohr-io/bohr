import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { randomToken, sha256Hex } from './crypto';

// __Host- cookies cannot be set by other subdomains (customer sites on the same registrable domain)
export const SESSION_COOKIE = '__Host-bohr_session';
const SESSION_DAYS = 30;

export async function startSession(c: Context<AppEnv>, db: Db, userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId, expiresAt })
    .run();
  // HttpOnly + SameSite=Lax: scripts cannot read it and cross-site POSTs do not carry it
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', expires: expiresAt });
}

export async function sessionUser(c: Context<AppEnv>, db: Db) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token === undefined || token.length > 100) return null;
  const row = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, await sha256Hex(token)), gt(sessions.expiresAt, new Date())))
    .get();
  return row?.user ?? null;
}

export async function endSession(c: Context<AppEnv>, db: Db) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token !== undefined) {
    await db
      .delete(sessions)
      .where(eq(sessions.idHash, await sha256Hex(token)))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

// Only same-origin paths made of URL characters (no spaces, tabs or backslashes); anything else is "/"
const LOCAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;
export function safeRedirect(value: string | undefined) {
  return value !== undefined && LOCAL_PATH.test(value) ? value : '/';
}
