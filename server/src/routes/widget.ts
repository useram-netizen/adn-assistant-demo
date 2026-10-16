import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import { copy } from '../config/copy.js';
import { escapeHtml } from '../lib/html.js';

const HASHED_ASSET = /[\\/]assets[\\/]/;

/**
 * Serves the widget build (web/dist) at /widget. The security headers for these paths
 * (frame-ancestors, no X-Frame-Options) are set in security/headers.ts.
 */
export function widgetRouter(widgetDir: string): Router {
  const router = Router();
  const indexFile = join(widgetDir, 'index.html');

  // /widget and /widget/ (the iframe URL is /widget?site=...&mode=...).
  router.get('/', (_req, res) => {
    if (!existsSync(indexFile)) {
      res
        .status(503)
        .type('html')
        .send(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(copy.widget.documentTitle)}</title><p>${escapeHtml(copy.widget.unavailable)}</p></html>`,
        );
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  router.use(
    express.static(widgetDir, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        // Vite puts a content hash in every file name under assets/, so they never change.
        res.setHeader(
          'Cache-Control',
          HASHED_ASSET.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  return router;
}
