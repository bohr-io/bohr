import { createI18n } from 'vue-i18n';
import enUS from '../locales/en-US.json';
import esES from '../locales/es-ES.json';
import ptBR from '../locales/pt-BR.json';
import { DEFAULT_LOCALE, type LocaleCode } from './locales';

/** pt-BR is the source copy; the other locales must have the same shape. */
export type MessageSchema = typeof ptBR;

export const messages: Record<LocaleCode, MessageSchema> = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-ES': esES,
};

/** One instance per app, so concurrent SSG renders never share a locale. */
export function createSiteI18n(locale: LocaleCode = DEFAULT_LOCALE) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: DEFAULT_LOCALE,
    messages,
  });
}

export type SiteI18n = ReturnType<typeof createSiteI18n>;
