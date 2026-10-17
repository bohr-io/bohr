import { z } from 'zod';

export const LOCALES = ['pt-BR', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

/** Maps a language tag (Telegram's `language_code`, `Accept-Language`) to a supported locale; English otherwise. */
export function normalizeLocale(tag: string | null | undefined, fallback: Locale = 'en'): Locale {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  if (language === 'pt') return 'pt-BR';
  if (language === 'es') return 'es';
  if (language === 'en') return 'en';
  return fallback;
}
