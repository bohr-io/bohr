import {
  BROKER_PREFIX,
  githubTokenResponseSchema,
  identityResponseSchema,
  type MemberChange,
  signBrokerRequest,
} from '@bohr/shared';
import type { Env } from './env';

export type TokenScope = 'sandbox' | 'worker';

// Tokens are reused until five minutes before they expire. The cache lives per isolate, which is
// enough: installation tokens last an hour and asking for a new one is cheap.
const cache = new Map<string, { token: string; expiresAt: number }>();
const MARGIN_MS = 5 * 60_000;

/** A short-lived GitHub token for this project's repository, from the instance that holds the App key. */
export async function githubToken(
  env: Env,
  scope: TokenScope,
  fetchFn: typeof fetch,
  now = Date.now(),
): Promise<string> {
  const key = `${env.PROJECT_ID}:${scope}`;
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt - MARGIN_MS > now) return cached.token;

  const path = `${BROKER_PREFIX}/github-token`;
  const body = JSON.stringify({ scope });
  const headers = await signBrokerRequest(env.PROJECT_ID, env.PROJECT_SECRET, { method: 'POST', path, body }, now);
  const response = await fetchFn(new URL(path, env.INSTANCE_URL), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) throw new Error(`The bohr instance refused a GitHub token (${response.status}).`);
  const { token, expiresAt } = githubTokenResponseSchema.parse(await response.json());
  cache.set(key, { token, expiresAt: Date.parse(expiresAt) });
  return token;
}

export function clearTokenCache(): void {
  cache.clear();
}

/** Other member keys of the person behind `memberKey`, from the instance; just the key itself when it is unreachable. */
export async function memberAliases(env: Env, memberKey: string, fetchFn: typeof fetch): Promise<string[]> {
  const path = `${BROKER_PREFIX}/identity`;
  const body = JSON.stringify({ memberKey });
  const headers = await signBrokerRequest(env.PROJECT_ID, env.PROJECT_SECRET, { method: 'POST', path, body });
  try {
    const response = await fetchFn(new URL(path, env.INSTANCE_URL), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) return [memberKey];
    return identityResponseSchema.parse(await response.json()).keys;
  } catch {
    return [memberKey];
  }
}

/** Best effort: the project Worker stays the source of truth for access. */
export async function reportMemberChange(env: Env, change: MemberChange, fetchFn: typeof fetch): Promise<void> {
  const path = `${BROKER_PREFIX}/members`;
  const body = JSON.stringify(change);
  const headers = await signBrokerRequest(env.PROJECT_ID, env.PROJECT_SECRET, { method: 'POST', path, body });
  try {
    const response = await fetchFn(new URL(path, env.INSTANCE_URL), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) console.error(`[broker] Member change refused (${response.status}).`);
  } catch (error) {
    console.error('[broker] Member change failed:', error instanceof Error ? error.message : error);
  }
}
