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
      // The tap-to-select regression guard runs in its own chromium-mobile-touch
      // project (Pixel 5); on WebKit it's flaky and adds no coverage.
      testIgnore: '**/mobile-territory-tap.spec.ts',
    },
    {
      name: 'chromium-mobile-touch',
      use: {
        ...devices['Pixel 5'],
      },
      testMatch: '**/mobile-territory-tap.spec.ts',
    },
  ],
});