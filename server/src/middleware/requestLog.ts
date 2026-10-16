import type { RequestHandler } from 'express';
import { log } from '../lib/log.js';

/** Logs method, path (never the query string or body), status and duration. */
export function requestLog(): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    // Read now: routers mounted on a path (like /api) change req.path while they run.
    const path = req.path;
    res.on('finish', () => {
      if (path === '/api/health' && res.statusCode === 200) return;
      log.info('request', {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  };
}
