import type { Env } from '../env';
import { HttpError } from './http';

const CLOUD_KEYS = [
  'ROUTES',
  'BUNDLES',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'DISPATCH_NAMESPACE',
  'DISPATCHER_SCRIPT',
  'LEGACY_EDGE_SCRIPT',
  'BOHR_DOMAIN',
  'BOHR_ZONE_ID',
] as const;

export type CloudEnv = Env & Required<Pick<Env, (typeof CLOUD_KEYS)[number]>>;

export function hasCloud(env: Env): env is CloudEnv {
  return CLOUD_KEYS.every((key) => Boolean(env[key]));
}

/** Managed hosting (bohr.io Cloud) settings; self-hosted instances leave them unset. */
export function cloudEnv(env: Env): CloudEnv {
  if (!hasCloud(env)) throw new HttpError(501, 'Managed hosting is not configured on this instance.');
  return env;
}
