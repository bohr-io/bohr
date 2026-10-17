// Build options shared by vite.config.ts and vitest.config.ts.
import type { Options as VueOptions } from '@vitejs/plugin-vue';

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

/** Paths the instance Worker answers itself (its `run_worker_first` list); everything else is this app. */
export const INSTANCE_PATHS = ['/api', '/auth', '/setup', '/.well-known', '/health'];
