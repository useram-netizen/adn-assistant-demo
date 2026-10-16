import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import type { Config } from '../config/env.js';
import { apiNotFound } from '../middleware/errors.js';
import { serverRoot } from '../paths.js';

const { version } = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as {
  version: string;
};

/** Settings the widget needs. Only public, non-secret values belong here. */
export function publicConfig(config: Config) {
  return {
    links: {
      join: config.links.join ?? null,
      ukSite: config.links.ukSite,
      articles: config.links.articles ?? null,
      podcast: config.links.podcast ?? null,
      booking: config.links.booking ?? null,
      privacy: config.links.privacy ?? null,
    },
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;

export function apiRouter(config: Config): Router {
  const router = Router();
  router.use(express.json({ limit: '20kb' }));
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, version, uptimeSeconds: Math.round(process.uptime()) });
  });

  const settings = publicConfig(config);
  router.get('/config', (_req, res) => {
    res.json(settings);
  });

  router.use(apiNotFound);
  return router;
}
