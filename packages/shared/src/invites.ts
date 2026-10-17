// Invite codes: single use, short-lived, easy to type in Telegram ("/join K7P2-9QXM").

// Crockford base32: no I, L, O or U, so codes survive being read aloud or typed by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Canonical form of a typed code, or null when it cannot be one. */
export function normalizeInviteCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (cleaned.length !== CODE_LENGTH || [...cleaned].some((char) => !ALPHABET.includes(char))) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/** Codes are stored hashed, so a leaked database row cannot be redeemed. */
export async function hashInviteCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
