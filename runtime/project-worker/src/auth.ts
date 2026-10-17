import { normalizeLocale, ROLES, type Role, runtimeAudience } from '@bohr/shared';
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from 'jose';
import type { Env } from './env';

/**
 * `grant`: the role the instance vouches for when the caller's access comes from an organization (org admins
 * are owners, org members are members), so org members need no invite code.
 */
export type Caller = { key: string; name: string; locale: string | undefined; aliases: string[]; grant?: Role };

const MEMBER_KEY = /^(tg|u):[A-Za-z0-9_-]{1,64}$/;

let cachedJwks: { source: string; keys: ReturnType<typeof createLocalJWKSet> } | null = null;

function keySet(env: Env) {
  if (cachedJwks?.source !== env.INSTANCE_JWKS) {
    cachedJwks = { source: env.INSTANCE_JWKS, keys: createLocalJWKSet(JSON.parse(env.INSTANCE_JWKS) as JSONWebKeySet) };
  }
  return cachedJwks.keys;
}

/** The member the instance vouches for in `Authorization: Bearer <jwt>`, or null. */
export async function verifyInstanceToken(env: Env, authorization: string | null): Promise<Caller | null> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
  if (token === undefined) return null;
  try {
    const { payload } = await jwtVerify(token, keySet(env), {
      issuer: env.INSTANCE_URL,
      audience: runtimeAudience(env.PROJECT_ID),
      algorithms: ['ES256'],
      maxTokenAge: '10m',
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string' || !MEMBER_KEY.test(payload.sub)) return null;
    const name = typeof payload.name === 'string' && payload.name.length > 0 ? payload.name.slice(0, 200) : payload.sub;
    const locale = typeof payload.locale === 'string' ? normalizeLocale(payload.locale) : undefined;
    const aliases = Array.isArray(payload.aliases)
      ? payload.aliases
          .filter((alias): alias is string => typeof alias === 'string' && MEMBER_KEY.test(alias))
          .slice(0, 5)
      : [];
    const grant = ROLES.find((role) => role === payload.grant);
    return { key: payload.sub, name, locale, aliases, ...(grant ? { grant } : {}) };
  } catch {
    return null;
  }
}
