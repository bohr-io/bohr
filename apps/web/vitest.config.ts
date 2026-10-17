import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { i18nFlags, vueOptions } from './src/build-config.ts';

export default defineConfig({
  plugins: [vue(vueOptions)],
  define: i18nFlags,
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      // No network in tests: iframes (the preview) and popups do not load their pages.
      happyDOM: {
        settings: {
          navigation: { disableChildFrameNavigation: true, disableChildPageNavigation: true },
        },
      },
    },
    include: ['src/**/*.test.ts'],
    // Page tests mount the whole app (router, i18n, lazy pages) in happy-dom; slower CI runners need room.
    testTimeout: 15_000,
  },
});
