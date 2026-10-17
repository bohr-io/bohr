import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { DEFAULT_LOCALE, getLocale, type LocaleCode, localePath, type PageName } from '../i18n/locales';

/** Locale and page of the current route, plus localized paths. */
export function useSiteLocale() {
  const route = useRoute();
  const code = computed<LocaleCode>(() => route.meta.locale ?? DEFAULT_LOCALE);
  const locale = computed(() => getLocale(code.value));
  const page = computed<PageName>(() => route.meta.page ?? 'home');

  const pathFor = (target: PageName, localeCode: LocaleCode = code.value) => localePath(localeCode, target);

  return { code, locale, page, pathFor };
}
