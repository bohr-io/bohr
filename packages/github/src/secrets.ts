import { blake2b } from '@noble/hashes/blake2.js';
import nacl from 'tweetnacl';
import { base64ToBytes, bytesToBase64, concatBytes, utf8 } from './encoding';

/**
 * Encrypts a value for GitHub Actions secrets with libsodium's sealed box (crypto_box_seal), returned as base64.
 * A fresh X25519 key pair per call; nonce = BLAKE2b-24(ephemeral_pk || recipient_pk);
 * output = ephemeral_pk || crypto_box(value, nonce, recipient_pk, ephemeral_sk).
 */
export function sealSecret(publicKeyBase64: string, value: string): string {
  let recipient: Uint8Array;
  try {
    recipient = base64ToBytes(publicKeyBase64.trim());
  } catch {
    recipient = new Uint8Array(0);
  }
  if (recipient.length !== nacl.box.publicKeyLength) {
    throw new Error('Expected a base64 X25519 public key (32 bytes), as GitHub returns from secrets/public-key');
  }

  const ephemeralSecret = crypto.getRandomValues(new Uint8Array(nacl.box.secretKeyLength));
  const ephemeralPublic = nacl.scalarMult.base(ephemeralSecret);
  const nonce = blake2b(concatBytes(ephemeralPublic, recipient), { dkLen: nacl.box.nonceLength });
  const sealed = concatBytes(ephemeralPublic, nacl.box(utf8(value), nonce, recipient, ephemeralSecret));
  ephemeralSecret.fill(0);
  return bytesToBase64(sealed);
}
