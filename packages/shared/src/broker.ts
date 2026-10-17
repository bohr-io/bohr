import { z } from 'zod';

// Calls the project Worker makes to the instance, mainly to get short-lived GitHub tokens for its
// repository. The instance keeps the GitHub App key; the project Worker holds a per-project secret
// shared at provisioning and signs every call with it.

export const BROKER_PREFIX = '/api/runtime/v1';
export const BROKER_HEADERS = {
  project: 'Bohr-Project',
  timestamp: 'Bohr-Timestamp',
  signature: 'Bohr-Signature',
} as const;
/** Signatures older or newer than this are refused. */
export const BROKER_MAX_SKEW_SECONDS = 300;

export const githubTokenRequestSchema = z.object({
  /**
   * "sandbox" is what the container's git traffic gets: contents only, so GitHub refuses any change to
   * workflows. "worker" stays in the project Worker: pull requests, merges, the deploy workflow, workflow runs.
   */
  scope: z.enum(['sandbox', 'worker']),
});
export const githubTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
  repository: z.string(),
});
export type GithubTokenResponse = z.infer<typeof githubTokenResponseSchema>;

/** Tells the instance who joined or left, so the web lists the project for its members. */
export const memberChangeSchema = z.object({
  action: z.enum(['joined', 'removed']),
  memberKey: z.string().regex(/^(tg|u):[A-Za-z0-9_-]{1,64}$/),
  name: z.string().min(1).max(200),
});
export type MemberChange = z.infer<typeof memberChangeSchema>;

const memberKeyPattern = /^(tg|u):[A-Za-z0-9_-]{1,64}$/;

/** Every member key of the person behind one key (a Telegram account linked to an instance user, or not). */
export const identityRequestSchema = z.object({ memberKey: z.string().regex(memberKeyPattern) });
export const identityResponseSchema = z.object({ keys: z.array(z.string().regex(memberKeyPattern)).min(1).max(5) });

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(body: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function signingInput(method: string, path: string, timestamp: string, body: string) {
  return `v1\n${timestamp}\n${method.toUpperCase()}\n${path}\n${await sha256Hex(body)}`;
}

export type SignedRequestParts = { method: string; path: string; body: string };

/** Headers that authenticate one broker call. `path` includes the query string. */
export async function signBrokerRequest(
  projectId: string,
  secret: string,
  { method, path, body }: SignedRequestParts,
  now = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(now / 1000));
  const key = await hmacKey(secret, 'sign');
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(await signingInput(method, path, timestamp, body)));
  return {
    [BROKER_HEADERS.project]: projectId,
    [BROKER_HEADERS.timestamp]: timestamp,
    [BROKER_HEADERS.signature]: `v1=${hex(mac)}`,
  };
}

/** Checks a broker call against the project's secret. Constant-time on the MAC. */
export async function verifyBrokerRequest(
  secret: string,
  headers: { get(name: string): string | null },
  { method, path, body }: SignedRequestParts,
  now = Date.now(),
): Promise<boolean> {
  const timestamp = headers.get(BROKER_HEADERS.timestamp);
  const signature = headers.get(BROKER_HEADERS.signature);
  if (timestamp === null || signature === null || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > BROKER_MAX_SKEW_SECONDS) return false;
  const match = /^v1=([0-9a-f]{64})$/.exec(signature);
  if (match?.[1] === undefined) return false;
  const mac = new Uint8Array(match[1].match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  const key = await hmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, mac, encoder.encode(await signingInput(method, path, timestamp, body)));
}
