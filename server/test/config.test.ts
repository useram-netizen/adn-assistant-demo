import { describe, expect, it } from 'vitest';
import { ConfigError, configWarnings, loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('uses the defaults from the spec when nothing is set', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.publicBaseUrl).toBe('http://localhost:3000');
    expect(config.email.mode).toBe('preview');
    expect(config.ai).toEqual({
      enabled: true,
      apiKey: undefined,
      model: 'gpt-6-luna',
      timeoutMs: 10_000,
      maxCallsPerSession: 20,
      storeTranscripts: false,
    });
    expect(config.links).toEqual({
      join: undefined,
      ukSite: 'https://amicabledivorcenetwork.co.uk',
      articles: undefined,
      podcast: undefined,
      booking: undefined,
      privacy: undefined,
    });
    expect(config.showProContact).toBe(false);
    expect(config.leadRetentionDays).toBeUndefined();
    expect(config.embed.allowedOrigins).toEqual([
      'https://divorceamicably.com',
      'https://www.divorceamicably.com',
      'https://amicabledivorce.net',
      'https://www.amicabledivorce.net',
      'http://localhost:*',
    ]);
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({ JOIN_URL: '', PRIVACY_URL: '   ', EMAIL_MODE: '', PORT: '' });
    expect(config.links.join).toBeUndefined();
    expect(config.links.privacy).toBeUndefined();
    expect(config.email.mode).toBe('preview');
    expect(config.port).toBe(3000);
  });

  it('parses numbers, booleans and links', () => {
    const config = loadConfig({
      PORT: '8080',
      AI_ENABLED: 'false',
      SHOW_PRO_CONTACT: 'true',
      LEAD_RETENTION_DAYS: '90',
      JOIN_URL: 'https://amicabledivorce.net/join',
    });
    expect(config.port).toBe(8080);
    expect(config.ai.enabled).toBe(false);
    expect(config.showProContact).toBe(true);
    expect(config.leadRetentionDays).toBe(90);
    expect(config.links.join).toBe('https://amicabledivorce.net/join');
  });

  it('reduces PUBLIC_BASE_URL to its origin', () => {
    expect(loadConfig({ PUBLIC_BASE_URL: 'https://Assistant.Example.com/' }).publicBaseUrl).toBe(
      'https://assistant.example.com',
    );
  });

  it.each([
    ['a path', 'https://assistant.example.com/adn'],
    ['a query', 'https://assistant.example.com/?x=1'],
    ['another scheme', 'ftp://assistant.example.com'],
    ['no scheme', 'assistant.example.com'],
  ])('rejects a PUBLIC_BASE_URL with %s', (_label, value) => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: value })).toThrow(ConfigError);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['AI_ENABLED', 'maybe'],
    ['EMAIL_MODE', 'send-everything'],
    ['JOIN_URL', 'not a url'],
    ['PRIVACY_URL', 'javascript:alert(1)'],
    ['TRACY_EMAIL', 'tracy'],
    ['LEAD_RETENTION_DAYS', '-5'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(new RegExp(key));
  });

  it('allows EMAIL_MODE=live only with NODE_ENV=production (rule 1)', () => {
    expect(() => loadConfig({ EMAIL_MODE: 'live' })).toThrow(/live is only allowed/);
    expect(() => loadConfig({ EMAIL_MODE: 'live', NODE_ENV: 'test' })).toThrow(ConfigError);
    expect(loadConfig({ EMAIL_MODE: 'live', NODE_ENV: 'production' }).email.mode).toBe('live');
  });

  it('needs EMAIL_REDIRECT_TO in redirect mode', () => {
    expect(() => loadConfig({ EMAIL_MODE: 'redirect' })).toThrow(/EMAIL_REDIRECT_TO/);
    const config = loadConfig({ EMAIL_MODE: 'redirect', EMAIL_REDIRECT_TO: 'test@example.com' });
    expect(config.email.redirectTo).toBe('test@example.com');
  });

  it('rejects ALLOWED_EMBED_ORIGINS values that could change the CSP header', () => {
    expect(() =>
      loadConfig({ ALLOWED_EMBED_ORIGINS: "https://a.example; script-src 'unsafe-inline'" }),
    ).toThrow(/ALLOWED_EMBED_ORIGINS/);
    expect(() => loadConfig({ ALLOWED_EMBED_ORIGINS: 'https://a.example/page' })).toThrow(
      /ALLOWED_EMBED_ORIGINS/,
    );
  });

  it('accepts * for the first embedding test', () => {
    expect(loadConfig({ ALLOWED_EMBED_ORIGINS: '*' }).embed.allowedOrigins).toEqual(['*']);
  });

  it('never repeats setting values in its error message', () => {
    const secret = 'short-secret';
    try {
      loadConfig({ ADMIN_TOKEN: secret, PORT: 'secret-port' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toMatch(/ADMIN_TOKEN/);
      expect(message).toMatch(/PORT/);
      expect(message).not.toContain(secret);
      expect(message).not.toContain('secret-port');
    }
  });
});

describe('configWarnings', () => {
  it('warns when production is not on https', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'http://assistant.example.com',
    });
    expect(configWarnings(config).join(' ')).toMatch(/not https/);
  });

  it('warns while any site may embed the widget', () => {
    expect(configWarnings(loadConfig({ ALLOWED_EMBED_ORIGINS: '*' })).join(' ')).toMatch(
      /narrow it/,
    );
  });

  it('is quiet for a normal production setup', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://assistant.example.com',
    });
    expect(configWarnings(config)).toEqual([]);
  });
});
