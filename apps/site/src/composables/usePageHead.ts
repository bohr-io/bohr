import { useHead } from '@unhead/vue';
import { useI18n } from 'vue-i18n';
import { SITE_URL } from '../config';
import { DEFAULT_LOCALE, LOCALES, localePath, type PageName } from '../i18n/locales';
import { useSiteLocale } from './useSiteLocale';

/** Localized title, description, canonical URL and hreflang alternates for a page. */
export function usePageHead(page: PageName) {
  const { t } = useI18n();
  const { code, locale } = useSiteLocale();

  useHead(() => {
    const url = `${SITE_URL}${localePath(code.value, page)}`;
    const title = t(`meta.${page}.title`);
    const description = t(`meta.${page}.description`);

    return {
      htmlAttrs: { lang: locale.value.htmlLang },
      title,
      meta: [
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: url },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'bohr.io' },
        { property: 'og:image', content: `${SITE_URL}/og-image.jpg` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:locale', content: locale.value.ogLocale },
        ...LOCALES.filter((other) => other.code !== code.value).map((other) => ({
          property: 'og:locale:alternate',
          content: other.ogLocale,
        })),
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'canonical', href: url },
        ...LOCALES.map((other) => ({
          rel: 'alternate',
          hreflang: other.hreflang,
          href: `${SITE_URL}${localePath(other.code, page)}`,
        })),
        { rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}${localePath(DEFAULT_LOCALE, page)}` },
      ],
    };
  });
}
