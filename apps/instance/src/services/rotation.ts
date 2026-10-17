import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cfConnections, envVars, instanceSettings, runtimeSecrets, runtimes } from '../db/schema';
import type { Env } from '../env';
import { vault } from '../lib/vault';
import { projectSecretContext } from '../routes/runtime';
import { cfTokenContext } from './provision';
import { secretContext } from './secrets';
import { buildVariableContext } from './variables';

/**
 * Moves every sealed value to the vault's current master key (after ENCRYPTION_KEY gained a new key
 * in front). Run it, then remove the old key from ENCRYPTION_KEY.
 */
export async function rewrapAll(db: Db, env: Env): Promise<{ total: number; rewrapped: number }> {
  const box = vault(env);
  let total = 0;
  let rewrapped = 0;
  const rewrap = async (sealed: string, context: string, save: (value: string) => Promise<unknown>) => {
    total++;
    if (!box.needsRewrap(sealed)) return;
    await save(await box.rewrap(sealed, context));
    rewrapped++;
  };

  for (const row of await db.select().from(instanceSettings).where(eq(instanceSettings.sealed, true)).all()) {
    await rewrap(row.value, `setting:${row.key}`, (value) =>
      db.update(instanceSettings).set({ value }).where(eq(instanceSettings.key, row.key)).run(),
    );
  }
  for (const row of await db.select().from(cfConnections).all()) {
    await rewrap(row.tokenSealed, cfTokenContext(row.id), (value) =>
      db.update(cfConnections).set({ tokenSealed: value }).where(eq(cfConnections.id, row.id)).run(),
    );
  }
  for (const row of await db.select().from(runtimes).all()) {
    await rewrap(row.projectSecretSealed, projectSecretContext(row.projectId), (value) =>
      db.update(runtimes).set({ projectSecretSealed: value }).where(eq(runtimes.projectId, row.projectId)).run(),
    );
  }
  for (const row of await db.select().from(runtimeSecrets).all()) {
    await rewrap(row.ciphertext, secretContext(row.projectId, row.branch, row.key), (value) =>
      db
        .update(runtimeSecrets)
        .set({ ciphertext: value })
        .where(
          and(
            eq(runtimeSecrets.projectId, row.projectId),
            eq(runtimeSecrets.branch, row.branch),
            eq(runtimeSecrets.key, row.key),
          ),
        )
        .run(),
    );
  }
  for (const row of await db.select().from(envVars).all()) {
    if (row.valueSealed === null) continue;
    await rewrap(row.valueSealed, buildVariableContext(row.projectId, row.branch, row.key), (value) =>
      db.update(envVars).set({ valueSealed: value }).where(eq(envVars.id, row.id)).run(),
    );
  }
  return { total, rewrapped };
}
