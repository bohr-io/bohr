// The agent's model provider, set once per user in the panel's general settings and applied to every
// project they own. The Anthropic API with an API key; any endpoint compatible with the Anthropic Messages API
// (OpenRouter, DeepSeek, Kimi, GLM, a LiteLLM proxy in front of other providers...), with its base URL and
// key; or the user's Claude subscription (Pro/Max), used through the official Claude Code CLI with the
// long-lived token `claude setup-token` creates. The key or token is stored sealed and goes to each project
// Worker as a secret; the container only ever sees a placeholder (the Gateway adds the real one).
import { deleteAccountScriptSecret, putAccountScriptSecret } from '@bohr/cloudflare';
import { AGENT_EFFORTS, type AgentEffort, CLAUDE_OAUTH_TOKEN_PATTERN } from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects, runtimes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { badRequest } from '../lib/http';
import { type Owner, ownerTarget, projectOwner, projectsOf, userOwner } from '../lib/owner';
import { audit } from './audit';
import { accountClient, startImport } from './provision';
import { deleteSetting, readSealedSetting, writeSealedSetting } from './settings';

/** "subscription": the user's Claude Pro/Max subscription; the token goes in `apiKey`. */
export type AgentProvider = 'anthropic' | 'compatible' | 'subscription';

export type AgentSettings = {
  provider: AgentProvider;
  apiKey: string;
  /** Compatible endpoints only: the API's base URL (the part before /v1/messages). */
  baseUrl: string | null;
  /** null: bohr's default model (claude-opus-5-5 on Anthropic). */
  model: string | null;
  /** null: the model's default effort. */
  effort: AgentEffort | null;
};

export type AgentSettingsView = {
  configured: boolean;
  provider: AgentProvider | null;
  baseUrl: string | null;
  model: string | null;
  effort: AgentEffort | null;
  /** The key's last characters, to recognize it. */
  keyHint: string | null;
};

export type AgentSettingsInput = {
  provider: AgentProvider;
  /** Omitted: keep the stored key (changing only the model or effort). */
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  effort?: AgentEffort | null;
};

const asOwner = (owner: string | Owner): Owner => (typeof owner === 'string' ? userOwner(owner) : owner);
/** agent:<userId> for a person, agent:org:<orgId> for an organization. */
export const settingKey = (owner: Owner) => (owner.kind === 'org' ? `agent:org:${owner.id}` : `agent:${owner.id}`);
/** The project Worker's secrets these settings become. */
export const AGENT_SECRETS = [
  'ANTHROPIC_API_KEY',
  'AGENT_BASE_URL',
  'AGENT_MODEL',
  'AGENT_EFFORT',
  'AGENT_PROVIDER',
] as const;

/** The settings of a user (their personal projects) or of an organization (its projects). */
export async function agentSettings(db: Db, env: Env, owner: string | Owner): Promise<AgentSettings | null> {
  return readSealedSetting<AgentSettings>(db, env, settingKey(asOwner(owner)));
}

export function agentSettingsView(settings: AgentSettings | null): AgentSettingsView {
  return {
    configured: settings !== null,
    provider: settings?.provider ?? null,
    baseUrl: settings?.baseUrl ?? null,
    model: settings?.model ?? null,
    effort: settings?.effort ?? null,
    keyHint: settings ? `…${settings.apiKey.slice(-4)}` : null,
  };
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest('The base URL is not a URL.');
  }
  if (url.protocol !== 'https:') throw badRequest('The base URL must use https.');
  if (url.search || url.hash) throw badRequest('The base URL cannot have a query or a fragment.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
}

