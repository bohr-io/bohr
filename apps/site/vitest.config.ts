import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { i18nFlags, vueOptions } from './src/build-config.ts';

export default defineConfig({
  plugins: [vue(vueOptions)],
  define: i18nFlags,
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
