import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/vitest-worker-setup.ts'],
    testTimeout: 25000,
    retry: 0,
    pool: 'forks',
    execArgv: ['--no-use-env-proxy'],
    maxWorkers: 1,
    fileParallelism: false,
    sequence: {
      concurrent: false,
      shuffle: {
        files: true,
        tests: false,
      },
    },
    env: {
      NODE_ENV: 'test',
      DISABLE_RATE_LIMIT: '1',
      NO_PROXY: '*',
      no_proxy: '*',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      ALL_PROXY: '',
      all_proxy: '',
    },
  },
});

