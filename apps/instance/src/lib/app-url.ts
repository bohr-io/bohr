import type { Context } from 'hono';
import { createDb, type Db } from '../db/client';
import type { AppEnv, Env } from '../env';
import { readSetting, writeSetting } from '../services/settings';

const SETTING = 'app_url';
const trim = (url: string) => url.replace(/\/+$/, '');

/**
 * The instance's public URL: APP_URL when set, else the URL recorded at setup. A self-hosted
 * instance deployed with the Deploy to Cloudflare button only learns its workers.dev URL when
 * the first request arrives.
 */
export async function instanceUrl(db: Db, env: Env): Promise<string | null> {
  if (env.APP_URL) return trim(env.APP_URL);
  return readSetting<string>(db, SETTING);
}

/** instanceUrl, or the origin of the current request before setup recorded one. */
export async function appUrl(c: Context<AppEnv>): Promise<string> {
  return (await instanceUrl(createDb(c.env.DB), c.env)) ?? new URL(c.req.url).origin;
}

/** Called by the admin at setup: the URL they used becomes the instance URL unless APP_URL is set. */
export async function recordAppUrl(c: Context<AppEnv>): Promise<string> {
  const db = createDb(c.env.DB);
  const known = await instanceUrl(db, c.env);
  if (known !== null) return known;
  const origin = new URL(c.req.url).origin;
  await writeSetting(db, SETTING, origin);
  return origin;
}
