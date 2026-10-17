// `bohr deploy` for projects in their owner's own Cloudflare account: the CLI runs wrangler where it runs (a
// person's computer, an agent's sandbox, CI), with the owner's Cloudflare token, which this hands out to an API
// token whose user may publish production on the project (its owner; for an organization's project, an admin of
// the organization), the same people who connected that account or could. Then the CLI reports what it deployed.
// Projects bohr hosts never get a Cloudflare token: they deploy through the deploy API (services/deploy.ts).
import { and, count, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Project } from '../db/client';
import { auditLog, cliDeploys } from '../db/schema';
import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { conflict, HttpError } from '../lib/http';
import { type TokenCaller, tokenProjectAccess } from './api-tokens';
import { audit } from './audit';
import { branchSchema } from './deploy';
import { ownAccountConnectionId, ownerCloudflareToken } from './deploy-credentials';
import { productionWorkerName, sealedBuildVariables } from './variables';

/** Credentials handed to one user for one project within RATE_WINDOW_MS, at most. */
export const MAX_CREDENTIALS_PER_WINDOW = 30;
export const RATE_WINDOW_MS = 10 * 60_000;
/** Deploys one user may report for one project within RATE_WINDOW_MS. */
export const MAX_REPORTS_PER_WINDOW = 60;

export const CREDENTIALS_ACTION = 'cli.credentials';
export const REPORT_ACTION = 'cli.deploy';

const targetSchema = z.object({
  branch: branchSchema,
  // Must say so for the production branch, as with the deploy API, so a preview never reads as production
  production: z.boolean().default(false),
});

const reportSchema = targetSchema.extend({
  workerName: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,255}$/)
    .nullable()
    .default(null),
  versionId: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,100}$/)
    .nullable()
    .default(null),
  url: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .default(null),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .nullable()
    .default(null),
});

export type CliCredentials = {
  accountId: string;
  apiToken: string;
  buildVariables: Record<string, string>;
  /** The production Worker's name (the wrangler config's on the production branch), when bohr could read it. */
  workerName?: string;
};

/**
 * The project an API token deploys from the CLI with the owner's Cloudflare token: one the token reaches, in
 * its owner's account, not suspended, and only for its owners. Anything else is refused before a token is read.
 */
async function ownAccountProject(db: Db, caller: TokenCaller, projectId: string) {
  const { project, role } = await tokenProjectAccess(db, caller, projectId);
  if (project.mode !== 'byo') {
    throw conflict(
      'bohr hosts this project: bohr deploy uploads it through bohr, and bohr gives no Cloudflare credentials for it.',
      { code: 'hosted' },
    );
  }
  if (project.status === 'suspended') throw new HttpError(403, 'This project is suspended.', { code: 'suspended' });
  if (role !== 'owner') {
    throw new HttpError(
      403,
      "Only owners of the project (admins of its organization) can deploy it from the CLI: it runs in its owner's Cloudflare account, and the deploy uses that account's token. Push a branch instead: the project's workflow deploys it.",
      { code: 'own_account_not_allowed' },
    );
  }
  return project;
}

function assertTarget(project: Project, target: z.infer<typeof targetSchema>) {
  const isProduction = target.branch === project.productionBranch;
  if (isProduction && !target.production) {
    throw conflict(
      `${target.branch} is the production branch of this project: deploy it with --prod (production: true), or deploy a preview on another branch.`,
      { code: 'production_branch' },
    );
  }
  if (!isProduction && target.production) {
    throw new HttpError(
      400,
      `production: true deploys the production branch (${project.productionBranch}), not ${target.branch}.`,
    );
  }
}

