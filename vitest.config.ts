import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    testTimeout: 25000,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    env: {
      NODE_ENV: 'test',
    },
  },
});

