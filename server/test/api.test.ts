import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('GET /api/health', () => {
  it('reports that the server is up', async () => {
    const res = await request(await testApp())
      .get('/api/health')
      .expect(200);
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'ai',
      'members',
      'ok',
      'storage',
      'uptimeSeconds',
      'version',
    ]);
    expect(body).toMatchObject({ ok: true, version: '0.1.0', ai: 'off', storage: 'memory' });
    expect(typeof body.uptimeSeconds).toBe('number');
    // The real member list: 199 searchable members (spec: "Expected dry-run result").
    expect(body.members).toBe(199);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/config', () => {
  it('returns the public links, with null for links that are not set', async () => {
    const app = await testApp({
      JOIN_URL: 'https://example.com/join',
      PRIVACY_URL: 'https://example.com/privacy',
    });
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body).toEqual({
      links: {
        join: 'https://example.com/join',
        ukSite: 'https://amicabledivorcenetwork.co.uk',
        articles: null,
        podcast: null,
        booking: null,
        privacy: 'https://example.com/privacy',
      },
      features: { ai: false, showProContact: false },
    });
  });

  it('never includes secrets', async () => {
    const secrets = {
      OPENAI_API_KEY: 'sk-test-openai-key-123',
      SMTP_PASS: 'smtp-password-456',
      ADMIN_TOKEN: 'admin-token-0123456789',
      MONGODB_URI: 'mongodb://user:db-password@db.example.com/adn',
      TRACY_EMAIL: 'tracy@example.com',
    };
    const res = await request(await testApp(secrets))
      .get('/api/config')
      .expect(200);
    for (const value of Object.values(secrets)) expect(res.text).not.toContain(value);
  });
});

describe('API errors', () => {
  it('answers unknown routes with a JSON 404', async () => {
    const res = await request(await testApp())
      .get('/api/nothing-here')
      .expect(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('rejects malformed JSON without echoing it or showing a stack trace', async () => {
    const res = await request(await testApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"name": "Jane Doe", oops')
      .expect(400);
    expect(res.body).toEqual({ error: 'invalid_json' });
    expect(res.text).not.toContain('Jane');
    expect(res.text).not.toMatch(/\bat\s.+\(/);
  });

  it('limits request bodies to 20 KB', async () => {
    const res = await request(await testApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(21 * 1024) }))
      .expect(413);
    expect(res.body).toEqual({ error: 'payload_too_large' });
  });

  it('accepts bodies under the limit', async () => {
    await request(await testApp())
      .post('/api/nothing-here')
      .send({ text: 'x'.repeat(19 * 1024) })
      .expect(404);
  });
});
