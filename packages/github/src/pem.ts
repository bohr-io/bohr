import { base64ToBytes, concatBytes } from './encoding';

// PrivateKeyInfo fields around the RSA key: version 0, and AlgorithmIdentifier
// rsaEncryption (OID 1.2.840.113549.1.1.1) with NULL parameters
const VERSION_0 = [0x02, 0x01, 0x00];
const RSA_ENCRYPTION = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
const SEQUENCE = 0x30;
const OCTET_STRING = 0x04;

const PEM_PRIVATE_KEY = /-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

/** DER length octets: short form below 128, otherwise 0x80 | byte count followed by the length, big-endian. */
export function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 0x100)) bytes.unshift(rest % 0x100);
  return [0x80 | bytes.length, ...bytes];
}

function derElement(tag: number, content: ArrayLike<number>) {
  return concatBytes([tag, ...derLength(content.length)], content);
}

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo, the RSA private key format WebCrypto imports. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  return derElement(SEQUENCE, concatBytes(VERSION_0, RSA_ENCRYPTION, derElement(OCTET_STRING, pkcs1)));
}

/** PKCS#8 DER of a PEM private key in PKCS#1 ("BEGIN RSA PRIVATE KEY", what GitHub issues) or PKCS#8 form. */
export function privateKeyPemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  // Keys pasted into environment variables often carry literal "\n" escapes
  const match = PEM_PRIVATE_KEY.exec(pem.replace(/\\n/g, '\n'));
  if (match === null) {
    throw new Error('Expected an unencrypted PEM private key ("BEGIN RSA PRIVATE KEY" or "BEGIN PRIVATE KEY")');
  }
  const [, label, body = ''] = match;
  // Encrypted PKCS#1 PEM carries "Proc-Type:" and "DEK-Info:" headers
  if (body.includes(':')) throw new Error('Encrypted PEM private keys are not supported');
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = base64ToBytes(body.replace(/\s+/g, ''));
  } catch {
    throw new Error('The PEM private key is not valid base64');
  }
  return label === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(der) : der;
}
