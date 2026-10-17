import type { Env } from '../env';
import { safeEqual } from './crypto';

/** The admin token guards /setup and the admin API; short tokens never match. */
export async function isAdminToken(env: Pick<Env, 'ADMIN_TOKEN'>, provided: string | undefined): Promise<boolean> {
  const expected = env.ADMIN_TOKEN;
  if (!expected || expected.length < 32 || provided === undefined) return false;
  return safeEqual(provided, expected);
}

/** The token from `Authorization: Bearer <token>`. */
export const bearerToken = (header: string | undefined) => header?.match(/^Bearer\s+(\S+)$/i)?.[1];
