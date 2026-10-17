// Connecting a user's Claude subscription (Pro/Max) for their agent. bohr never runs an OAuth client: the
// official Claude Code CLI runs `claude setup-token`, and the instance relays the authorization URL the CLI
// prints to the panel and the code the user pastes back, and stores the long-lived token the CLI creates like an
// API key (sealed, then a secret of every project the owner has). The token never goes back to the browser.
//
// Where the CLI runs: in the instance's dedicated sign-in container when the CLAUDE_LOGIN binding is configured
// (containers/claude-login.ts; no project needed), otherwise in one of the owner's ready project containers.
import {
  type AgentEffort,
  claudeLoginFinishResultSchema,
  claudeLoginStartResultSchema,
  RUNNER_PATHS,
  RUNTIME_API_PREFIX,
} from '@bohr/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects, runtimes, users } from '../db/schema';
import { deps } from '../deps';
import type { Env, User } from '../env';
import { badRequest, HttpError, notFound } from '../lib/http';
import { type Owner, ownerTarget, projectsOf, userOwner } from '../lib/owner';
import { type AgentSettings, saveAgentSettings } from './agent-settings';
import { audit } from './audit';
import { ownerMemberKey } from './provision';
import { signRuntimeToken } from './runtime-keys';

/** Where the authorization link may point: Anthropic's own sign-in pages (claude.ai, claude.com…). */
const AUTHORIZE_HOST = /(?:^|\.)(?:claude\.ai|claude\.com|anthropic\.com)$/;

type OwnedRuntime = { projectId: string; workerUrl: string; ownerUserId: string };

/** The step's path on the sign-in server and on the project Worker's runtime API alike. */
type Step =
  | typeof RUNNER_PATHS.claudeLoginStart
  | typeof RUNNER_PATHS.claudeLoginFinish
  | typeof RUNNER_PATHS.claudeLoginCancel;

/** Whether the sign-in runs in the dedicated container (CLAUDE_LOGIN) rather than in a project container. */
export const hasLoginContainer = (env: Env) => env.CLAUDE_LOGIN !== undefined;

/** The dedicated container's name for an owner: one per user and one per organization. */
export const loginContainerName = (owner: Owner) => `${owner.kind}:${owner.id}`;

/**
 * A ready runtime of a project of the owner (the user's personal projects, or an organization's): that one, or
 * the most recently updated.
 */
async function ownedRuntime(db: Db, owner: Owner, projectId?: string): Promise<OwnedRuntime | null> {
  const row = await db
    .select({ projectId: projects.id, workerUrl: runtimes.workerUrl, ownerUserId: projects.ownerUserId })
    .from(projects)
    .innerJoin(runtimes, eq(runtimes.projectId, projects.id))
    .where(
      and(
        projectsOf(owner),
        eq(runtimes.status, 'ready'),
        isNotNull(runtimes.workerUrl),
        projectId === undefined ? undefined : eq(projects.id, projectId),
      ),
    )
    .orderBy(desc(runtimes.updatedAt))
    .get();
  return row?.workerUrl ? { projectId: row.projectId, workerUrl: row.workerUrl, ownerUserId: row.ownerUserId } : null;
}

/** The answer of a sign-in step, or its refusal as the panel understands it. */
async function stepResult(response: Response | null, where: 'container' | 'project'): Promise<Record<string, unknown>> {
  if (response === null) {
    throw new HttpError(
      502,
      where === 'container' ? 'Could not reach the sign-in container.' : 'Could not reach the project Worker.',
      { code: 'runtime_error' },
    );
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && json !== null) return json;
  throw stepError(response.status, json, where);
}

/** A refusal of the sign-in server (through either path). Its text runs in the user's account: kept short. */
function stepError(status: number, body: Record<string, unknown> | null, where: 'container' | 'project'): HttpError {
  const message = typeof body?.message === 'string' ? body.message.slice(0, 300) : undefined;
  switch (status) {
    case 400:
      return badRequest(message ?? 'Invalid request.');
    case 404:
      return new HttpError(404, 'The sign-in expired; start again.', { code: 'login_expired' });
    case 409:
      return new HttpError(409, message ?? 'Another sign-in to Claude is in progress.', { code: 'login_running' });
    case 422:
      return new HttpError(422, message ?? 'Claude did not accept the code.', { code: 'code_rejected' });
    case 504:
      return new HttpError(504, message ?? 'The sign-in took too long; start again.', { code: 'timeout' });
    default:
      if (where === 'container' && status === 503) {
        return new HttpError(503, 'The sign-in to Claude is unavailable right now; try again in a minute.', {
          code: 'login_unavailable',
        });
      }
      return new HttpError(
        502,
        where === 'container'
          ? 'The sign-in container could not run the sign-in to Claude.'
          : 'The project could not run the sign-in to Claude.',
        { code: 'runtime_error' },
      );
  }
}

/** A step in the owner's dedicated sign-in container. */
async function callLoginContainer(env: Env, owner: Owner, step: Step, body: unknown = {}) {
  let response: Response | null;
  try {
    response = await deps.claudeLoginServer(env, loginContainerName(owner))(step, body);
  } catch {
    response = null;
  }
  return stepResult(response, 'container');
}

