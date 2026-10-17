import { createHead } from '@unhead/vue/server';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createSiteI18n } from './i18n';
import { DEFAULT_LOCALE } from './i18n/locales';
import { routes } from './router';

/**
 * Router, i18n and head wired like main.ts, on an in-memory history. Missing
 * translation keys are collected instead of silently falling back.
 */
export async function createTestContext(path: string) {
  const missing: string[] = [];
  const i18n = createSiteI18n();
  i18n.global.setMissingHandler((locale, key) => {
    missing.push(`${locale}:${key}`);
    return key;
  });

  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach((to) => {
    i18n.global.locale.value = to.meta.locale ?? DEFAULT_LOCALE;
  });
  await router.push(path);
  await router.isReady();

  const head = createHead();
  return { i18n, router, head, missing, plugins: [router, i18n, head] as const };
}

/** A fetch stub that answers every request with the given status and JSON body. */
export function stubFetch(status: number, body: unknown = null) {
  return async (_input?: RequestInfo | URL, _init?: RequestInit) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}
