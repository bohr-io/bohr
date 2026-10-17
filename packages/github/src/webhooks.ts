import { hexToBytes, utf8 } from './encoding';

/**
 * Checks the X-Hub-Signature-256 header (`sha256=<hex HMAC-SHA256>`) against the raw request body, exactly as
 * received (read it with `request.text()` before parsing). An empty secret never verifies.
 */
export async function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (signatureHeader === null || secret === '') return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (match?.[1] === undefined) return false;
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // verify compares the MAC in constant time
  return crypto.subtle.verify('HMAC', key, hexToBytes(match[1]), utf8(body));
}
