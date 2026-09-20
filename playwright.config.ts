import dotenv from 'dotenv';
dotenv.config({ path: '.env.test', quiet: true });
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '64532';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;

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
  ],
  webServer: {
    command: 'npm run dev',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      DISABLE_RATE_LIMIT: '1',
      TEST_SCHEMA: 'lifeloop_test_e2e',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL!,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
