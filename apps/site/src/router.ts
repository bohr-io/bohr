import type { RouteRecordRaw, RouterScrollBehavior } from 'vue-router';
import { DEFAULT_LOCALE, LOCALES, type LocaleCode, localePath, PAGE_NAMES, type PageName } from './i18n/locales';
import HomePage from './pages/HomePage.vue';
import MigrationPage from './pages/MigrationPage.vue';

declare module 'vue-router' {
  interface RouteMeta {
    locale?: LocaleCode;
    page?: PageName;
    /** Vertical center of the red spotlight behind the page (v1's spotlightYPosition). */
    spotlightY?: string;
  }
}

const PAGE_COMPONENTS = { home: HomePage, migration: MigrationPage } as const;
const SPOTLIGHT_Y: Partial<Record<PageName, string>> = { home: '800px' };

/** Locale of a path from its prefix ("/pt/..." is pt-BR, no prefix is English). */
export function localeFromPath(path: string): LocaleCode {
  const match = LOCALES.find(({ prefix }) => prefix && (path === prefix || path.startsWith(`${prefix}/`)));
  return match?.code ?? DEFAULT_LOCALE;
}

export const routes: RouteRecordRaw[] = [
  ...LOCALES.flatMap(({ code }) =>
    PAGE_NAMES.map(
      (page): RouteRecordRaw => ({
        path: localePath(code, page),
        name: `${page}-${code}`,
        component: PAGE_COMPONENTS[page],
        meta: { locale: code, page, spotlightY: SPOTLIGHT_Y[page] },
      }),
    ),
  ),
  // Unknown paths land on the home page of their locale. Not prerendered.
  { path: '/:pathMatch(.*)*', redirect: (to) => localePath(localeFromPath(to.path), 'home') },
];

const HEADER_OFFSET = 88;

export const scrollBehavior: RouterScrollBehavior = (to, _from, savedPosition) => {
  if (savedPosition) return savedPosition;
  if (to.hash) {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return { el: to.hash, top: HEADER_OFFSET, behavior: reduce ? 'auto' : 'smooth' };
  }
  return { top: 0 };
};
