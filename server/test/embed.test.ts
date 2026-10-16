import { Script } from 'node:vm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { copy } from '../src/config/copy.js';
import { EMBED_SCRIPT_MAX_BYTES } from '../src/embed/embedScript.js';
import { BASE_URL, testApp } from './helpers.js';

describe('GET /embed.js', () => {
  it('serves a script under 5 KB', async () => {
    const res = await request(testApp()).get('/embed.js').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/javascript/);
    expect(Buffer.byteLength(res.text)).toBeLessThan(EMBED_SCRIPT_MAX_BYTES);
    expect(EMBED_SCRIPT_MAX_BYTES).toBe(5120);
  });

  it('can be loaded by other sites and is cached briefly', async () => {
    const res = await request(testApp()).get('/embed.js').expect(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('contains this server origin and the wording from copy.ts', async () => {
    const res = await request(testApp()).get('/embed.js').expect(200);
    expect(res.text).not.toContain('__ADN_EMBED_CONFIG__');
    expect(res.text).toContain(`"base":"${BASE_URL}"`);
    expect(res.text).toContain(copy.embed.bubbleLabel);
    expect(res.text).toContain(copy.embed.frameTitle);
  });

  it('is valid JavaScript', async () => {
    const res = await request(testApp()).get('/embed.js').expect(200);
    expect(() => new Script(res.text)).not.toThrow();
  });
});

describe('GET /embed-test', () => {
  it('shows and runs the inline, bubble and fallback embed codes', async () => {
    const res = await request(testApp()).get('/embed-test').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    const inline = `<script src="${BASE_URL}/embed.js" data-target="adn-assistant" data-site="divorceamicably" async></script>`;
    const bubble = `<script src="${BASE_URL}/embed.js" data-mode="bubble" data-site="divorceamicably" async></script>`;
    const fallback = `<iframe src="${BASE_URL}/widget?site=divorceamicably" title="Find a divorce professional" style="width:100%;height:760px;border:0"></iframe>`;
    // Live
    expect(res.text).toContain('<div id="adn-assistant"></div>');
    expect(res.text).toContain(inline);
    expect(res.text).toContain(bubble);
    expect(res.text).toContain(fallback);
    // Shown as code to copy
    expect(res.text).toContain(
      `&lt;script src=&quot;${BASE_URL}/embed.js&quot; data-target=&quot;adn-assistant&quot;`,
    );
  });

  it('can show one mode at a time', async () => {
    const res = await request(testApp()).get('/embed-test?mode=bubble').expect(200);
    expect(res.text).toContain('id="bubble"');
    expect(res.text).not.toContain('id="inline"');
    expect(res.text).not.toContain('id="fallback"');
  });

  it('sets the test width only from the fixed list', async () => {
    const app = testApp();
    expect((await request(app).get('/embed-test?width=320')).text).toContain('max-width:320px');
    expect((await request(app).get('/embed-test?width=999')).text).not.toContain('max-width:999px');
  });

  it('ignores unexpected query values', async () => {
    const res = await request(testApp())
      .get('/embed-test')
      .query({ mode: '<script>', site: '"><script>alert(1)</script>' })
      .expect(200);
    expect(res.text).not.toContain('alert(1)');
    expect(res.text).toContain('id="inline"');
    expect(res.text).toContain('data-site="divorceamicably"');
  });

  it('may load the script and widget from PUBLIC_BASE_URL', async () => {
    const res = await request(testApp()).get('/embed-test').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain(`script-src 'self' ${BASE_URL}`);
    expect(csp).toContain(`frame-src 'self' ${BASE_URL}`);
  });
});
