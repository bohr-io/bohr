import {
  type CloudflareClient,
  CloudflareError,
  deleteDispatchScriptSecret,
  putDispatchScriptSecret,
} from '@bohr/cloudflare';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { ALL_BRANCHES, deployments, envVars, runtimeSecrets } from '../db/schema';
import type { Env } from '../env';
import { cloudEnv } from '../lib/cloud';
import { randomId } from '../lib/crypto';
import { vault } from '../lib/vault';

export const secretContext = (projectId: string, branch: string, key: string) => `${projectId}:${branch}:${key}`;

// Decrypted runtime secrets for a branch: project-wide values, overridden by branch-specific ones
export async function runtimeSecretsFor(db: Db, env: Env, projectId: string, branch: string) {
  const rows = await db
    .select()
    .from(runtimeSecrets)
    .where(and(eq(runtimeSecrets.projectId, projectId), inArray(runtimeSecrets.branch, [ALL_BRANCHES, branch])))
    .all();
  const ordered = [
    ...rows.filter((row) => row.branch === ALL_BRANCHES),
    ...rows.filter((row) => row.branch !== ALL_BRANCHES),
  ];
  const secrets = new Map<string, string>();
  for (const row of ordered) {
    secrets.set(row.key, await vault(env).open(row.ciphertext, secretContext(projectId, row.branch, row.key)));
  }
  return secrets;
}

// Scripts already deployed for a branch, or for every branch when branch is "*"
async function deployedScripts(db: Db, projectId: string, branch: string) {
  const rows = await db
    .selectDistinct({ script: deployments.script, branch: deployments.branch })
    .from(deployments)
    .where(and(eq(deployments.projectId, projectId), eq(deployments.status, 'success')))
    .all();
  return rows.filter((row) => branch === ALL_BRANCHES || row.branch === branch);
}

async function branchesOverriding(db: Db, projectId: string, key: string) {
  const rows = await db
    .select({ branch: runtimeSecrets.branch })
    .from(runtimeSecrets)
    .where(and(eq(runtimeSecrets.projectId, projectId), eq(runtimeSecrets.key, key)))
    .all();
  return new Set(rows.map((row) => row.branch).filter((branch) => branch !== ALL_BRANCHES));
}

// Stores the secret (encrypted) for future deploys and sets it on the scripts already deployed
export async function setRuntimeSecret(
  db: Db,
  env: Env,
  cf: CloudflareClient,
  project: Project,
  branch: string,
  key: string,
  value: string,
) {
  const ciphertext = await vault(env).seal(value, secretContext(project.id, branch, key));
  await db.batch([
    db
      .insert(runtimeSecrets)
      .values({ projectId: project.id, branch, key, ciphertext })
      .onConflictDoUpdate({
        target: [runtimeSecrets.projectId, runtimeSecrets.branch, runtimeSecrets.key],
        set: { ciphertext },
      }),
    db
      .insert(envVars)
      .values({
        id: randomId('v_', 16),
        projectId: project.id,
        branch,
        key,
        target: 'runtime',
        isSecret: true,
        value: null,
      })
      .onConflictDoUpdate({
        target: [envVars.projectId, envVars.branch, envVars.key, envVars.target],
        set: { isSecret: true, value: null, updatedAt: new Date() },
      }),
  ]);

  const overridden = branch === ALL_BRANCHES ? await branchesOverriding(db, project.id, key) : new Set<string>();
  for (const target of await deployedScripts(db, project.id, branch)) {
    if (overridden.has(target.branch)) continue;
    try {
      await putDispatchScriptSecret(cf, cloudEnv(env).DISPATCH_NAMESPACE, target.script, key, value);
    } catch (error) {
      // A script removed outside bohr gets the secret on its next deploy
      if (!(error instanceof CloudflareError && error.status === 404)) throw error;
    }
  }
}

export async function deleteRuntimeSecret(
  db: Db,
  env: Env,
  cf: CloudflareClient,
  project: Project,
  branch: string,
  key: string,
) {
  await db.batch([
    db
      .delete(runtimeSecrets)
      .where(
        and(eq(runtimeSecrets.projectId, project.id), eq(runtimeSecrets.branch, branch), eq(runtimeSecrets.key, key)),
      ),
    db
      .delete(envVars)
      .where(
        and(
          eq(envVars.projectId, project.id),
          eq(envVars.branch, branch),
          eq(envVars.key, key),
          eq(envVars.target, 'runtime'),
        ),
      ),
  ]);
  for (const target of await deployedScripts(db, project.id, branch)) {
    try {
      await deleteDispatchScriptSecret(cf, cloudEnv(env).DISPATCH_NAMESPACE, target.script, key);
    } catch (error) {
      if (!(error instanceof CloudflareError && error.status === 404)) throw error;
    }
  }
}
