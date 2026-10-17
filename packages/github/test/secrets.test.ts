import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { sealSecret } from '../src';

beforeAll(async () => {
  await sodium.ready;
});

function newRecipient() {
  const keys = sodium.crypto_box_keypair();
  return { ...keys, publicKeyBase64: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL) };
}

describe('sealSecret', () => {
  it.each([
    ['an empty value', ''],
    ['a token', 'bohr_s3cr3t-token'],
    ['non-ASCII text', 'pässwörd ✓ 🔑'],
    ['a 48 KB value, the largest GitHub accepts', 'x'.repeat(48 * 1024)],
  ])('produces a sealed box libsodium opens: %s', (_label, value) => {
    const recipient = newRecipient();

    const sealed = sodium.from_base64(sealSecret(recipient.publicKeyBase64, value), sodium.base64_variants.ORIGINAL);
    const opened = sodium.crypto_box_seal_open(sealed, recipient.publicKey, recipient.privateKey);

    expect(sodium.to_string(opened)).toBe(value);
    // ephemeral public key (32) + Poly1305 tag (16)
    expect(sealed.length).toBe(new TextEncoder().encode(value).length + sodium.crypto_box_SEALBYTES);
  });

  it('uses a fresh ephemeral key for every call', () => {
    const recipient = newRecipient();

    const first = sealSecret(recipient.publicKeyBase64, 'same value');
    const second = sealSecret(recipient.publicKeyBase64, 'same value');

    expect(first).not.toBe(second);
    expect(first.slice(0, 43)).not.toBe(second.slice(0, 43));
  });

  it('cannot be opened with another key', () => {
    const recipient = newRecipient();
    const other = newRecipient();

    const sealed = sodium.from_base64(sealSecret(recipient.publicKeyBase64, 'value'), sodium.base64_variants.ORIGINAL);

    expect(() => sodium.crypto_box_seal_open(sealed, other.publicKey, other.privateKey)).toThrow();
  });

  it('refuses keys that are not 32 bytes of base64', () => {
    expect(() => sealSecret('', 'value')).toThrow('Expected a base64 X25519 public key');
    expect(() => sealSecret('not base64!', 'value')).toThrow('Expected a base64 X25519 public key');
    expect(() => sealSecret(Buffer.alloc(31).toString('base64'), 'value')).toThrow(
      'Expected a base64 X25519 public key',
    );
  });
});
