import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    isolate: true,
  },
});
