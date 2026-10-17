import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { i18nFlags, ssgOptions, vueOptions } from './src/build-config.ts';

export default defineConfig({
  plugins: [vue(vueOptions)],
  define: i18nFlags,
  ssgOptions,
});
