import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../src/app.js';
import { loadConfig, type Config } from '../src/config/env.js';
import type { EventRecord, EventSink, Mailer } from '../src/domain/types.js';
import { createGeo } from '../src/geo/index.js';
import { createMemberDirectory } from '../src/members/directory.js';
import { MemoryStore } from '../src/storage/memoryStore.js';

export const BASE_URL = 'https://assistant.example.com';

/** A stand-in for web/dist, so these tests don't need a widget build. */
export const widgetFixtureDir = fileURLToPath(new URL('./fixtures/widget', import.meta.url));

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: BASE_URL, ...env });
}

/** Collects the server-side events and the emails a test produces. */
export interface TestDeps extends AppDeps {
  store: MemoryStore;
  events: EventSink & { recorded: EventRecord[] };
  mailer: Mailer & { sent: Parameters<Mailer['send']>[0][] };
}

const config = testConfig();
const geo = createGeo(config.paths.countiesFile);
// The real member list, loaded once for all tests in a file.
const directoryPromise = createMemberDirectory({ config, geo });

export async function testDeps(overrides: Partial<AppDeps> = {}): Promise<TestDeps> {
  const events = {
    recorded: [] as EventRecord[],
    record(event: { sessionId: string; site: string; type: never; data: never }) {
      const at = new Date().toISOString();
      this.recorded.push({ ...event, at, receivedAt: at, source: 'server' } as EventRecord);
    },
  } as TestDeps['events'];
  const mailer = {
    mode: 'preview' as const,
    sent: [] as Parameters<Mailer['send']>[0][],
    send(email: Parameters<Mailer['send']>[0]) {
      this.sent.push(email);
      return Promise.resolve({ status: 'previewed' as const });
    },
  };
  return {
    geo,
    directory: await directoryPromise,
    store: new MemoryStore(),
    events,
    mailer,
    ai: null,
    rateLimitEnabled: false,
    ...overrides,
  } as TestDeps;
}

export async function testApp(
  env: Record<string, string> = {},
  options: { widgetDir?: string; deps?: Partial<AppDeps> } = {},
): Promise<Express> {
  return createApp({
    config: testConfig(env),
    deps: await testDeps(options.deps),
    widgetDir: options.widgetDir ?? widgetFixtureDir,
  });
}
