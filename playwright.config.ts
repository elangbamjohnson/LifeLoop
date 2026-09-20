import dotenv from 'dotenv';
dotenv.config({ path: '.env.test', quiet: true });
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
import { defineConfig, devices } from '@playwright/test';

// E2E server uses a dedicated port that never conflicts with the dev server.
const E2E_PORT = 64533;
const E2E_HMR_PORT = 24679;
const baseURL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 15'],
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['iPad Pro 11'],
      },
    },
    {
      name: 'tablet-android',
      use: {
        ...devices['Galaxy Tab S4'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    // Playwright polls this URL to know the server is ready.
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      DISABLE_RATE_LIMIT: '1',
      TEST_SCHEMA: 'lifeloop_test_e2e',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL!,
      // Dedicated ports so the e2e server never collides with the dev server.
      PORT: String(E2E_PORT),
      VITE_HMR_PORT: String(E2E_HMR_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