/**
 * A step through the project Worker's runtime API, as the project's owner: the person who created it, also when
 * an admin of the organization runs the sign-in (the project Worker only knows its creator as owner).
 */
async function callRuntime(db: Db, env: Env, user: User, target: OwnedRuntime, step: Step, body: unknown = {}) {
  const owner =
    target.ownerUserId === user.id ? user : await db.select().from(users).where(eq(users.id, target.ownerUserId)).get();
  const token = await signRuntimeToken(db, env, {
    projectId: target.projectId,
    memberKey: await ownerMemberKey(db, target.ownerUserId),
    name: owner?.name ?? 'Owner',
  });
  const response = await deps
    .fetch(`${target.workerUrl}${RUNTIME_API_PREFIX}${step}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  return stepResult(response, 'project');
}

/**
 * The project container a sign-in started in (the fallback path): finish and cancel name it, since the CLI is
 * waiting for the code there.
 */
async function startedRuntime(db: Db, owner: Owner, projectId: string | null | undefined): Promise<OwnedRuntime> {
  if (!projectId) throw badRequest('Send the projectId the sign-in started in.');
  const target = await ownedRuntime(db, owner, projectId);
  if (target === null) throw notFound('Project not found.');
  return target;
}

/**
 * Starts `claude setup-token` for the owner (the user, or with `owner` an organization): in the dedicated sign-in
 * container (projectId null), or in one of the owner's project containers. The link they authorize at.
 */
export async function startSubscriptionLogin(
  db: Db,
  env: Env,
  user: User,
  owner: Owner = userOwner(user.id),
): Promise<{ projectId: string | null; loginId: string; url: string }> {
  let projectId: string | null = null;
  let result: Record<string, unknown>;
  if (hasLoginContainer(env)) {
    result = await callLoginContainer(env, owner, RUNNER_PATHS.claudeLoginStart);
  } else {
    const target = await ownedRuntime(db, owner);
    if (target === null) {
      throw new HttpError(409, 'Connecting a Claude subscription needs a project with the agent ready.', {
        code: 'no_runtime',
      });
    }
    projectId = target.projectId;
    result = await callRuntime(db, env, user, target, RUNNER_PATHS.claudeLoginStart);
  }
  const parsed = claudeLoginStartResultSchema.safeParse(result);
  if (!parsed.success || !isAuthorizeUrl(parsed.data.url)) {
    throw new HttpError(502, 'The sign-in returned an unexpected link.', { code: 'runtime_error' });
  }
  return { projectId, loginId: parsed.data.loginId, url: parsed.data.url };
}

function isAuthorizeUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:' && AUTHORIZE_HOST.test(url.hostname) && url.pathname.includes('/oauth/authorize');
}

/** Hands the code to the CLI and saves the token it created as the owner's agent settings. */
export async function finishSubscriptionLogin(
  db: Db,
  env: Env,
  user: User,
  input: {
    projectId?: string | null;
    loginId: string;
    code: string;
    model?: string | null;
    effort?: AgentEffort | null;
  },
  owner: Owner = userOwner(user.id),
): Promise<{ settings: AgentSettings; applied: number; failed: number }> {
  const step = { loginId: input.loginId, code: input.code };
  const dedicated = hasLoginContainer(env);
  const result = dedicated
    ? await callLoginContainer(env, owner, RUNNER_PATHS.claudeLoginFinish, step)
    : await callRuntime(
        db,
        env,
        user,
        await startedRuntime(db, owner, input.projectId),
        RUNNER_PATHS.claudeLoginFinish,
        step,
      );
  const parsed = claudeLoginFinishResultSchema.safeParse(result);
  if (!parsed.success) throw new HttpError(502, 'The sign-in returned an unexpected token.', { code: 'runtime_error' });
  const saved = await saveAgentSettings(
    db,
    env,
    owner,
    { provider: 'subscription', apiKey: parsed.data.token, model: input.model ?? null, effort: input.effort ?? null },
    user.id,
  );
  await audit(db, {
    actorUserId: user.id,
    actor: `user:${user.id}`,
    action: 'agent.subscription.connect',
    target: ownerTarget(owner),
    metadata: dedicated ? { via: 'claude-login' } : { projectId: input.projectId },
  });
  return saved;
}

/** Ends a sign-in the user gave up on, so another one can start. */
export async function cancelSubscriptionLogin(
  db: Db,
  env: Env,
  user: User,
  input: { projectId?: string | null; loginId: string },
  owner: Owner = userOwner(user.id),
): Promise<void> {
  const step = { loginId: input.loginId };
  if (hasLoginContainer(env)) {
    await callLoginContainer(env, owner, RUNNER_PATHS.claudeLoginCancel, step);
    return;
  }
  const target = await startedRuntime(db, owner, input.projectId);
  await callRuntime(db, env, user, target, RUNNER_PATHS.claudeLoginCancel, step);
}
