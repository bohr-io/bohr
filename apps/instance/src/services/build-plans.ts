// Build plans of projects bohr hosts that were migrated from v1. Their repositories keep bohr v1's workflow
// (.github/workflows/bohr.yml running bohr-io/action): bohr writes nothing into them. bohr-io/action asks the
// instance for the project's build plan with the run's GitHub OIDC token (POST /api/deploy/build-plan); with
// one, it writes the plan's files into the workspace, sets up Node.js, installs, builds and deploys with
// bohr-io/deploy-action; without one (404), it falls back to bohr v1. See docs/managed-hosting.md.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Project } from '../db/client';
import { ALL_BRANCHES, buildPlans, envVars, hostnames } from '../db/schema';
import type { Env } from '../env';
import { randomId } from '../lib/crypto';
import { badRequest, conflict, forbidden } from '../lib/http';
import { branchFromRef, type GithubActionsClaims } from '../lib/oidc';
import { vault } from '../lib/vault';
import { audit } from './audit';
import { findRepositoryProject } from './deploy-credentials';
import { buildVariableContext, reservedVariable, sealedBuildVariables } from './variables';

/** Total size of a plan's files (UTF-8). */
export const BUILD_PLAN_MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 100;
/** The events whose runs get a plan: the ones bohr v1's workflow runs on, and a manual run. */
const BUILD_EVENTS = new Set(['push', 'workflow_dispatch', 'repository_dispatch']);

/**
 * Why a plan's file path is refused, or null when it is fine: relative, `/`-separated, no `.`/`..`/empty
 * segments, no drive letter, nothing in .git or .github (a plan never changes workflows).
 */
export function invalidPlanPath(path: string): string | null {
  if (path.length === 0 || path.length > 256) return 'must be 1 to 256 characters';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
  if (/[\u0000-\u001f\u007f\\:]/.test(path)) return 'has a control character, a backslash or a colon';
  if (path.startsWith('/')) return 'must be relative to the repository root';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'has an empty, "." or ".." segment';
  }
  const first = segments[0]?.toLowerCase();
  if (first === '.github' || segments.some((segment) => segment.toLowerCase() === '.git')) {
    return 'is inside .github or .git';
  }
  return null;
}

const commandSchema = z
  .string()
  .max(4096)
  .regex(/^[^\0\r]*$/, 'must not contain NUL or carriage returns')
  .nullish()
  .transform((value) => (value === undefined || value === null || value.trim() === '' ? null : value));

export const buildPlanSchema = z
  .object({
    // What actions/setup-node accepts: 22, 20.11.1, 18.x, lts/*, lts/iron…
    nodeVersion: z.string().regex(/^[A-Za-z0-9.*/_-]{1,32}$/, 'is not a Node.js version'),
    install: commandSchema,
    build: commandSchema,
    files: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((plan, context) => {
    const entries = Object.entries(plan.files);
    if (entries.length > MAX_FILES) {
      context.addIssue({ code: 'custom', path: ['files'], message: `at most ${MAX_FILES} files` });
    }
    let bytes = 0;
    for (const [path, content] of entries) {
      const problem = invalidPlanPath(path);
      if (problem !== null) context.addIssue({ code: 'custom', path: ['files', path], message: problem });
      bytes += new TextEncoder().encode(content).byteLength;
    }
    if (bytes > BUILD_PLAN_MAX_BYTES) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'the files exceed 2 MiB in total' });
    }
  });

export type BuildPlanInput = z.infer<typeof buildPlanSchema>;

function requireManaged(project: Project) {
  if (project.mode !== 'managed') {
    throw conflict("Build plans are for projects bohr hosts; this one runs in its owner's Cloudflare account.");
  }
}

export async function readBuildPlan(db: Db, project: Project) {
  const plan = await db.select().from(buildPlans).where(eq(buildPlans.projectId, project.id)).get();
  if (plan === undefined) return null;
  return {
    nodeVersion: plan.nodeVersion,
    install: plan.install,
    build: plan.build,
    files: plan.files,
    updatedAt: plan.updatedAt,
  };
}

export async function saveBuildPlan(db: Db, project: Project, input: BuildPlanInput) {
  requireManaged(project);
  const values = { nodeVersion: input.nodeVersion, install: input.install, build: input.build, files: input.files };
  await db
    .insert(buildPlans)
    .values({ projectId: project.id, ...values })
    .onConflictDoUpdate({ target: buildPlans.projectId, set: { ...values, updatedAt: new Date() } })
    .run();
  await audit(db, {
    actor: 'admin',
    action: 'build_plan.set',
    target: project.id,
    metadata: { nodeVersion: input.nodeVersion, files: Object.keys(input.files) },
  });
}

