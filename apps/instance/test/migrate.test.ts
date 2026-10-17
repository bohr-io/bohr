import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/generated/migrations';
import { ensureMigrated, resetMigrationState } from '../src/lib/migrate';

afterEach(() => resetMigrationState());

describe('self-migration', () => {
  it('creates the schema in an empty database once, in the table wrangler uses', async () => {
    resetMigrationState();
    await ensureMigrated({ DB: env.EMPTY_DB });
    const applied = await env.EMPTY_DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    expect(applied.results.map((row) => row.name)).toEqual(MIGRATIONS.map((migration) => migration.name));
    const tables = await env.EMPTY_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{
      name: string;
    }>();
    expect(tables.results.map((row) => row.name)).toEqual(expect.arrayContaining(['users', 'projects', 'runtimes']));

    resetMigrationState();
    await ensureMigrated({ DB: env.EMPTY_DB });
    const again = await env.EMPTY_DB.prepare('SELECT COUNT(*) AS count FROM d1_migrations').first<{ count: number }>();
    expect(again?.count).toBe(MIGRATIONS.length);
  });
});