/** 429 once the user asked this project for `action` `max` times within the window (counted in the audit log). */
async function rateLimit(db: Db, action: string, projectId: string, userId: string, max: number, now: Date) {
  const [recent] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.target, projectId),
        gt(auditLog.createdAt, new Date(now.getTime() - RATE_WINDOW_MS)),
        eq(auditLog.action, action),
        eq(auditLog.actorUserId, userId),
      ),
    )
    .all();
  if ((recent?.n ?? 0) >= max) {
    throw new HttpError(429, 'Too many deploys of this project in the last minutes. Wait a few minutes.', {
      code: 'rate_limited',
    });
  }
}

/**
 * The owner's Cloudflare token and account, and the build variables of the branch, for `bohr deploy` of a
 * project in its owner's account. Every issuance is audited (who, which token, which project and branch).
 */
export async function cliCredentials(
  db: Db,
  env: Env,
  caller: TokenCaller,
  projectId: string,
  body: unknown,
  now = new Date(),
): Promise<CliCredentials> {
  const project = await ownAccountProject(db, caller, projectId);
  const target = targetSchema.parse(body);
  assertTarget(project, target);
  await rateLimit(db, CREDENTIALS_ACTION, project.id, caller.user.id, MAX_CREDENTIALS_PER_WINDOW, now);

  const { connection, apiToken } = await ownerCloudflareToken(
    db,
    env,
    project,
    await ownAccountConnectionId(db, project),
  );
  const buildVariables = await sealedBuildVariables(db, env, project.id, target.branch);
  // Lets the CLI check it deploys the site's Worker; the CLI works without it
  const workerName = await productionWorkerName(db, env, project).catch(() => null);
  await audit(db, {
    actor: `token:${caller.token.id}`,
    actorUserId: caller.user.id,
    action: CREDENTIALS_ACTION,
    target: project.id,
    metadata: {
      tokenId: caller.token.id,
      tokenName: caller.token.name,
      branch: target.branch,
      production: target.production,
      accountId: connection.accountId,
      connectionId: connection.id,
      buildVariables: Object.keys(buildVariables).length,
    },
  });
  return {
    accountId: connection.accountId,
    apiToken,
    buildVariables,
    ...(workerName !== null ? { workerName } : {}),
  };
}

/** Records what `bohr deploy` deployed to the owner's account (wrangler's version and address). */
export async function recordCliDeploy(db: Db, caller: TokenCaller, projectId: string, body: unknown, now = new Date()) {
  const project = await ownAccountProject(db, caller, projectId);
  const report = reportSchema.parse(body);
  assertTarget(project, report);
  await rateLimit(db, REPORT_ACTION, project.id, caller.user.id, MAX_REPORTS_PER_WINDOW, now);
  const row = {
    id: randomId('cd_', 16),
    projectId: project.id,
    branch: report.branch,
    production: report.production,
    workerName: report.workerName,
    versionId: report.versionId,
    url: report.url,
    commitSha: report.commitSha,
    userId: caller.user.id,
    tokenId: caller.token.id,
    createdAt: now,
  };
  await db.insert(cliDeploys).values(row).run();
  await audit(db, {
    actor: `token:${caller.token.id}`,
    actorUserId: caller.user.id,
    action: REPORT_ACTION,
    target: project.id,
    metadata: {
      deployId: row.id,
      branch: row.branch,
      production: row.production,
      versionId: row.versionId,
      commitSha: row.commitSha,
    },
  });
  return { deploy: cliDeployView(row) };
}

type CliDeployRow = typeof cliDeploys.$inferSelect;

export function cliDeployView(row: CliDeployRow) {
  return {
    id: row.id,
    branch: row.branch,
    production: row.production,
    workerName: row.workerName,
    versionId: row.versionId,
    url: row.url,
    commitSha: row.commitSha,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

/** The project's latest CLI deploys, newest first. */
export async function listCliDeploys(db: Db, projectId: string, limit = 30) {
  const rows = await db
    .select()
    .from(cliDeploys)
    .where(eq(cliDeploys.projectId, projectId))
    .orderBy(desc(cliDeploys.createdAt))
    .limit(limit)
    .all();
  return rows.map(cliDeployView);
}
