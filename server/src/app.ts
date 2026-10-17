import express, { type Express } from 'express';
import type { AiClient } from './ai/client.js';
import type { Config } from './config/env.js';
import type { EventSink, Geo, Mailer, MemberDirectory, Store } from './domain/types.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestLog } from './middleware/requestLog.js';
import { embedScriptPath, widgetDistDir } from './paths.js';
import { apiRouter } from './routes/api.js';
import { embedRouter } from './routes/embed.js';
import { widgetRouter } from './routes/widget.js';
import { securityHeaders } from './security/headers.js';

/** The services the routes use. index.ts builds the real ones; tests pass fakes. */
export interface AppDeps {
  geo: Geo;
  directory: MemberDirectory;
  store: Store;
  events: EventSink;
  mailer: Mailer;
  /** null when the AI is off or there is no key: every AI route then falls back. */
  ai: AiClient | null;
  /** false only when RATE_LIMITS=off (end-to-end tests). */
  rateLimitEnabled: boolean;
}

export interface AppOptions {
  config: Config;
  deps: AppDeps;
  /** Folder with the widget build. Defaults to web/dist. */
  widgetDir?: string;
  /** The embed script source. Defaults to server/static/embed.js. */
  embedScript?: string;
}

/** One app serves /api/*, /widget, /embed.js and /embed-test. */
export function createApp({
  config,
  deps,
  widgetDir = widgetDistDir,
  embedScript = embedScriptPath,
}: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Render's proxy: trust it. Elsewhere only a reverse proxy on this machine (TRUST_PROXY).
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));
  app.use(requestLog());

  app.use('/api', apiRouter(config, deps));
  app.use('/widget', widgetRouter(widgetDir));
  app.use(embedRouter(config, embedScript));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
