// Locale and page map. Kept free of Vue imports so vite.config.ts can use it too.

export const LOCALES = [
  { code: 'en-US', prefix: '', htmlLang: 'en', hreflang: 'en', ogLocale: 'en_US', name: 'English', short: 'EN' },
  {
    code: 'pt-BR',
    prefix: '/pt',
    htmlLang: 'pt-BR',
    hreflang: 'pt-BR',
    ogLocale: 'pt_BR',
    name: 'Português',
    short: 'PT',
  },
  { code: 'es-ES', prefix: '/es', htmlLang: 'es', hreflang: 'es', ogLocale: 'es_ES', name: 'Español', short: 'ES' },
] as const;

export type Locale = (typeof LOCALES)[number];
export type LocaleCode = Locale['code'];

export const DEFAULT_LOCALE: LocaleCode = 'en-US';

/** Page paths without the locale prefix. */
export const PAGES = {
  home: '/',
  migration: '/migration',
} as const;

export type PageName = keyof typeof PAGES;

export const PAGE_NAMES = Object.keys(PAGES) as PageName[];

export function getLocale(code: string | undefined): Locale {
  return LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];
}

/** "/", "/pt/", "/es/", "/migration", "/pt/migration", ... */
export function localePath(code: LocaleCode, page: PageName): string {
  const { prefix } = getLocale(code);
  const path = PAGES[page];
  return path === '/' ? `${prefix}/` : `${prefix}${path}`;
}

/** Every prerendered path. */
export const ALL_PATHS: string[] = LOCALES.flatMap((locale) => PAGE_NAMES.map((page) => localePath(locale.code, page)));
