import express, { type Express } from 'express';
import type { Config } from './config/env.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestLog } from './middleware/requestLog.js';
import { embedScriptPath, widgetDistDir } from './paths.js';
import { apiRouter } from './routes/api.js';
import { embedRouter } from './routes/embed.js';
import { widgetRouter } from './routes/widget.js';
import { securityHeaders } from './security/headers.js';

export interface AppOptions {
  config: Config;
  /** Folder with the widget build. Defaults to web/dist. */
  widgetDir?: string;
  /** The embed script source. Defaults to server/static/embed.js. */
  embedScript?: string;
}

/** One app serves /api/*, /widget, /embed.js and /embed-test. */
export function createApp({
  config,
  widgetDir = widgetDistDir,
  embedScript = embedScriptPath,
}: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  // Trust X-Forwarded-* only from a reverse proxy on this machine (see README, "Deploying").
  app.set('trust proxy', 'loopback');

  app.use(securityHeaders(config));
  app.use(requestLog());

  app.use('/api', apiRouter(config));
  app.use('/widget', widgetRouter(widgetDir));
  app.use(embedRouter(config, embedScript));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
