// The interface languages. Same codes as the project runtime (@bohr/shared LOCALES), so a project's
// language setting and the interface share one list. Kept free of Vue imports.
import type { Locale } from '@bohr/shared';

export const LOCALES = [
  { code: 'pt-BR', name: 'Português' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
] as const satisfies readonly { code: Locale; name: string }[];

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: LocaleCode = 'pt-BR';

/** localStorage key of the language the user picked. */
export const LOCALE_STORAGE_KEY = 'bohr.locale';

export function isLocaleCode(value: unknown): value is LocaleCode {
  return LOCALES.some((locale) => locale.code === value);
}

/** Maps a language tag ("pt-PT", "es-419", "en_GB") to a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): LocaleCode | null {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  if (language === 'pt') return 'pt-BR';
  if (language === 'en') return 'en';
  if (language === 'es') return 'es';
  return null;
}

/** The first browser language we support, else pt-BR. */
export function detectLocale(languages: readonly string[]): LocaleCode {
  for (const tag of languages) {
    const match = matchLocale(tag);
    if (match !== null) return match;
  }
  return DEFAULT_LOCALE;
}

// Storage can be missing or throw (private windows, blocked site data); the choice is then per visit.

export function readStoredLocale(): LocaleCode | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocaleCode(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(code: LocaleCode): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // Not persisted; the language still applies to this visit.
  }
}

/** The stored choice, else the browser's languages, else pt-BR. */
export function initialLocale(): LocaleCode {
  const stored = readStoredLocale();
  if (stored !== null) return stored;
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  return detectLocale(languages.filter(Boolean));
}
