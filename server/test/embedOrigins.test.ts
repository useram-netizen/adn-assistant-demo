import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBED_ORIGINS,
  frameAncestors,
  parseEmbedOrigins,
} from '../src/security/embedOrigins.js';

describe('parseEmbedOrigins', () => {
  it('parses the default list', () => {
    expect(parseEmbedOrigins(DEFAULT_EMBED_ORIGINS)).toEqual({
      sources: [
        'https://divorceamicably.com',
        'https://www.divorceamicably.com',
        'https://amicabledivorce.net',
        'https://www.amicabledivorce.net',
        'http://localhost:*',
      ],
      invalid: [],
    });
  });

  it('accepts spaces, commas, a wildcard subdomain, ports and *', () => {
    expect(
      parseEmbedOrigins(
        ' https://A.example.com/ ,https://*.growthzonesites.com  http://127.0.0.1:8080 * ',
      ).sources,
    ).toEqual([
      'https://a.example.com',
      'https://*.growthzonesites.com',
      'http://127.0.0.1:8080',
      '*',
    ]);
  });

  it('drops duplicates', () => {
    expect(parseEmbedOrigins('https://a.example https://a.example').sources).toEqual([
      'https://a.example',
    ]);
  });

  it.each([
    'a.example',
    'ftp://a.example',
    'https://a.example/path',
    'https://a.example;',
    "'unsafe-inline'",
    'https://a.example:99999',
    'https://-bad.example',
    'data:',
  ])('rejects %s', (token) => {
    expect(parseEmbedOrigins(token)).toEqual({ sources: [], invalid: [token] });
  });
});

describe('frameAncestors', () => {
  it('always allows this server itself first', () => {
    expect(frameAncestors(['https://a.example'])).toEqual(["'self'", 'https://a.example']);
    expect(frameAncestors(["'self'", 'https://a.example'])).toEqual([
      "'self'",
      'https://a.example',
    ]);
    expect(frameAncestors([])).toEqual(["'self'"]);
  });

  it('is null (no frame-ancestors at all) when any site is allowed', () => {
    expect(frameAncestors(['https://a.example', '*'])).toBeNull();
  });
});
