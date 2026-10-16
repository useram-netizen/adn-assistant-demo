import type { RequestHandler } from 'express';
import helmet from 'helmet';
import type { Config } from '../config/env.js';
import { frameAncestors } from './embedOrigins.js';

/** /widget, /widget/ and everything under /widget/ (Express routing is case-insensitive too). */
const WIDGET_PATH = /^\/widget(?:\/|$)/i;
const EMBED_TEST_PATH = /^\/embed-test\/?$/i;

/**
 * Security headers. There are three variants:
 * - /widget is shown in iframes on other sites: no X-Frame-Options (helmet's frameguard is off),
 *   CSP frame-ancestors from ALLOWED_EMBED_ORIGINS, and a cross-origin resource policy.
 * - /embed-test plays the part of a host site: it may load embed.js and the widget from
 *   PUBLIC_BASE_URL even when the page itself is opened on another host name.
 * - Everything else gets helmet's defaults (X-Frame-Options SAMEORIGIN, never DENY).
 */
export function securityHeaders(config: Config): RequestHandler {
  const https = config.publicBaseUrl.startsWith('https://');
  const strictTransportSecurity = https ? { maxAge: 31_536_000, includeSubDomains: true } : false;

  const baseDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    // Only over https: on http (local development) it would break loading the page's own files.
    ...(https ? { upgradeInsecureRequests: [] } : {}),
  };

  const widget = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        ...baseDirectives,
        frameAncestors: frameAncestors(config.embed.allowedOrigins),
      },
    },
    frameguard: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity,
  });

  const embedTest = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        ...baseDirectives,
        scriptSrc: ["'self'", config.publicBaseUrl],
        frameSrc: ["'self'", config.publicBaseUrl],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'self'"],
      },
    },
    strictTransportSecurity,
  });

  const standard = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { ...baseDirectives, frameAncestors: ["'self'"] },
    },
    strictTransportSecurity,
  });

  return (req, res, next) => {
    if (WIDGET_PATH.test(req.path)) return widget(req, res, next);
    if (EMBED_TEST_PATH.test(req.path)) return embedTest(req, res, next);
    return standard(req, res, next);
  };
}
