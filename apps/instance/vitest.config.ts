import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          // An empty database for the self-migration test
          d1Databases: { EMPTY_DB: 'empty-db' },
          bindings: {
            TEST_MIGRATIONS: migrations,
            CF_ACCOUNT_ID: 'acc',
            BOHR_ZONE_ID: 'zone-bohr',
            CF_API_TOKEN: 'test-cf-token',
            GITHUB_CLIENT_ID: 'gh-client',
            GITHUB_CLIENT_SECRET: 'gh-secret',
            ADMIN_TOKEN: 'admin-token-for-tests-0123456789abcdef',
            // 32 zero bytes, base64
            ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