/** Asks the provider whether it accepts the key (models list), the way the agent will authenticate. */
async function checkKey(baseUrl: string, apiKey: string): Promise<void> {
  const response = await deps
    .fetch(`${baseUrl}/v1/models?limit=1`, {
      headers: { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
    })
    .catch(() => null);
  if (response === null) throw badRequest(`Could not reach ${baseUrl}.`);
  if (response.status === 401 || response.status === 403) throw badRequest('The provider did not accept this key.');
}

export async function saveAgentSettings(
  db: Db,
  env: Env,
  ownerOrUserId: string | Owner,
  input: AgentSettingsInput,
  /** Who made the change; defaults to the user whose settings these are. */
  actorUserId?: string,
): Promise<{ settings: AgentSettings; applied: number; failed: number }> {
  const owner = asOwner(ownerOrUserId);
  const actor = actorUserId ?? owner.id;
  const previous = await agentSettings(db, env, owner);
  const apiKey = input.apiKey?.trim() || (previous?.provider === input.provider ? previous.apiKey : '');
  if (apiKey === '') throw badRequest(input.provider === 'subscription' ? 'Enter the token.' : 'Enter the API key.');
  if (input.provider === 'anthropic' && CLAUDE_OAUTH_TOKEN_PATTERN.test(apiKey)) {
    throw badRequest('That is a Claude subscription token; choose the Claude subscription instead.');
  }
  if (input.provider === 'anthropic' && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
    throw badRequest('That does not look like an Anthropic API key (sk-ant-…).');
  }
  // Only the format: the token works with the official CLI, and nothing checks it without spending it
  if (input.provider === 'subscription' && !CLAUDE_OAUTH_TOKEN_PATTERN.test(apiKey)) {
    throw badRequest('That does not look like a token from claude setup-token (sk-ant-oat01-…).');
  }
  const baseUrl = input.provider === 'compatible' ? normalizeBaseUrl(input.baseUrl ?? '') : null;
  const model = input.model?.trim() || null;
  if (input.provider === 'compatible' && model === null) throw badRequest('Compatible providers need a model name.');
  if (input.effort != null && !AGENT_EFFORTS.includes(input.effort)) throw badRequest('Unknown effort level.');
  if (input.provider !== 'subscription' && (apiKey !== previous?.apiKey || baseUrl !== (previous?.baseUrl ?? null))) {
    await checkKey(baseUrl ?? 'https://api.anthropic.com', apiKey);
  }
  const settings: AgentSettings = { provider: input.provider, apiKey, baseUrl, model, effort: input.effort ?? null };
  await writeSealedSetting(db, env, settingKey(owner), settings);
  await audit(db, {
    actorUserId: actor,
    actor: `user:${actor}`,
    action: 'agent.settings',
    target: ownerTarget(owner),
    metadata: { provider: settings.provider, baseUrl, model, effort: settings.effort },
  });
  const { applied, failed } = await applyToOwnedProjects(db, env, owner, settings);
  return { settings, applied, failed };
}

export async function removeAgentSettings(
  db: Db,
  env: Env,
  ownerOrUserId: string | Owner,
  actorUserId?: string,
): Promise<void> {
  const owner = asOwner(ownerOrUserId);
  const actor = actorUserId ?? owner.id;
  await deleteSetting(db, settingKey(owner));
  await applyToOwnedProjects(db, env, owner, null);
  await audit(db, {
    actorUserId: actor,
    actor: `user:${actor}`,
    action: 'agent.settings.remove',
    target: ownerTarget(owner),
  });
}

/** Writes the settings into a project Worker's secrets (or removes them). */
async function applyToRuntime(db: Db, env: Env, runtime: typeof runtimes.$inferSelect, settings: AgentSettings | null) {
  const cf = await accountClient(db, env, runtime.cfConnectionId, runtime.accountId);
  const values: Record<(typeof AGENT_SECRETS)[number], string | null> = {
    ANTHROPIC_API_KEY: settings?.apiKey ?? null,
    AGENT_BASE_URL: settings?.baseUrl ?? null,
    AGENT_MODEL: settings?.model ?? null,
    AGENT_EFFORT: settings?.effort ?? null,
    // Written for every provider, so the Worker knows how to use the key
    AGENT_PROVIDER: settings?.provider ?? null,
  };
  for (const name of AGENT_SECRETS) {
    const value = values[name];
    if (value === null) await deleteAccountScriptSecret(cf, runtime.accountId, runtime.script, name);
    else await putAccountScriptSecret(cf, runtime.accountId, runtime.script, name, value);
  }
}

/** A user's settings reach their personal projects; an organization's, the org's projects. */
async function applyToOwnedProjects(db: Db, env: Env, owner: Owner, settings: AgentSettings | null) {
  const rows = await db
    .select({ runtime: runtimes })
    .from(projects)
    .innerJoin(runtimes, eq(runtimes.projectId, projects.id))
    .where(and(projectsOf(owner), eq(runtimes.status, 'ready')))
    .all();
  let applied = 0;
  let failed = 0;
  for (const { runtime } of rows) {
    try {
      await applyToRuntime(db, env, runtime, settings);
      // Projects created before the agent was set up: it prepares their repositories now
      if (settings !== null && runtime.importStartedAt === null) await startImport(db, env, runtime.projectId);
      applied++;
    } catch (error) {
      failed++;
      console.error('[agent] could not update', runtime.script, error);
    }
  }
  return { applied, failed };
}

/**
 * After a project's runtime is ready: gives it the agent settings of its owner (the organization's for an org
 * project, else its creator's) and asks the agent to prepare the repository (once). Returns false when the
 * owner has not set up the agent yet.
 */
export async function applyOwnerAgent(db: Db, env: Env, projectId: string): Promise<boolean> {
  const row = await db
    .select({ project: projects, runtime: runtimes })
    .from(projects)
    .innerJoin(runtimes, eq(runtimes.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .get();
  if (row === undefined) return false;
  const settings = await agentSettings(db, env, projectOwner(row.project));
  if (settings === null) return false;
  await applyToRuntime(db, env, row.runtime, settings);
  if (row.runtime.importStartedAt === null) await startImport(db, env, projectId);
  return true;
}
