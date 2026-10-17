// Envelope encryption. Every value gets its own random AES-256-GCM data key; the data key is
// encrypted ("wrapped") with a master key. Rotating the master key only rewraps the small data
// keys, and the `context` (additional authenticated data) binds each value to where it is stored,
// so a ciphertext copied to another row does not decrypt.
//
// Format: "v2.<master key id>.<wrapped data key>.<iv>.<ciphertext>", base64url parts.
// "v1.<iv>.<ciphertext>" values (AES-GCM straight under the master key) are still read.

export type MasterKey = { id: string; key: string };
export type VaultKeys = { current: MasterKey; previous?: MasterKey[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4)), (char) =>
    char.charCodeAt(0),
  );
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** Parses "id:base64,id:base64" (first is current) or a single base64 key (id "k1"). */
export function parseMasterKeys(value: string): VaultKeys {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): MasterKey => {
      const separator = entry.indexOf(':');
      return separator === -1
        ? { id: 'k1', key: entry }
        : { id: entry.slice(0, separator), key: entry.slice(separator + 1) };
    });
  const [current, ...previous] = entries;
  if (current === undefined) throw new VaultError('No master key configured.');
  return { current, previous };
}

/** A new master key, base64 encoded, for configuration. */
export function generateMasterKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

export class Vault {
  readonly #keys = new Map<string, Promise<CryptoKey>>();
  readonly #current: MasterKey;

  constructor(keys: VaultKeys) {
    for (const key of [keys.current, ...(keys.previous ?? [])]) {
      if (!KEY_ID.test(key.id)) throw new VaultError(`Invalid master key id "${key.id}".`);
      if (this.#keys.has(key.id)) throw new VaultError(`Duplicate master key id "${key.id}".`);
      const raw = fromBase64(key.key);
      if (raw.length !== 32) throw new VaultError(`Master key "${key.id}" must be 32 bytes.`);
      this.#keys.set(key.id, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    }
    this.#current = keys.current;
  }

  get currentKeyId(): string {
    return this.#current.id;
  }

  async seal(plaintext: string, context: string): Promise<string> {
    const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const dataKey = await crypto.subtle.importKey('raw', dataKeyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
      dataKey,
      encoder.encode(plaintext),
    );
    const wrapped = await this.#wrap(this.#current.id, dataKeyBytes, context);
    dataKeyBytes.fill(0);
    return ['v2', this.#current.id, wrapped, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
  }

  async open(sealed: string, context: string): Promise<string> {
    const parts = sealed.split('.');
    try {
      if (parts[0] === 'v1' && parts.length === 3) {
        // v1 values do not name their key: try each configured key, current first.
        const [, iv = '', ciphertext = ''] = parts;
        for (const key of this.#keys.values()) {
          try {
            const plaintext = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(context) },
              await key,
              fromBase64(ciphertext),
            );
            return decoder.decode(plaintext);
          } catch {}
        }
        throw new VaultError('The value could not be decrypted (wrong key or context, or it was altered).');
      }
      if (parts[0] === 'v2' && parts.length === 5) {
        const [, keyId = '', wrapped = '', iv = '', ciphertext = ''] = parts;
        const dataKeyBytes = await this.#unwrap(keyId, wrapped, context);
        const dataKey = await crypto.subtle.importKey('raw', dataKeyBytes, 'AES-GCM', false, ['decrypt']);
        dataKeyBytes.fill(0);
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(context) },
          dataKey,
          fromBase64(ciphertext),
        );
        return decoder.decode(plaintext);
      }
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('The value could not be decrypted (wrong key or context, or it was altered).');
    }
    throw new VaultError('Unknown ciphertext format.');
  }

  /** True when the value is not sealed with the current master key and should be rewrapped. */
  needsRewrap(sealed: string): boolean {
    const [version, keyId] = sealed.split('.');
    return version !== 'v2' || keyId !== this.#current.id;
  }

  /** Re-seals a value under the current master key (rotation). */
  async rewrap(sealed: string, context: string): Promise<string> {
    return this.needsRewrap(sealed) ? this.seal(await this.open(sealed, context), context) : sealed;
  }

  #key(id: string): Promise<CryptoKey> {
    const key = this.#keys.get(id);
    if (key === undefined) throw new VaultError(`Master key "${id}" is not configured.`);
    return key;
  }

  async #wrap(keyId: string, dataKey: Uint8Array<ArrayBuffer>, context: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(`bohr-vault-key:${context}`) },
      await this.#key(keyId),
      dataKey,
    );
    return `${toBase64Url(iv)}~${toBase64Url(new Uint8Array(wrapped))}`;
  }

  async #unwrap(keyId: string, wrapped: string, context: string): Promise<Uint8Array<ArrayBuffer>> {
    const [iv, ciphertext] = wrapped.split('~');
    if (iv === undefined || ciphertext === undefined) throw new VaultError('Malformed data key.');
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(`bohr-vault-key:${context}`) },
      await this.#key(keyId),
      fromBase64(ciphertext),
    );
    return new Uint8Array(raw);
  }
}
