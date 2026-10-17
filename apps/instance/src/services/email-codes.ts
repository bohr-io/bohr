// One-time codes by email: six digits, stored as an HMAC bound to the address, valid for 10 minutes and
// 5 attempts, used once; a new code replaces the previous one. Sent through Cloudflare Email Service.
import { type Locale, normalizeLocale } from '@bohr/shared';
import { and, count, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { emailCodes } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { randomId, sha256Hex } from '../lib/crypto';
import { badRequest, HttpError, notFound } from '../lib/http';
import { normalizeEmail } from './users';

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const PER_EMAIL = 3;
const PER_IP = 10;

export type CodePurpose = 'signin' | 'link';

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => normalizeEmail(value));

export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code has 6 digits.');

export const emailEnabled = (env: Env) => env.EMAIL !== undefined;

/** Six uniform digits (rejection sampling over 32 random bits). */
export function generateCode(): string {
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  for (;;) {
    const [value = limit] = crypto.getRandomValues(new Uint32Array(1));
    if (value < limit) return String(value % 1_000_000).padStart(6, '0');
  }
}

const encoder = new TextEncoder();

/** HMAC-SHA256 keyed by the instance's secret, so a copy of the database cannot be used to try every code. */
async function hashCode(env: Env, purpose: CodePurpose, email: string, userId: string | null, code: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`email-code:${env.ENCRYPTION_KEY}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${purpose}\n${email}\n${userId ?? ''}\n${code}`),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The sender: EMAIL_FROM, or bohr <noreply@HOST> of the instance URL. */
export function senderAddress(env: Env, baseUrl: string): string {
  return env.EMAIL_FROM || `bohr <noreply@${new URL(baseUrl).hostname}>`;
}

/** The language for the email: the locale the page sent, else the browser's Accept-Language. */
export function emailLocale(locale: string | undefined, acceptLanguage: string | undefined): Locale {
  return normalizeLocale(locale ?? acceptLanguage?.split(',')[0]?.split(';')[0], 'en');
}

const MESSAGES: Record<Locale, { subject: string; intro: string; expiry: string }> = {
  en: {
    subject: '{code} is your bohr code',
    intro: 'Your bohr code is:',
    expiry: "It expires in 10 minutes. If you didn't ask for it, ignore this email.",
  },
  'pt-BR': {
    subject: '{code} é o seu código da bohr',
    intro: 'Seu código da bohr é:',
    expiry: 'Ele expira em 10 minutos. Se você não pediu, ignore este email.',
  },
  es: {
    subject: '{code} es tu código de bohr',
    intro: 'Tu código de bohr es:',
    expiry: 'Caduca en 10 minutos. Si no lo pediste, ignora este correo.',
  },
};

export function codeEmail(locale: Locale, code: string) {
  const messages = MESSAGES[locale];
  return {
    subject: messages.subject.replace('{code}', code),
    text: `${messages.intro}\n\n${code}\n\n${messages.expiry}\n`,
    html:
      `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;padding:24px">` +
      `<p style="margin:0 0 16px">${messages.intro}</p>` +
      `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace">${code}</p>` +
      `<p style="margin:0;color:#555;font-size:14px">${messages.expiry}</p>` +
      `</body></html>`,
  };
}

export type StartCodeInput = {
  email: string;
  purpose: CodePurpose;
  userId: string | null;
  redirect: string | null;
  ip: string | null;
  locale: Locale;
  baseUrl: string;
};

/** Creates and sends a code. 429 past 3 codes per address or 10 per IP in 15 minutes. */
export async function startEmailCode(db: Db, env: Env, input: StartCodeInput): Promise<void> {
  if (!emailEnabled(env)) throw notFound('Email sign-in is not enabled on this instance.');
  const since = new Date(Date.now() - WINDOW_MS);
  const ipHash = input.ip ? await sha256Hex(`ip:${input.ip}`) : null;
  const [byEmail, byIp] = await Promise.all([
    db
      .select({ total: count() })
      .from(emailCodes)
      .where(and(eq(emailCodes.email, input.email), gt(emailCodes.createdAt, since)))
      .get(),
    ipHash === null
      ? Promise.resolve({ total: 0 })
      : db
          .select({ total: count() })
          .from(emailCodes)
          .where(and(eq(emailCodes.ipHash, ipHash), gt(emailCodes.createdAt, since)))
          .get(),
  ]);
  if ((byEmail?.total ?? 0) >= PER_EMAIL || (byIp?.total ?? 0) >= PER_IP) {
    throw new HttpError(429, 'Too many codes requested. Wait a few minutes and try again.');
  }

  const code = generateCode();
  const now = new Date();
  await db.batch([
    // The previous codes for this address stop working
    db
      .update(emailCodes)
      .set({ consumedAt: now })
      .where(
        and(eq(emailCodes.email, input.email), eq(emailCodes.purpose, input.purpose), isNull(emailCodes.consumedAt)),
      ),
    db.insert(emailCodes).values({
      id: randomId('ec_', 16),
      email: input.email,
      purpose: input.purpose,
      userId: input.userId,
      codeHash: await hashCode(env, input.purpose, input.email, input.userId, code),
      redirect: input.redirect,
      ipHash,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    }),
  ]);

  const message = codeEmail(input.locale, code);
  try {
    await deps.sendEmail(env, { to: input.email, from: senderAddress(env, input.baseUrl), ...message });
  } catch (error) {
    console.error('[email] send failed:', error instanceof Error ? error.message : error);
    throw new HttpError(502, 'Could not send the email. Try again later.');
  }
}

/**
 * Checks a code: the latest unused one for the address (and user, when linking). Wrong: 400 with the
 * attempts left; expired, used, replaced or out of attempts: 410. Returns the row once, marked used.
 */
export async function verifyEmailCode(
  db: Db,
  env: Env,
  input: { email: string; code: string; purpose: CodePurpose; userId: string | null },
) {
  const row = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.email, input.email), eq(emailCodes.purpose, input.purpose)))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1)
    .get();
  const gone = () => new HttpError(410, 'This code expired. Ask for a new one.');
  if (row === undefined || row.consumedAt !== null || row.expiresAt.getTime() < Date.now()) throw gone();
  if ((row.userId ?? null) !== input.userId) throw gone();
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(410, 'Too many wrong attempts. Ask for a new code.');

  const expected = await hashCode(env, input.purpose, input.email, input.userId, input.code);
  const matches = crypto.subtle.timingSafeEqual(encoder.encode(expected), encoder.encode(row.codeHash));
  if (!matches) {
    const attempts = row.attempts + 1;
    await db.update(emailCodes).set({ attempts }).where(eq(emailCodes.id, row.id)).run();
    throw new HttpError(400, 'Wrong code.', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) });
  }
  // Single use, even when two requests race
  const used = await db
    .update(emailCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.consumedAt)))
    .returning({ id: emailCodes.id })
    .all();
  if (used.length === 0) throw gone();
  return row;
}

/** Codes older than a day (well past their expiry and the rate limit window). */
export async function purgeEmailCodes(db: Db, now = Date.now()): Promise<void> {
  await db
    .delete(emailCodes)
    .where(lt(emailCodes.createdAt, new Date(now - 24 * 60 * 60_000)))
    .run();
}

/** Validates the address, or 400. */
export function parseEmail(value: unknown): string {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Enter a valid email address.');
  return parsed.data;
}
