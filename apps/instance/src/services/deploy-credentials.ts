// The credentials of a production deploy to the owner's own Cloudflare account, handed to the deploy workflow
// at run time (bohr-io/deploy-action with `credentials: 'true'`) instead of living in the repository's
// Actions secrets. The run proves who it is with its GitHub OIDC token; only the production deploy workflow
// (DEPLOY_WORKFLOW_PATH) on a push to the production branch gets them. bohr hands out the owner's own
// Cloudflare token, never a temporary one and never the instance's: projects bohr hosts deploy with
// bohr-io/deploy-action instead and are refused here.
import { DEPLOY_WORKFLOW_PATH } from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { cfConnections, projects, runtimes } from '../db/schema';
import type { Env } from '../env';
import { forbidden } from '../lib/http';
import type { GithubActionsClaims } from '../lib/oidc';
import { connectionsOf, projectOwner } from '../lib/owner';
import { vault } from '../lib/vault';
import { audit } from './audit';
import { cfTokenContext } from './provision';
import { readSetting } from './settings';
import { sealedBuildVariables } from './variables';

export type DeployCredentials = { accountId: string; apiToken: string; buildVariables: Record<string, string> };

/** The events the deploy workflow runs on. */
const DEPLOY_EVENTS = new Set(['push', 'workflow_dispatch']);

type MoveState = { connectionId: string; accountId: string; completedAt?: number };

/**
 * The project of a run's repository: by GitHub's repository id, else by name for a project that has no id yet
 * (imported from v1; the first run records it). `renamed`: a project has the name but another id, so the
 * repository was deleted or renamed and the name taken by someone else.
 */
export async function findRepositoryProject(
  db: Db,
  claims: GithubActionsClaims,
): Promise<{ project: Project } | { project: null; reason: 'unknown' | 'renamed' }> {
  const repoId =
    claims.repository_id !== undefined && /^\d+$/.test(claims.repository_id) ? Number(claims.repository_id) : null;
  const byId = repoId === null ? undefined : await db.select().from(projects).where(eq(projects.repoId, repoId)).get();
  if (byId !== undefined) return { project: byId };
  const byName = await db.select().from(projects).where(eq(projects.repoKey, claims.repository.toLowerCase())).get();
  if (byName === undefined) return { project: null, reason: 'unknown' };
  if (byName.repoId !== null) return { project: null, reason: 'renamed' };
  if (repoId !== null) {
    await db.update(projects).set({ repoId }).where(eq(projects.id, byName.id)).run();
    byName.repoId = repoId;
  }
  return { project: byName };
}

async function projectForRepository(db: Db, claims: GithubActionsClaims): Promise<Project> {
  const found = await findRepositoryProject(db, claims);
  if (found.project !== null) return found.project;
  throw forbidden(
    found.reason === 'renamed'
      ? `${claims.repository} is not the repository this project was created from.`
      : `No bohr project is linked to ${claims.repository}.`,
  );
}

/**
 * The owner's Cloudflare token for a project in their own account, from the connection it deploys with, and
 * that connection. A runtime without a connection runs in the instance's own account, whose token is never
 * handed out; nor is a connection that holds the instance's token.
 */
export async function ownerCloudflareToken(db: Db, env: Env, project: Project, connectionId: string | null) {
  if (connectionId === null) {
    throw forbidden("This project has no Cloudflare account of its owner's connected: connect one in bohr.");
  }
  const connection = await db
    .select()
    .from(cfConnections)
    .where(and(eq(cfConnections.id, connectionId), connectionsOf(projectOwner(project))))
    .get();
  if (connection === undefined) {
    throw forbidden("The project's Cloudflare connection was removed: connect the account in bohr again.");
  }
  const apiToken = await vault(env).open(connection.tokenSealed, cfTokenContext(connection.id));
  if (env.CF_API_TOKEN && apiToken === env.CF_API_TOKEN) {
    throw forbidden("The project's Cloudflare connection is the instance's own account.");
  }
  await db.update(cfConnections).set({ lastUsedAt: new Date() }).where(eq(cfConnections.id, connection.id)).run();
  return { connection, apiToken };
}

/**
 * The connection a project in its owner's account deploys with when nothing is moving: the project's own (its
 * runtime may run in bohr's account), else for older projects its runtime's, else the one a completed move chose
 * (a moved project whose agent still runs in bohr's account).
 */
export async function ownAccountConnectionId(db: Db, project: Project): Promise<string | null> {
  if (project.cfConnectionId !== null) return project.cfConnectionId;
  const [runtime, move] = await Promise.all([
    db.select().from(runtimes).where(eq(runtimes.projectId, project.id)).get(),
    readSetting<MoveState>(db, `move:${project.id}`),
  ]);
  return runtime?.cfConnectionId ?? move?.connectionId ?? null;
}

export async function deployCredentials(db: Db, env: Env, claims: GithubActionsClaims): Promise<DeployCredentials> {
  const project = await projectForRepository(db, claims);
  if (project.status === 'suspended') throw forbidden('This project is suspended.');

  const move = await readSetting<MoveState>(db, `move:${project.id}`);
  // Moving out of bohr's hosting: the merged pull request deploys to the account chosen for the move, and
  // the project stays hosted by bohr until that deploy is done (services/move.ts)
  const moving = project.mode === 'managed' && move !== null && move.completedAt === undefined;
  if (project.mode !== 'byo' && !moving) {
    throw forbidden(
      'This project is hosted by bohr: it deploys with bohr-io/deploy-action, and bohr gives no Cloudflare credentials for it.',
    );
  }

  const production = `refs/heads/${project.productionBranch}`;
  if (claims.ref !== production) {
    throw forbidden(
      `Deploy credentials are only given to runs on the production branch (${project.productionBranch}).`,
    );
  }
  const workflow = `${claims.repository}/${DEPLOY_WORKFLOW_PATH}@${production}`;
  if (claims.job_workflow_ref !== workflow) {
    throw forbidden(`Deploy credentials are only given to ${DEPLOY_WORKFLOW_PATH} on ${project.productionBranch}.`);
  }
  if (claims.event_name === undefined || !DEPLOY_EVENTS.has(claims.event_name)) {
    throw forbidden(
      `Deploy credentials are only given to push and workflow_dispatch runs, not ${claims.event_name ?? 'this event'}.`,
    );
  }

  // The owner's Cloudflare connection the project deploys with, or the one chosen for the move.
  const connectionId = moving ? (move?.connectionId ?? null) : await ownAccountConnectionId(db, project);
  const { connection, apiToken } = await ownerCloudflareToken(db, env, project, connectionId);

  const buildVariables = await sealedBuildVariables(db, env, project.id, project.productionBranch);
  await audit(db, {
    actor: `github-actions:${claims.repository}${claims.run_id ? `#${claims.run_id}` : ''}`,
    action: 'deploy.credentials',
    target: project.id,
    metadata: {
      repository: claims.repository,
      ref: claims.ref,
      runId: claims.run_id ?? null,
      accountId: connection.accountId,
      connectionId: connection.id,
      buildVariables: Object.keys(buildVariables).length,
    },
  });
  return { accountId: connection.accountId, apiToken, buildVariables };
}
