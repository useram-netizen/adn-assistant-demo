import { existsSync } from 'node:fs';
import { createAiClient } from './ai/client.js';
import { createApp } from './app.js';
import { ConfigError, configWarnings, loadConfig, type Config } from './config/env.js';
import { createMailer } from './email/mailer.js';
import { createEventSink } from './events/sink.js';
import { createGeo } from './geo/index.js';
import { startLeadRetention } from './jobs/retention.js';
import { log } from './lib/log.js';
import { createMemberDirectory, startMemberReload } from './members/directory.js';
import { envFilePath } from './paths.js';
import { rateLimitsEnabled } from './security/rateLimit.js';
import { createStore } from './storage/index.js';

// Settings come from the repo's .env file; variables already set in the environment win.
// Tests set everything themselves, so they never read .env.
if (process.env.NODE_ENV !== 'test' && existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

/**
 * Asks OpenAI whether the configured model exists for this key (a free metadata call), and
 * logs the answer clearly. It never blocks startup: if the model can't be used, every AI
 * call falls back to buttons, and this log line says why.
 */
async function checkAiModel(config: Config): Promise<void> {
  if (!config.ai.available || !config.ai.apiKey) return;
  const base = (config.ai.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/models/${encodeURIComponent(config.ai.model)}`, {
      headers: { Authorization: `Bearer ${config.ai.apiKey}` },
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
    if (response.ok) {
      log.info('ai_model_ok', { model: config.ai.model });
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    log.error('ai_model_unavailable', {
      model: config.ai.model,
      status: response.status,
      code: body.error?.code ?? null,
      hint:
        response.status === 401
          ? 'OPENAI_API_KEY was rejected'
          : response.status === 404
            ? 'this model is not available to this API key: set OPENAI_MODEL'
            : 'OpenAI returned an error',
    });
  } catch (error) {
    log.warn('ai_model_check_failed', {
      model: config.ai.model,
      error: error instanceof Error ? error.name : 'unknown',
    });
  }
}

async function start(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  for (const warning of configWarnings(config)) log.warn('config_warning', { warning });

  const geo = createGeo(config.paths.countiesFile);
  const directory = await createMemberDirectory({ config, geo });
  const store = createStore(config);
  await store.init();
  const events = createEventSink(store);
  const mailer = createMailer(config);
  const ai = createAiClient(config);

  const app = createApp({
    config,
    deps: { geo, directory, store, events, mailer, ai, rateLimitEnabled: rateLimitsEnabled() },
  });
  const stopReload = startMemberReload(directory);
  const stopRetention = startLeadRetention(store, config.leadRetentionDays);

  const server = app.listen(config.port, (error?: Error) => {
    // Express 5 also calls this when listening fails.
    if (error) {
      log.error('server_error', { error: error.message });
      process.exit(1);
    }
    const members = directory.all();
    log.info('server_started', {
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      publicBaseUrlFrom: config.publicBaseUrlSource,
      nodeEnv: config.nodeEnv,
      platform: config.platform,
      members: members.length,
      searchableMembers: members.filter((member) => member.searchable && member.active).length,
      storage: store.kind,
      emailMode: config.email.mode,
      ai: config.ai.available ? 'on' : 'off',
      aiModel: config.ai.model,
    });
    void checkAiModel(config);
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('server_stopping', { signal });
    stopReload();
    stopRetention();
    // Don't wait forever for open connections.
    setTimeout(() => process.exit(0), 10_000).unref();
    server.close(() => {
      void (async () => {
        await events.flush().catch(() => undefined);
        await store.close().catch(() => undefined);
        process.exit(0);
      })();
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  log.error('startup_failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
