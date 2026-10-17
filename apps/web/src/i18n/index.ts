import { createI18n } from 'vue-i18n';
import { setRequestLocale } from '../api';
import en from '../locales/en.json';
import es from '../locales/es.json';
import ptBR from '../locales/pt-BR.json';
import { DEFAULT_LOCALE, type LocaleCode, storeLocale } from './locales';

/** pt-BR is the source copy; the other locales must have the same shape. */
export type MessageSchema = typeof ptBR;

export const messages: Record<LocaleCode, MessageSchema> = {
  'pt-BR': ptBR,
  en,
  es,
};

export function createWebI18n(locale: LocaleCode = DEFAULT_LOCALE) {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: DEFAULT_LOCALE,
    messages,
  });
  applyLocale(locale);
  return i18n;
}

export type WebI18n = ReturnType<typeof createWebI18n>;

/** Side effects of a language: <html lang> and the Accept-Language the API calls send. */
function applyLocale(code: LocaleCode): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  setRequestLocale(code);
}

/** Switches the interface language (the `locale` of useI18n or i18n.global) and remembers the choice. */
export function changeLocale(composer: { locale: { value: string } }, code: LocaleCode): void {
  composer.locale.value = code;
  applyLocale(code);
  storeLocale(code);
}
