import { parseMasterKeys, Vault } from '@bohr/vault';

let cached: { source: string; vault: Vault } | null = null;

/**
 * The instance vault. ENCRYPTION_KEY holds the master keys: one base64 key, or "id:key,id:key"
 * with the current key first when rotating.
 */
export function vault(env: { ENCRYPTION_KEY: string }): Vault {
  if (cached?.source !== env.ENCRYPTION_KEY) {
    cached = { source: env.ENCRYPTION_KEY, vault: new Vault(parseMasterKeys(env.ENCRYPTION_KEY)) };
  }
  return cached.vault;
}