export async function deleteBuildPlan(db: Db, project: Project) {
  await db.delete(buildPlans).where(eq(buildPlans.projectId, project.id)).run();
  await audit(db, { actor: 'admin', action: 'build_plan.delete', target: project.id });
}

export const buildVariablesSchema = z.object({
  branch: z.string().min(1).max(255).default(ALL_BRANCHES),
  values: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/, 'is not a variable name'), z.string().max(5120))
    .refine((values) => Object.keys(values).length <= 200, 'at most 200 variables'),
});

/**
 * Build variables of a project bohr hosts, set by the operator (the v1 migration): sealed in bohr for one
 * branch or every branch ('*'), never stored in the repository. Stored as secret: the panel shows the names
 * only. Values are never logged or audited.
 */
export async function saveBuildVariables(
  db: Db,
  env: Env,
  project: Project,
  input: z.infer<typeof buildVariablesSchema>,
) {
  requireManaged(project);
  const names = Object.keys(input.values);
  const reserved = names.filter(reservedVariable);
  if (reserved.length > 0) throw badRequest(`${reserved.join(', ')}: names bohr or GitHub use themselves.`);
  for (const [key, value] of Object.entries(input.values)) {
    const valueSealed = await vault(env).seal(value, buildVariableContext(project.id, input.branch, key));
    await db
      .insert(envVars)
      .values({
        id: randomId('v_', 16),
        projectId: project.id,
        branch: input.branch,
        key,
        target: 'build',
        isSecret: true,
        value: null,
        valueSealed,
      })
      .onConflictDoUpdate({
        target: [envVars.projectId, envVars.branch, envVars.key, envVars.target],
        set: { isSecret: true, value: null, valueSealed, updatedAt: new Date() },
      })
      .run();
  }
  await audit(db, {
    actor: 'admin',
    action: 'build_variables.set',
    target: project.id,
    metadata: { branch: input.branch, names },
  });
}

export type BuildPlanAnswer =
  | { found: false }
  | {
      found: true;
      nodeVersion: string;
      install: string | null;
      build: string | null;
      files: Record<string, string>;
      buildVariables: Record<string, string>;
      /** The production address already moved to v2: a failing deploy must fail, not fall back to v1. */
      live: boolean;
    };

/**
 * The build plan for a GitHub Actions run of a project bohr hosts. `found: false` (404) for any repository
 * that is not one of those projects or has no plan, so bohr-io/action falls back to bohr v1 cheaply. A
 * project with a plan refuses (403) suspended projects, runs that are not a push, workflow_dispatch or
 * repository_dispatch (pull requests never get build variables) and refs that are not branches.
 */
export async function buildPlanForRun(db: Db, env: Env, claims: GithubActionsClaims): Promise<BuildPlanAnswer> {
  const { project } = await findRepositoryProject(db, claims);
  if (project === null || project.mode !== 'managed') return { found: false };
  const plan = await readBuildPlan(db, project);
  if (plan === null) return { found: false };

  if (project.status === 'suspended') throw forbidden('This project is suspended.');
  if (claims.event_name === undefined || !BUILD_EVENTS.has(claims.event_name)) {
    throw forbidden(
      `Build plans are only given to push, workflow_dispatch and repository_dispatch runs, not ${claims.event_name ?? 'this event'}.`,
    );
  }
  const branch = branchFromRef(claims.ref);
  if (branch === null) throw forbidden('Only branches deploy; tags are not supported.');

  const buildVariables = await sealedBuildVariables(db, env, project.id, branch);
  await audit(db, {
    actor: `github-actions:${claims.repository}${claims.run_id ? `#${claims.run_id}` : ''}`,
    action: 'deploy.build_plan',
    target: project.id,
    metadata: {
      repository: claims.repository,
      ref: claims.ref,
      runId: claims.run_id ?? null,
      event: claims.event_name,
      buildVariables: Object.keys(buildVariables).length,
    },
  });
  const production = await db
    .select({ status: hostnames.status })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, project.id), eq(hostnames.isProduction, true)))
    .all();
  return {
    found: true,
    live: production.some((row) => row.status === 'live'),
    nodeVersion: plan.nodeVersion,
    install: plan.install,
    build: plan.build,
    files: plan.files,
    buildVariables,
  };
}
