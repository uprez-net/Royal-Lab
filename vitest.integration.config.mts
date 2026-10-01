import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
