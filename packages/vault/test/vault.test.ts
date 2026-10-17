import { describe, expect, it } from 'vitest';
import { generateMasterKey, parseMasterKeys, Vault, VaultError } from '../src/index';

const k1 = generateMasterKey();
const k2 = generateMasterKey();

async function legacySeal(keyBase64: string, plaintext: string, context: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(keyBase64), (char) => char.charCodeAt(0)),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}

describe('Vault', () => {
  it('seals with a fresh data key per value and opens with the same context only', async () => {
    const vault = new Vault({ current: { id: 'k1', key: k1 } });
    const first = await vault.seal('cf-token-123', 'cf_connection:c1');
    const second = await vault.seal('cf-token-123', 'cf_connection:c1');
    expect(first).toMatch(/^v2\.k1\.[\w-]+~[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('cf-token-123');
    expect(await vault.open(first, 'cf_connection:c1')).toBe('cf-token-123');
    await expect(vault.open(first, 'cf_connection:c2')).rejects.toBeInstanceOf(VaultError);
  });

  it('detects tampering', async () => {
    const vault = new Vault({ current: { id: 'k1', key: k1 } });
    const sealed = await vault.seal('secret', 'ctx');
    const parts = sealed.split('.');
    parts[4] = `${parts[4]?.slice(0, -2)}AA`;
    await expect(vault.open(parts.join('.'), 'ctx')).rejects.toThrow(/could not be decrypted/);
    await expect(vault.open('nonsense', 'ctx')).rejects.toThrow(/Unknown ciphertext format/);
  });

  it('rotates: old values open with the previous key and rewrap under the new one', async () => {
    const before = new Vault({ current: { id: 'k1', key: k1 } });
    const sealed = await before.seal('github-app-pem', 'settings:github_app');

    const after = new Vault(parseMasterKeys(`k2:${k2},k1:${k1}`));
    expect(after.currentKeyId).toBe('k2');
    expect(after.needsRewrap(sealed)).toBe(true);
    expect(await after.open(sealed, 'settings:github_app')).toBe('github-app-pem');
    const rewrapped = await after.rewrap(sealed, 'settings:github_app');
    expect(rewrapped.startsWith('v2.k2.')).toBe(true);
    expect(after.needsRewrap(rewrapped)).toBe(false);
    expect(await after.rewrap(rewrapped, 'settings:github_app')).toBe(rewrapped);

    const withoutOld = new Vault({ current: { id: 'k2', key: k2 } });
    await expect(withoutOld.open(sealed, 'settings:github_app')).rejects.toThrow(/"k1" is not configured/);
    expect(await withoutOld.open(rewrapped, 'settings:github_app')).toBe('github-app-pem');
  });

  it('reads v1 values sealed straight under the master key', async () => {
    const vault = new Vault(parseMasterKeys(k1));
    const legacy = await legacySeal(k1, 'runtime-secret', 'runtime_secret:p1:main:API_KEY');
    expect(await vault.open(legacy, 'runtime_secret:p1:main:API_KEY')).toBe('runtime-secret');
    expect(vault.needsRewrap(legacy)).toBe(true);

    const rotated = new Vault(parseMasterKeys(`k2:${k2},k1:${k1}`));
    expect(await rotated.open(legacy, 'runtime_secret:p1:main:API_KEY')).toBe('runtime-secret');
    await expect(new Vault(parseMasterKeys(k2)).open(legacy, 'runtime_secret:p1:main:API_KEY')).rejects.toThrow(
      VaultError,
    );
  });

  it('validates its configuration', () => {
    expect(() => new Vault({ current: { id: 'bad id', key: k1 } })).toThrow(VaultError);
    expect(() => new Vault({ current: { id: 'k1', key: btoa('short') } })).toThrow(/32 bytes/);
    expect(() => new Vault({ current: { id: 'k1', key: k1 }, previous: [{ id: 'k1', key: k2 }] })).toThrow(/Duplicate/);
    expect(() => parseMasterKeys(' , ')).toThrow(/No master key/);
  });
});
