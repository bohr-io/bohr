import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { instanceSettings } from '../db/schema';
import type { Env } from '../env';
import { vault } from '../lib/vault';

const context = (key: string) => `setting:${key}`;

export async function readSetting<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.select().from(instanceSettings).where(eq(instanceSettings.key, key)).get();
  if (row === undefined || row.sealed) return null;
  return JSON.parse(row.value) as T;
}

export async function writeSetting(db: Db, key: string, value: unknown): Promise<void> {
  const row = { key, value: JSON.stringify(value), sealed: false, updatedAt: new Date() };
  await db.insert(instanceSettings).values(row).onConflictDoUpdate({ target: instanceSettings.key, set: row }).run();
}

/** Stores a sealed setting only when the key is free; returns whatever is stored afterwards. */
export async function insertSealedSettingIfAbsent<T>(db: Db, env: Env, key: string, value: T): Promise<T> {
  await db
    .insert(instanceSettings)
    .values({ key, value: await vault(env).seal(JSON.stringify(value), context(key)), sealed: true })
    .onConflictDoNothing()
    .run();
  return (await readSealedSetting<T>(db, env, key)) ?? value;
}

/** A setting stored encrypted with the vault (keys, secrets). */
export async function readSealedSetting<T>(db: Db, env: Env, key: string): Promise<T | null> {
  const row = await db.select().from(instanceSettings).where(eq(instanceSettings.key, key)).get();
  if (row === undefined || !row.sealed) return null;
  return JSON.parse(await vault(env).open(row.value, context(key))) as T;
}

export async function writeSealedSetting(db: Db, env: Env, key: string, value: unknown): Promise<void> {
  const row = {
    key,
    value: await vault(env).seal(JSON.stringify(value), context(key)),
    sealed: true,
    updatedAt: new Date(),
  };
  await db.insert(instanceSettings).values(row).onConflictDoUpdate({ target: instanceSettings.key, set: row }).run();
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.delete(instanceSettings).where(eq(instanceSettings.key, key)).run();
}
