import vue from '@vitejs/plugin-vue';
import { defineConfig, type PluginOption } from 'vite';
import { INSTANCE_PATHS, i18nFlags, vueOptions } from './src/build-config.ts';

// The instance Worker serves dist/ on the same origin as its API. During development the API calls go
// to a local instance (`wrangler dev`, port 8787 by default) through the dev server's proxy. In demo mode
// (`vite --mode demo`) a dev-server plugin answers them from in-memory demo data instead; it is only
// loaded then, so it never reaches the production build.
const instanceUrl = process.env.BOHR_INSTANCE_URL ?? 'http://localhost:8787';

export default defineConfig(async ({ command, mode }) => {
  const demo = command === 'serve' && mode === 'demo';
  const plugins: PluginOption[] = [vue(vueOptions)];
  if (demo) plugins.push((await import('./demo/mock-api.ts')).demoApi());
  return {
    base: '/',
    plugins,
    define: i18nFlags,
    server: demo
      ? { port: 5173 }
      : { proxy: Object.fromEntries(INSTANCE_PATHS.map((path) => [path, { target: instanceUrl }])) },
  };
});
