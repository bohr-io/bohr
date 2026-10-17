import type { Env } from '../env';
import { MIGRATIONS } from '../generated/migrations';

// Applies the D1 migrations the instance was built with, in wrangler's own table (d1_migrations), so
// `wrangler d1 migrations apply` and this agree on what ran. Once per isolate; concurrent isolates may
// race on the first deploy, and the loser finds the migration recorded on its retry.
// Only the outcome is kept, never the promise: a request's I/O belongs to that request, so a check another request
// started (and its browser then cancelled) may never settle, and every request awaiting it would hang.

let migrated = false;

export async function ensureMigrated(env: Pick<Env, 'DB'>): Promise<void> {
  if (migrated) return;
  await migrate(env.DB);
  migrated = true;
}

async function migrate(db: D1Database): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  for (let attempt = 0; attempt < 2; attempt++) {
    const applied = new Set(
      (await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((row) => row.name),
    );
    const pending = MIGRATIONS.filter((migration) => !applied.has(migration.name));
    if (pending.length === 0) return;
    try {
      for (const migration of pending) {
        await db.batch([
          ...migration.statements.map((statement) => db.prepare(statement)),
          db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migration.name),
        ]);
      }
      return;
    } catch (error) {
      // Another isolate applied it first: look again
      if (attempt === 1) throw error;
    }
  }
}

/** The migrations this build has that the database has not applied (none recorded yet: all of them). */
export async function pendingMigrations(env: Pick<Env, 'DB'>): Promise<string[]> {
  const applied = await env.DB.prepare('SELECT name FROM d1_migrations')
    .all<{ name: string }>()
    .then((result) => new Set(result.results.map((row) => row.name)))
    .catch(() => new Set<string>());
  return MIGRATIONS.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
}

export function resetMigrationState(): void {
  migrated = false;
}
