import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-smoke',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: '**/smoke.spec.ts',
    },
    {
      name: 'chromium-map-visual',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: '**/map-visual-smoke.spec.ts',
    },
    {
      name: 'mobile-safari-size',
      use: {
        ...devices['iPhone 13'],
      },
    },
  ],
});