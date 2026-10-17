import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { copy } from '../src/config/copy.js';
import { testApp } from './helpers.js';

const DEFAULT_ANCESTORS =
  "frame-ancestors 'self' https://divorceamicably.com https://www.divorceamicably.com https://amicabledivorce.net https://www.amicabledivorce.net http://localhost:*";

describe('GET /widget', () => {
  it.each(['/widget', '/widget/', '/widget?site=divorceamicably&mode=inline'])(
    'serves the widget page at %s',
    async (path) => {
      const res = await request(await testApp()).get(path).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('widget fixture');
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('lets the allowed sites frame it (CSP frame-ancestors, no X-Frame-Options)', async () => {
    const res = await request(await testApp()).get('/widget').expect(200);
    expect(res.headers['content-security-policy']).toContain(DEFAULT_ANCESTORS);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('uses ALLOWED_EMBED_ORIGINS', async () => {
    const app = await testApp({ ALLOWED_EMBED_ORIGINS: 'https://tracy-test.example http://127.0.0.1:*' });
    const res = await request(app).get('/widget').expect(200);
    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'self' https://tracy-test.example http://127.0.0.1:*",
    );
  });

  it('allows any site with ALLOWED_EMBED_ORIGINS=*', async () => {
    const res = await request(await testApp({ ALLOWED_EMBED_ORIGINS: '*' }))
      .get('/widget')
      .expect(200);
    // No frame-ancestors at all: "*" there would still block sandboxed (opaque-origin) pages.
    expect(res.headers['content-security-policy']).not.toContain('frame-ancestors');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('keeps a strict policy for scripts and connections', async () => {
    const csp = (await request(await testApp()).get('/widget')).headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('serves hashed assets with a long cache and no X-Frame-Options', async () => {
    const res = await request(await testApp()).get('/widget/assets/index-abc123.js').expect(200);
    expect(res.text).toContain('widget fixture');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('does not cache other files for long', async () => {
    const res = await request(await testApp()).get('/widget/manifest.json').expect(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('returns 404 for missing files and paths outside the build', async () => {
    const app = await testApp();
    await request(app).get('/widget/assets/missing.js').expect(404);
    await request(app).get('/widget/..%2f..%2fpackage.json').expect(404);
    await request(app).get('/widget/%2e%2e/%2e%2e/package.json').expect(404);
  });

  describe('without a widget build', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'adn-no-widget-'));
    afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));

    it('shows a friendly page instead of an error', async () => {
      const res = await request(await testApp({}, { widgetDir: emptyDir }))
        .get('/widget')
        .expect(503);
      expect(res.text).toContain(copy.widget.unavailable);
    });
  });
});

describe('HTTPS headers', () => {
  it('sends HSTS and upgrade-insecure-requests when PUBLIC_BASE_URL is https', async () => {
    const res = await request(await testApp()).get('/widget');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  it('leaves them out on http (local development)', async () => {
    const res = await request(await testApp({ PUBLIC_BASE_URL: 'http://localhost:3000' })).get('/widget');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

describe('X-Frame-Options', () => {
  it('is never DENY, and is SAMEORIGIN outside /widget', async () => {
    const app = await testApp();
    for (const path of [
      '/api/health',
      '/api/config',
      '/embed.js',
      '/embed-test',
      '/nope',
      '/widget',
    ]) {
      const res = await request(app).get(path);
      expect(res.headers['x-frame-options'] ?? '').not.toMatch(/deny/i);
      if (!path.startsWith('/widget')) expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    }
  });
});
