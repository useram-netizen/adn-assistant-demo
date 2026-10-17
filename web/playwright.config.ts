import { defineConfig, devices } from '@playwright/test';
import {
  AI_OFF_MAIL_PREVIEW_DIR,
  AI_OFF_PORT,
  AI_OFF_STORAGE_DIR,
  AI_OFF_WIDGET_ORIGIN,
  E2E_PORT,
  HOST_ORIGIN,
  JOIN_URL,
  MAIL_PREVIEW_DIR,
  MOCK_AI_PORT,
  PRIVACY_URL,
  STORAGE_DIR,
  WIDGET_ORIGIN,
} from './e2e/env.ts';

/** Settings shared by both test servers: the real member list, emails in preview mode only. */
const serverEnv = {
  NODE_ENV: 'test',
  ALLOWED_EMBED_ORIGINS: 'http://localhost:* http://127.0.0.1:*',
  JOIN_URL,
  PRIVACY_URL,
  EMAIL_MODE: 'preview',
  // One address runs every test session.
  RATE_LIMITS: 'off',
};

/**
 * End-to-end tests inside /embed-test, at phone (375 px) and desktop (1280 px) sizes, plus
 * Safari's engine on a 375 px iPhone. Run `npm run test:e2e` from the repo root: it builds
 * first, then this starts the built server twice (with a fake OpenAI API, and with the AI off).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
  webServer: [
    {
      command: `npx tsx ../server/test/support/mockOpenAI.ts --port ${MOCK_AI_PORT}`,
      port: MOCK_AI_PORT,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node ../server/dist/index.js',
      url: `${HOST_ORIGIN}/api/health`,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ...serverEnv,
        PORT: String(E2E_PORT),
        PUBLIC_BASE_URL: WIDGET_ORIGIN,
        AI_ENABLED: 'true',
        OPENAI_API_KEY: 'test-key-for-the-mock',
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_AI_PORT}/v1`,
        STORAGE_DIR,
        MAIL_PREVIEW_DIR,
      },
    },
    {
      command: 'node ../server/dist/index.js',
      url: `http://127.0.0.1:${AI_OFF_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ...serverEnv,
        PORT: String(AI_OFF_PORT),
        PUBLIC_BASE_URL: AI_OFF_WIDGET_ORIGIN,
        AI_ENABLED: 'false',
        STORAGE_DIR: AI_OFF_STORAGE_DIR,
        MAIL_PREVIEW_DIR: AI_OFF_MAIL_PREVIEW_DIR,
      },
    },
  ],
});
