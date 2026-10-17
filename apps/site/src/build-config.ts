// Build options shared by vite.config.ts, vitest.config.ts and the tests.
import type { Options as VueOptions } from '@vitejs/plugin-vue';
import type { ViteSSGOptions } from 'vite-ssg';
import { ALL_PATHS } from './i18n/locales.ts';

/** vue-i18n compile-time flags: Composition API only, no devtools in production. */
export const i18nFlags = {
  __VUE_I18N_FULL_INSTALL__: 'true',
  __VUE_I18N_LEGACY_API__: 'false',
  __INTLIFY_PROD_DEVTOOLS__: 'false',
};

/** Absolute URLs in templates point at public/ and stay as they are. */
export const vueOptions: VueOptions = {
  template: { transformAssetUrls: { includeAbsolute: false } },
};

export const ssgOptions: ViteSSGOptions = {
  // Every page in every locale; the catch-all redirect route is left out.
  includedRoutes: () => [...ALL_PATHS],
  // "/pt/" -> pt/index.html, "/pt/migration" -> pt/migration.html
  dirStyle: 'flat',
};
