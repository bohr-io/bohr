import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node 22 has the Fetch globals the adapter uses.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
