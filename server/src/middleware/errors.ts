import type { ErrorRequestHandler, RequestHandler } from 'express';
import { log, redact } from '../lib/log.js';

/** Unknown /api routes get a JSON 404. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).type('text/plain').send('Not found');
};

interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

/** Error codes for the body parser's errors (https://github.com/expressjs/body-parser#errors). */
const BODY_ERROR_CODES: Record<string, string> = {
  'entity.parse.failed': 'invalid_json',
  'entity.too.large': 'payload_too_large',
  'encoding.unsupported': 'unsupported_encoding',
  'charset.unsupported': 'unsupported_charset',
};

/**
 * Last-resort error handler. Responses never include stack traces or error messages, and
 * client errors are not logged in detail, because a parse error message can contain part
 * of the request body (which may hold personal details).
 */
// Express recognises error handlers by their four parameters, so _next must stay.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const info = (typeof err === 'object' && err !== null ? err : {}) as HttpErrorLike;
  const rawStatus = Number(info.status ?? info.statusCode);
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  if (status >= 500) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('request_failed', {
      method: req.method,
      path: req.path,
      error: error.name,
      detail: redact(error.message),
      stack: error.stack === undefined ? undefined : redact(error.stack),
    });
  }

  if (res.headersSent) {
    // Too late for an error response. Don't hand it to Express's default handler, which would
    // print the error unredacted: close the connection (the error is logged above).
    req.socket.destroy();
    return;
  }

  const code =
    status >= 500
      ? 'server_error'
      : ((typeof info.type === 'string' ? BODY_ERROR_CODES[info.type] : undefined) ??
        'bad_request');

  if (req.path.startsWith('/api/') || req.path === '/api') {
    res.status(status).json({ error: code });
  } else {
    res
      .status(status)
      .type('text/plain')
      .send(status >= 500 ? 'Something went wrong' : 'Bad request');
  }
};
