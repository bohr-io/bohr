import { type CloudflareClient, isNotFoundError } from './client';

// D1 databases in an account (the databases of projects created from a template). Paths follow the public API
// reference: /accounts/:account/d1/database.

export type D1Database = { uuid: string; name: string };

const databasesPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/d1/database`;

/** The account's databases; with `name`, the ones whose name matches it (Cloudflare matches by substring). */
export async function listD1Databases(
  cf: CloudflareClient,
  accountId: string,
  options: { name?: string } = {},
): Promise<D1Database[]> {
  const databases = await cf.requestAllPages<{ uuid: string; name: string }>(databasesPath(accountId), 100, {
    name: options.name,
  });
  return databases.map(({ uuid, name }) => ({ uuid, name }));
}

/** The database with exactly this name, or null. */
export async function findD1Database(
  cf: CloudflareClient,
  accountId: string,
  name: string,
): Promise<D1Database | null> {
  const found = await listD1Databases(cf, accountId, { name });
  return found.find((database) => database.name === name) ?? null;
}

export async function createD1Database(cf: CloudflareClient, accountId: string, name: string): Promise<D1Database> {
  const created = await cf.request<{ uuid: string; name: string }>('POST', databasesPath(accountId), {
    json: { name },
  });
  return { uuid: created.uuid, name: created.name };
}

/** Deletes a database and its data; one already gone is fine. */
export async function deleteD1Database(cf: CloudflareClient, accountId: string, databaseId: string): Promise<void> {
  try {
    await cf.request<unknown>('DELETE', `${databasesPath(accountId)}/${encodeURIComponent(databaseId)}`);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}
