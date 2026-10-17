import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        bindings: {
          TELEGRAM_BOT_TOKEN: '777:test-token',
          TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-for-tests',
          ANTHROPIC_API_KEY: 'sk-ant-real-key-for-tests',
          PROJECT_SECRET: 'project-secret-for-tests-0123456789',
        },
      },
    }),
  ],
});
