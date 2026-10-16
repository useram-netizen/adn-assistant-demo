import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { ConfigError, configWarnings, loadConfig } from './config/env.js';
import { log } from './lib/log.js';
import { envFilePath } from './paths.js';

// Settings come from the repo's .env file; variables already set in the environment win.
// Tests set everything themselves, so they never read .env.
if (process.env.NODE_ENV !== 'test' && existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

function start(): void {
  let config;
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

  const app = createApp({ config });
  const server = app.listen(config.port, () => {
    log.info('server_started', {
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      nodeEnv: config.nodeEnv,
      emailMode: config.email.mode,
      aiEnabled: config.ai.enabled,
    });
  });

  server.on('error', (error) => {
    log.error('server_error', { error: error.message });
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    log.info('server_stopping', { signal });
    server.close(() => process.exit(0));
    // Don't wait forever for open connections.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start();
