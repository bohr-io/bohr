import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Local KV for tests, whatever id wrangler.jsonc holds. The dispatch
      // namespace has no local simulator; tests pass a fake DISPATCHER.
      miniflare: { kvNamespaces: { ROUTES: 'routes-test' } },
    }),
  ],
});
