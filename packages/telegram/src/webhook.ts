import { type TelegramUpdate, updateSchema } from './types';

export const SECRET_TOKEN_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** A webhook secret_token: Telegram accepts 1-256 characters from A-Z, a-z, 0-9, _ and -. */
export function newWebhookSecret(length = 48): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => SECRET_ALPHABET[byte % SECRET_ALPHABET.length]).join('');
}

/** Constant-time check of the secret Telegram sends with every webhook call. */
export function verifyWebhookSecret(received: string | null, expected: string): boolean {
  if (received === null || expected.length === 0) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

/** Reads a webhook request: null when the secret is wrong or the body is not an update. */
export async function readWebhookUpdate(request: Request, secret: string): Promise<TelegramUpdate | null> {
  if (request.method !== 'POST' || !verifyWebhookSecret(request.headers.get(SECRET_TOKEN_HEADER), secret)) {
    return null;
  }
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
