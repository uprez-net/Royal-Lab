import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 10000 },
});
