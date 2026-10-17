import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { PROJECT_WORKER_VERSION } from '../generated/runtime';

/** Moves every ready project runtime to the project Worker version this instance carries. */
export async function updateOutdatedRuntimes(db: Db, env: Env): Promise<{ version: string; updating: string[] }> {
  const rows = await db
    .select({
      projectId: runtimes.projectId,
      version: runtimes.version,
      status: runtimes.status,
      owner: projects.ownerUserId,
    })
    .from(runtimes)
    .innerJoin(projects, eq(projects.id, runtimes.projectId))
    .all();
  const outdated = rows.filter((row) => row.status === 'ready' && row.version !== PROJECT_WORKER_VERSION);
  for (const row of outdated) {
    await deps.startProvisioning(env, { projectId: row.projectId, userId: row.owner });
  }
  return { version: PROJECT_WORKER_VERSION, updating: outdated.map((row) => row.projectId) };
}
