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
      available: false,
      apiKey: undefined,
      model: 'gpt-6-luna',
      baseUrl: undefined,
      timeoutMs: 10_000,
      maxCallsPerSession: 20,
      storeTranscripts: false,
    });
    expect(config.platform).toBe('other');
    expect(config.trustProxy).toBe('loopback');
    expect(config.publicBaseUrlSource).toBe('default');
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

  it('on Render, uses RENDER_EXTERNAL_URL unless PUBLIC_BASE_URL is set, and trusts the proxy', () => {
    const render = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://adn-assistant.onrender.com' };
    const config = loadConfig(render);
    expect(config.publicBaseUrl).toBe('https://adn-assistant.onrender.com');
    expect(config.publicBaseUrlSource).toBe('RENDER_EXTERNAL_URL');
    expect(config.platform).toBe('render');
    expect(config.trustProxy).toBe(true);
    const custom = loadConfig({ ...render, PUBLIC_BASE_URL: 'https://assistant.example.com' });
    expect(custom.publicBaseUrl).toBe('https://assistant.example.com');
    expect(custom.publicBaseUrlSource).toBe('PUBLIC_BASE_URL');
    expect(loadConfig({ ...render, TRUST_PROXY: '2' }).trustProxy).toBe(2);
  });

  it('resolves file paths against the repo root', () => {
    const config = loadConfig({ MEMBERS_FILE: 'data/other.csv', STORAGE_DIR: '/tmp/adn-data' });
    expect(config.paths.membersFile).toMatch(/[\\/]data[\\/]other\.csv$/);
    expect(config.paths.storageDir).toBe('/tmp/adn-data');
    expect(config.paths.countiesFile).toMatch(/us-counties-2020\.csv$/);
    expect(loadConfig({}).paths.mailPreviewDir).toMatch(/server[\\/]\.mail-preview$/);
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

  const sending = {
    SMTP_HOST: 'smtp.example.com',
    EMAIL_FROM: 'ADN <hello@example.com>',
  };

  it('allows EMAIL_MODE=live only with NODE_ENV=production (rule 1)', () => {
    const live = { ...sending, TRACY_EMAIL: 'tracy@example.com', EMAIL_MODE: 'live' };
    expect(() => loadConfig(live)).toThrow(/live is only allowed/);
    expect(() => loadConfig({ ...live, NODE_ENV: 'test' })).toThrow(ConfigError);
    expect(loadConfig({ ...live, NODE_ENV: 'production' }).email.mode).toBe('live');
  });

  it('needs EMAIL_REDIRECT_TO in redirect mode', () => {
    expect(() => loadConfig({ ...sending, EMAIL_MODE: 'redirect' })).toThrow(/EMAIL_REDIRECT_TO/);
    const config = loadConfig({
      ...sending,
      EMAIL_MODE: 'redirect',
      EMAIL_REDIRECT_TO: 'test@example.com',
    });
    expect(config.email.redirectTo).toBe('test@example.com');
  });

  it('stops at startup when a sending mode has nowhere to send from, instead of failing every email', () => {
    const redirect = { EMAIL_MODE: 'redirect', EMAIL_REDIRECT_TO: 'test@example.com' };
    expect(() => loadConfig(redirect)).toThrow(/SMTP_HOST/);
    expect(() => loadConfig({ ...redirect, SMTP_HOST: 'smtp.example.com' })).toThrow(/EMAIL_FROM/);
    const live = { ...sending, EMAIL_MODE: 'live', NODE_ENV: 'production' };
    expect(() => loadConfig(live)).toThrow(/TRACY_EMAIL/);
    expect(() => loadConfig({ ...live, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
    // Preview needs none of it.
    expect(loadConfig({}).email.mode).toBe('preview');
  });

  it('wants a long admin token (24 characters or more)', () => {
    expect(() => loadConfig({ ADMIN_TOKEN: 'a'.repeat(23) })).toThrow(/ADMIN_TOKEN/);
    expect(loadConfig({ ADMIN_TOKEN: 'a'.repeat(24) }).adminToken).toBe('a'.repeat(24));
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
      OPENAI_API_KEY: 'sk-test',
    });
    expect(configWarnings(config)).toEqual([]);
  });

  it('says STORE_TRANSCRIPTS does nothing, since chat text is never stored', () => {
    expect(configWarnings(loadConfig({ STORE_TRANSCRIPTS: 'true' })).join(' ')).toMatch(
      /never stored/,
    );
    expect(configWarnings(loadConfig({})).join(' ')).not.toMatch(/STORE_TRANSCRIPTS/);
  });

  it('warns when the AI is on without a key', () => {
    expect(configWarnings(loadConfig({}))).toContain(
      'AI_ENABLED is on but OPENAI_API_KEY is not set: typed answers fall back to buttons.',
    );
    expect(loadConfig({ OPENAI_API_KEY: 'sk-test' }).ai.available).toBe(true);
    expect(loadConfig({ OPENAI_API_KEY: 'sk-test', AI_ENABLED: 'false' }).ai.available).toBe(false);
  });
});
