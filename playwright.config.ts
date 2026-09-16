import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:3005',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-chromium',
      use: { 
        ...devices['Pixel 5'],
      },
    },
    {
      name: 'mobile-webkit',
      use: { 
        ...devices['iPhone 12'],
      },
    },
    {
      name: 'tablet-chromium',
      use: { 
        ...devices['iPad Pro 11'],
      },
    },
  ],
  webServer: {
    command: 'PORT=3005 NODE_ENV=test npx tsx server.ts',
    port: 3005,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
