import { RUNTIME_TOKEN_TTL_SECONDS, runtimeAudience } from '@bohr/shared';
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from 'jose';
import type { Db } from '../db/client';
import type { Env } from '../env';
import { instanceUrl } from '../lib/app-url';
import { randomId } from '../lib/crypto';
import { insertSealedSettingIfAbsent, readSealedSetting } from './settings';

// The instance signs the calls its web interface makes to project Workers with an ES256 key.
// Project Workers receive the public half (INSTANCE_JWKS) when they are provisioned.

type SigningKey = { kid: string; privateJwk: JWK; publicJwk: JWK };

const SETTING = 'runtime_signing_key';
let cached: { key: SigningKey; privateKey: CryptoKey } | null = null;

async function signingKey(db: Db, env: Env): Promise<{ key: SigningKey; privateKey: CryptoKey }> {
  if (cached !== null) return cached;
  let key = await readSealedSetting<SigningKey>(db, env, SETTING);
  if (key === null) {
    const pair = await generateKeyPair('ES256', { extractable: true });
    const kid = randomId('rk_', 12);
    key = {
      kid,
      privateJwk: { ...(await exportJWK(pair.privateKey)), kid, alg: 'ES256' },
      publicJwk: { ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' },
    };
    // Another isolate may be doing the same: the first key stored wins for everyone
    key = await insertSealedSettingIfAbsent(db, env, SETTING, key);
  }
  cached = { key, privateKey: (await importJWK(key.privateJwk, 'ES256')) as CryptoKey };
  return cached;
}

export async function runtimeJwks(db: Db, env: Env): Promise<{ keys: JWK[] }> {
  return { keys: [(await signingKey(db, env)).key.publicJwk] };
}

/** A short-lived token that tells a project Worker who is calling. */
export async function signRuntimeToken(
  db: Db,
  env: Env,
  claims: {
    projectId: string;
    memberKey: string;
    name: string;
    locale?: string;
    aliases?: string[];
    /** The role the instance vouches for when access comes from an organization or the admin role. */
    grant?: 'owner' | 'member';
  },
): Promise<string> {
  const { key, privateKey } = await signingKey(db, env);
  const issuer = await instanceUrl(db, env);
  if (issuer === null) throw new Error('The instance URL is not known yet; finish /setup first.');
  return new SignJWT({
    name: claims.name,
    ...(claims.locale ? { locale: claims.locale } : {}),
    ...(claims.aliases?.length ? { aliases: claims.aliases } : {}),
    ...(claims.grant ? { grant: claims.grant } : {}),
  })
    .setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setIssuer(issuer)
    .setAudience(runtimeAudience(claims.projectId))
    .setSubject(claims.memberKey)
    .setIssuedAt()
    .setExpirationTime(`${RUNTIME_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export function resetRuntimeKeyCache(): void {
  cached = null;
}
