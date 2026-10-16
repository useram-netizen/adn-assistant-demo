import { Router } from 'express';
import type { Config } from '../config/env.js';
import { buildEmbedScript } from '../embed/embedScript.js';
import { parseEmbedTestOptions, renderEmbedTestPage } from '../embed/embedTestPage.js';

/** GET /embed.js and GET /embed-test. */
export function embedRouter(config: Config, embedScriptPath: string): Router {
  const router = Router();
  const script = buildEmbedScript(embedScriptPath, config);

  router.get('/embed.js', (_req, res) => {
    // Host sites load this file from another origin, so it must not be same-origin only.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Short cache, so a new version reaches the host sites within minutes.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('text/javascript').send(script);
  });

  router.get('/embed-test', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderEmbedTestPage(config, parseEmbedTestOptions(req.query)));
  });

  return router;
}
