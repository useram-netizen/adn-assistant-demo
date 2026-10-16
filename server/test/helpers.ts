import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp, type AppOptions } from '../src/app.js';
import { loadConfig, type Config } from '../src/config/env.js';

export const BASE_URL = 'https://assistant.example.com';

/** A stand-in for web/dist, so these tests don't need a widget build. */
export const widgetFixtureDir = fileURLToPath(new URL('./fixtures/widget', import.meta.url));

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: BASE_URL, ...env });
}

export function testApp(
  env: Record<string, string> = {},
  options: Omit<AppOptions, 'config'> = {},
): Express {
  return createApp({ config: testConfig(env), widgetDir: widgetFixtureDir, ...options });
}
