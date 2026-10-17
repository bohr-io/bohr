const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const encoder = new TextEncoder();

// Random lowercase alphanumeric id with an optional prefix (rejection sampling keeps it uniform)
export function randomId(prefix: string, length: number) {
  let id = '';
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 252 && id.length < length) id += ALPHABET[byte % 36];
    }
  }
  return prefix + id;
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison; hashing first gives equal-length inputs
export async function safeEqual(a: string, b: string) {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(hashA, hashB);
}

async function importKey(keyBase64: string) {
  const raw = fromBase64(keyBase64);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// "v1.<iv>.<ciphertext>", AES-256-GCM; the additional data binds a value to where it is stored
export async function encryptValue(keyBase64: string, plaintext: string, additionalData: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(additionalData) },
    await importKey(keyBase64),
    encoder.encode(plaintext),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptValue(keyBase64: string, stored: string, additionalData: string) {
  const [version, iv, ciphertext] = stored.split('.');
  if (version !== 'v1' || iv === undefined || ciphertext === undefined) throw new Error('Unknown ciphertext format.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(additionalData) },
    await importKey(keyBase64),
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
