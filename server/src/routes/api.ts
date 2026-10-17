import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import type { AppDeps } from '../app.js';
import type { Config } from '../config/env.js';
import { apiNotFound } from '../middleware/errors.js';
import { serverRoot } from '../paths.js';
import type { PublicConfigResponse } from '../shared/api.js';
import { adminRouter } from './admin.js';
import { aiRouter } from './ai.js';
import { eventsRouter } from './events.js';
import { geoRouter } from './geo.js';
import { leadsRouter } from './leads.js';
import { matchRouter } from './match.js';

const { version } = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as {
  version: string;
};

/** Settings the widget needs. Only public, non-secret values belong here. */
export function publicConfig(config: Config): PublicConfigResponse {
  return {
    links: {
      join: config.links.join ?? null,
      ukSite: config.links.ukSite,
      articles: config.links.articles ?? null,
      podcast: config.links.podcast ?? null,
      booking: config.links.booking ?? null,
      privacy: config.links.privacy ?? null,
    },
    features: {
      ai: config.ai.available,
      showProContact: config.showProContact,
    },
  };
}

/** Everything under /api. Each module's router owns its own paths. */
export function apiRouter(config: Config, deps: AppDeps): Router {
  const { geo, directory, store, events, mailer, ai, rateLimitEnabled } = deps;
  const router = Router();
  router.use(express.json({ limit: '20kb' }));
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      version,
      uptimeSeconds: Math.round(process.uptime()),
      members: directory.all().filter((member) => member.searchable && member.active).length,
      storage: store.kind,
      ai: config.ai.available ? 'on' : 'off',
    });
  });

  const settings = publicConfig(config);
  router.get('/config', (_req, res) => {
    res.json(settings);
  });

  router.use(geoRouter({ geo }));
  router.use(matchRouter({ config, geo, directory, store, rateLimitEnabled }));
  router.use(aiRouter({ config, geo, events, client: ai, rateLimitEnabled }));
  router.use(leadsRouter({ config, geo, directory, store, events, mailer, rateLimitEnabled }));
  router.use(eventsRouter({ config, store, rateLimitEnabled }));
  router.use(adminRouter({ config, store, directory }));

  router.use(apiNotFound);
  return router;
}
