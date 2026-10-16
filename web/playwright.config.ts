import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, HOST_ORIGIN, JOIN_URL, PRIVACY_URL, WIDGET_ORIGIN } from './e2e/env.ts';

/**
 * End-to-end tests inside /embed-test, at phone (375 px) and desktop (1280 px) sizes, plus
 * Safari's engine on a 375 px iPhone. Run `npm run test:e2e` from the repo root: it builds
 * first, then this starts the built server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: HOST_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      // iPhone 8: 375 x 667, WebKit.
      name: 'iphone-webkit',
      use: { ...devices['iPhone 8'] },
    },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    url: `${HOST_ORIGIN}/api/health`,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(E2E_PORT),
      PUBLIC_BASE_URL: WIDGET_ORIGIN,
      ALLOWED_EMBED_ORIGINS: 'http://localhost:* http://127.0.0.1:*',
      JOIN_URL,
      PRIVACY_URL,
      EMAIL_MODE: 'preview',
      AI_ENABLED: 'false',
    },
  },
});
