// Deleting a project: everything bohr created for it goes (the agent's Workers and container, bohr's hosting,
// the routes), then its rows. The repository is never touched. The site in the owner's own Cloudflare account
// goes only when they ask for it, with the repository secrets that would deploy it again.
import {
  deleteAccountScript,
  deleteContainerApplication,
  deleteDispatchScript,
  findDurableObjectNamespaceId,
} from '@bohr/cloudflare';
import { GithubClient } from '@bohr/github';
import { eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { deployments, hostnames, projects, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { cloudEnv, hasCloud } from '../lib/cloud';
import { audit } from './audit';
import { repositoryToken } from './github-app';
import { stopServing } from './move';
import { accountClient } from './provision';
import { deleteScreenshots } from './screenshots';
import { deleteSetting, readSetting } from './settings';
import { productionWorker } from './variables';

export type DeleteProjectResult = {
  /** What could not be removed; the project is deleted anyway, these are left for the owner to clean up. */
  warnings: string[];
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function deleteProject(
  db: Db,
  env: Env,
  project: Project,
  userId: string,
  options: { deleteSite: boolean; actor?: string },
): Promise<DeleteProjectResult> {
  const warnings: string[] = [];
  const attempt = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.error('[delete]', project.id, what, error);
      warnings.push(`${what}: ${message(error)}`);
    }
  };

  // The site in the owner's account first: finding its Worker needs the runtime's account
  if (options.deleteSite && project.mode === 'byo') {
    await attempt('site Worker', async () => {
      const { cf, accountId, script } = await productionWorker(db, env, project);
      await deleteAccountScript(cf, accountId, script, { force: true });
    });
    await attempt('repository secrets', async () => {
      const { token } = await repositoryToken(db, env, project, 'secrets');
      const github = new GithubClient({ token, fetch: deps.fetch });
      for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
        await github.deleteActionsSecret(project.repoOwner, project.repoName, name);
      }
    });
  }

  // The agent: its container application, the project Worker and the preview Worker
  const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, project.id)).get();
  if (runtime !== undefined) {
    await attempt('agent Workers', async () => {
      const cf = await accountClient(db, env, runtime.cfConnectionId, runtime.accountId);
      const namespaceId = await findDurableObjectNamespaceId(cf, runtime.accountId, runtime.script, 'Project');
      if (namespaceId !== null) await deleteContainerApplication(cf, runtime.accountId, namespaceId);
      await deleteAccountScript(cf, runtime.accountId, runtime.previewScript, { force: true });
      await deleteAccountScript(cf, runtime.accountId, runtime.script, { force: true });
    });
  }

  // bohr's hosting (projects migrated from v1): routes, hostnames and the deployed copies
  if (hasCloud(env)) {
    const cloud = cloudEnv(env);
    const bohrCf = deps.cloudflare(env);
    for (const row of await db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all()) {
      await attempt(row.hostname, () => stopServing(db, bohrCf, cloud.ROUTES, row));
    }
    const scripts = await db
      .selectDistinct({ script: deployments.script })
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .all();
    for (const { script } of scripts) {
      await attempt(`hosted copy ${script}`, () => deleteDispatchScript(bohrCf, cloud.DISPATCH_NAMESPACE, script));
    }
    // After a move, bohr.io addresses redirect to the site's new home
    const moved = await readSetting<{ hostnames?: { hostname: string; status: string }[] }>(db, `move:${project.id}`);
    for (const row of moved?.hostnames ?? []) {
      if (row.status === 'redirected') await attempt(row.hostname, () => cloud.ROUTES.delete(row.hostname));
    }
  }

  await audit(db, {
    actorUserId: userId,
    actor: options.actor ?? `user:${userId}`,
    action: 'project.delete',
    target: project.id,
    metadata: {
      name: project.name,
      repository: `${project.repoOwner}/${project.repoName}`,
      deleteSite: options.deleteSite,
      warnings: warnings.length,
    },
  });
  await deleteSetting(db, `move:${project.id}`);
  await attempt('screenshot', () => deleteScreenshots(env, project.id));
  // Members, variables, deployments, hostnames and the runtime go with it (foreign keys cascade)
  await db.delete(projects).where(eq(projects.id, project.id)).run();
  return { warnings };
}
