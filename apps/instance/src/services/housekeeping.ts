import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { instanceSettings } from '../db/schema';

const ONE_TIME_PREFIXES = [
  'install_state:',
  'install_verify:',
  'telegram_link:',
  'telegram_login:',
  // New projects from a template: the request waiting for GitHub, then the admin password shown once
  'template_request:',
  'template_password:',
];

/** Deletes one-time codes (install, sign-in, linking, templates) once they expired. */
export async function purgeExpiredCodes(db: Db, now = Date.now()): Promise<void> {
  for (const prefix of ONE_TIME_PREFIXES) {
    await db
      .delete(instanceSettings)
      .where(
        sql`${instanceSettings.key} LIKE ${`${prefix}%`} AND CAST(json_extract(${instanceSettings.value}, '$.expiresAt') AS INTEGER) < ${now}`,
      )
      .run();
  }
}
