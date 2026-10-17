import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The git and preview tests start real processes, which is slow on Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
