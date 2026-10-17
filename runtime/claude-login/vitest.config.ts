import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The end-to-end test starts a real process (the agent's fake CLI), which is slow on Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
