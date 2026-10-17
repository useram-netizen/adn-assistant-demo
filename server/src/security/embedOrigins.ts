/** The spec's default list of sites that may show the widget in an iframe. */
export const DEFAULT_EMBED_ORIGINS =
  'https://divorceamicably.com https://www.divorceamicably.com https://amicabledivorce.net https://www.amicabledivorce.net http://localhost:*';

/**
 * One CSP host-source: http(s), an optional "*." subdomain wildcard, a host name, and an
 * optional port or ":*". Anything else (paths, quotes, ";" or ",") is rejected, so a bad
 * setting can never inject extra directives into the Content-Security-Policy header.
 */
const HOST_SOURCE =
  /^https?:\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::(?:\d{1,5}|\*))?$/;

export interface ParsedEmbedOrigins {
  /** Normalised CSP sources, for example "https://divorceamicably.com" or "*". */
  sources: string[];
  /** Tokens that are not valid sources. */
  invalid: string[];
}

/** Parses ALLOWED_EMBED_ORIGINS: sources separated by spaces (commas are accepted too). */
export function parseEmbedOrigins(raw: string): ParsedEmbedOrigins {
  const sources: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const source = token.toLowerCase().replace(/\/$/, '');
    const port = /:(\d+)$/.exec(source)?.[1];
    if (source === '*' || source === "'self'") {
      sources.push(source);
    } else if (HOST_SOURCE.test(source) && (port === undefined || Number(port) <= 65535)) {
      sources.push(source);
    } else {
      invalid.push(token);
    }
  }
  return { sources: [...new Set(sources)], invalid };
}

/**
 * The frame-ancestors list for /widget. This server is always allowed, for /embed-test.
 * null for "*": then no frame-ancestors is sent at all, because "*" in frame-ancestors still
 * blocks pages with an opaque origin (an embed block inside a sandboxed iframe).
 */
export function frameAncestors(sources: readonly string[]): string[] | null {
  if (sources.includes('*')) return null;
  return ["'self'", ...sources.filter((source) => source !== "'self'")];
}
